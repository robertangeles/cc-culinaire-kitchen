/**
 * @module hooks/useOfflineSync
 *
 * IndexedDB-backed offline queue for stock take line items.
 * When the device is offline, counts are stored locally in IndexedDB.
 * When connectivity returns, queued items sync to the server automatically.
 *
 * Design:
 *   - Detects online/offline via navigator.onLine + event listeners
 *   - Queues failed saves to IndexedDB "offlineQueue" object store
 *   - On reconnect, drains the queue in order (FIFO)
 *   - Conflict resolution: server state wins for session/category state;
 *     line items are upserted (last write wins per ingredient)
 *   - Visual indicator state exposed for UI ("Offline — counts will sync")
 */

import { useState, useEffect, useCallback, useRef } from "react";

const DB_NAME = "culinaire-inventory";
const DB_VERSION = 1;
const STORE_NAME = "offlineQueue";

interface QueuedItem {
  id?: number; // auto-increment key
  sessionId: string;
  categoryName: string;
  ingredientId: string;
  rawQty: number;
  countedUnit: string;
  queuedAt: number; // timestamp
}

/**
 * Outcome of a save attempt. The three cases are DELIBERATELY distinct so the UI
 * never tells a chef "saved offline" when the truth is "the server rejected it":
 *   - "server"  — saved to the server (the normal path).
 *   - "offline" — genuinely offline (no server response). Queued for later sync.
 *   - "error"   — reached the server and it REJECTED the count (400/404/5xx).
 *                 NOT saved, NOT queued — the chef must see why and act.
 */
export type SaveResult =
  | { saved: "server"; line: unknown }
  | { saved: "offline" }
  | { saved: "error"; status: number; message: string };

// ─── IndexedDB helpers ────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function addToQueue(item: Omit<QueuedItem, "id">): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).add(item);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function getAllQueued(): Promise<QueuedItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => { db.close(); resolve(request.result); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function removeFromQueue(id: number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function clearQueue(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// ─── Hook ─────────────────────────────────────────────────────────

export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queueSize, setQueueSize] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  // Set when a queued (offline) count is later REJECTED by the server on sync.
  // Surfaced to the chef instead of silently dropping the count.
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const syncInProgress = useRef(false);

  // Track online/offline state
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Refresh queue size
  const refreshQueueSize = useCallback(async () => {
    try {
      const items = await getAllQueued();
      setQueueSize(items.length);
    } catch {
      // IndexedDB not available
    }
  }, []);

  useEffect(() => { refreshQueueSize(); }, [refreshQueueSize]);

  // Queue a line item for later sync
  const queueLineItem = useCallback(async (
    sessionId: string,
    categoryName: string,
    ingredientId: string,
    rawQty: number,
    countedUnit: string,
  ) => {
    await addToQueue({
      sessionId,
      categoryName,
      ingredientId,
      rawQty,
      countedUnit,
      queuedAt: Date.now(),
    });
    await refreshQueueSize();
  }, [refreshQueueSize]);

  // Save a line item. Three honest outcomes — see SaveResult. We only ever say
  // "offline" when there was NO server response (offline flag or a thrown fetch);
  // a server that answers with an error is reported as "error", never disguised.
  const saveWithOfflineFallback = useCallback(async (
    sessionId: string,
    categoryName: string,
    data: { ingredientId: string; rawQty: number; countedUnit: string },
  ): Promise<SaveResult> => {
    if (!isOnline) {
      await queueLineItem(sessionId, categoryName, data.ingredientId, data.rawQty, data.countedUnit);
      return { saved: "offline" };
    }

    try {
      const res = await fetch(
        // encode the name — category/area names can contain spaces or slashes;
        // an unencoded slash would split the path and break route matching.
        `/api/inventory/stock-takes/${sessionId}/categories/${encodeURIComponent(categoryName)}/lines`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(data),
        },
      );

      if (res.ok) {
        const line = await res.json();
        return { saved: "server", line };
      }

      // Reached the server; it rejected the count (e.g. category NOT_STARTED,
      // validation, 5xx). This is NOT offline — surface the real reason and do
      // not pretend it was saved.
      const body = await res.json().catch(() => null);
      return {
        saved: "error",
        status: res.status,
        message: body?.error ?? `Couldn't save (server error ${res.status})`,
      };
    } catch {
      // fetch threw = the request never reached the server = genuinely offline.
      await queueLineItem(sessionId, categoryName, data.ingredientId, data.rawQty, data.countedUnit);
      return { saved: "offline" };
    }
  }, [isOnline, queueLineItem]);

  // Drain the queue — sync all queued items to server
  const syncQueue = useCallback(async (): Promise<{ synced: number; failed: number }> => {
    if (syncInProgress.current) return { synced: 0, failed: 0 };
    syncInProgress.current = true;
    setIsSyncing(true);

    let synced = 0;
    let failed = 0;

    try {
      const items = await getAllQueued();

      for (const item of items) {
        try {
          const res = await fetch(
            `/api/inventory/stock-takes/${item.sessionId}/categories/${encodeURIComponent(item.categoryName)}/lines`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                ingredientId: item.ingredientId,
                rawQty: item.rawQty,
                countedUnit: item.countedUnit,
              }),
            },
          );

          if (res.ok) {
            await removeFromQueue(item.id!);
            synced++;
            setLastSyncError(null);
          } else {
            // The server rejected a previously-offline count (session closed,
            // category not started, validation...). NEVER silently drop it —
            // keep it queued and surface the reason so a chef's count is never
            // lost without them knowing. Stop the drain so we don't hammer.
            // ponytail: a stuck permanent-reject sits in the queue and keeps the
            // "waiting to sync" banner up; add a "review & discard" affordance if
            // that proves annoying (clearQueue already exists as the escape hatch).
            const err = await res.json().catch(() => null);
            setLastSyncError(err?.error ?? `A queued count was rejected (${res.status})`);
            failed++;
            break;
          }
        } catch {
          // Network still down — stop trying, retry on next reconnect.
          failed++;
          break;
        }
      }

      await refreshQueueSize();
    } finally {
      syncInProgress.current = false;
      setIsSyncing(false);
    }

    return { synced, failed };
  }, [refreshQueueSize]);

  // Auto-sync when coming back online
  useEffect(() => {
    if (isOnline && queueSize > 0) {
      syncQueue();
    }
  }, [isOnline, queueSize, syncQueue]);

  return {
    isOnline,
    queueSize,
    isSyncing,
    lastSyncError,
    saveWithOfflineFallback,
    syncQueue,
    clearQueue: useCallback(async () => {
      await clearQueue();
      await refreshQueueSize();
    }, [refreshQueueSize]),
  };
}
