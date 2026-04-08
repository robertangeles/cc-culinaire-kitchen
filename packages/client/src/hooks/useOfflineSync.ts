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

  // Save a line item — try server first, queue if offline/failed
  const saveWithOfflineFallback = useCallback(async (
    sessionId: string,
    categoryName: string,
    data: { ingredientId: string; rawQty: number; countedUnit: string },
  ): Promise<{ saved: "server" | "offline"; line?: unknown }> => {
    if (!isOnline) {
      await queueLineItem(sessionId, categoryName, data.ingredientId, data.rawQty, data.countedUnit);
      return { saved: "offline" };
    }

    try {
      const res = await fetch(
        `/api/inventory/stock-takes/${sessionId}/categories/${categoryName}/lines`,
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

      // Server error — queue for retry
      await queueLineItem(sessionId, categoryName, data.ingredientId, data.rawQty, data.countedUnit);
      return { saved: "offline" };
    } catch {
      // Network error — queue for retry
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
            `/api/inventory/stock-takes/${item.sessionId}/categories/${item.categoryName}/lines`,
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
          } else {
            // Server rejected (e.g., session closed) — discard
            const err = await res.json().catch(() => null);
            console.warn("[offlineSync] Server rejected queued item:", err?.error);
            await removeFromQueue(item.id!);
            failed++;
          }
        } catch {
          // Network still down — stop trying
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
    saveWithOfflineFallback,
    syncQueue,
    clearQueue: useCallback(async () => {
      await clearQueue();
      await refreshQueueSize();
    }, [refreshQueueSize]),
  };
}
