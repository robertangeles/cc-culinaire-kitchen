/**
 * My documents. The last list is kept sealed on the phone (`lockedCache`) and shown, with its time, when the server cannot be reached; a
 * certificate's photo never is, and nothing is queued. Every write waits for the server, and one that may have landed is looked for before it is made again.
 */

import { MyDocumentsSchema, type MyDocument } from "@culinaire/shared/schemas/compliance";
import { ApiError } from "../api/client";
import { answerLost, onlineWrite, readMessage, UnsureError } from "../api/onlineWrite";
import type { StoreCache } from "../lock/lockedCache";
import type { ComplianceApi, DocumentFields, NewDocument } from "./complianceApi";

export interface DocumentsSnapshot {
  phase: "loading" | "ready" | "failed";
  /** The kitchen has not switched compliance on (the server answers 404 to everyone). */
  off: boolean;
  error: string | null;
  /** When what is shown was saved, if it is the phone's copy because the server could not be reached. */
  savedAt: string | null;
  docs: MyDocument[];
}

export function createDocumentStore(api: ComplianceApi, cache?: StoreCache) {
  let snapshot: DocumentsSnapshot = { phase: "loading", off: false, error: null, savedAt: null, docs: [] };
  const listeners = new Set<() => void>();
  const set = (next: Partial<DocumentsSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };
  let reads = 0;

  /** True when it read what the server holds now. */
  async function refresh(): Promise<boolean> {
    const mine = ++reads;
    const owner = cache?.owner() ?? null;
    try {
      const docs = await api.mine();
      if (mine === reads) {
        set({ phase: "ready", off: false, error: null, savedAt: null, docs });
        void cache?.write("documents", owner, docs);
      }
      return true;
    } catch (err) {
      if (mine !== reads) return false;
      const code = err instanceof ApiError ? err.code : null;
      if (code === "not_found" || code === "forbidden") void cache?.remove("documents");
      if (code === "not_found") set({ phase: "ready", off: true, error: null, savedAt: null, docs: [] });
      else if (code === "forbidden") set({ phase: "failed", error: "You don't have access to documents.", savedAt: null, docs: [] });
      else {
        const copy = snapshot.phase !== "ready" && answerLost(err) ? await cache?.read("documents", MyDocumentsSchema) : null;
        if (mine !== reads) return false;
        if (copy) set({ phase: "ready", off: false, error: readMessage(err), savedAt: copy.at, docs: copy.data });
        else set({ phase: snapshot.phase === "ready" ? "ready" : "failed", error: readMessage(err) });
      }
      return false;
    }
  }

  const find = (id: string) => snapshot.docs.find((d) => d.complianceDocumentId === id);
  const day = (v: string | null) => v?.slice(0, 10) ?? null;
  /** Files whose send failed in a way that may still have landed: looked for on the server before they are sent again. */
  const tried = new Set<string>();
  const holds = (storagePublicId: string) => snapshot.docs.some((d) => d.storagePublicId === storagePublicId);

  return {
    getSnapshot: () => snapshot,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    refresh,
    find,

    upload: api.upload,
    viewUrl: api.viewUrl,
    readImage: api.readImage,

    /** A repeat is told apart by its file: every upload has its own id. A 409 can be this very document, saved before the answer was lost. */
    async send(doc: NewDocument): Promise<void> {
      if (tried.has(doc.storagePublicId)) {
        if (!(await refresh())) throw new UnsureError();
        if (holds(doc.storagePublicId)) return;
      }
      tried.add(doc.storagePublicId);
      await onlineWrite({ run: () => api.create(doc), read: refresh, landed: () => holds(doc.storagePublicId), maybeDone: (err) => err.code === "conflict" });
    },
    update: (id: string, f: DocumentFields) =>
      onlineWrite({
        run: () => api.update(id, f),
        read: refresh,
        landed: () => {
          const d = find(id);
          return d !== undefined && d.verificationStatus === "Pending" && d.documentNumber === f.documentNumber && day(d.issueDate) === f.issueDate && day(d.expiryDate) === f.expiryDate && d.issuingJurisdiction === f.issuingJurisdiction;
        },
      }),
    remove: (id: string) => onlineWrite({ run: () => api.remove(id), read: refresh, landed: () => find(id) === undefined, maybeDone: (err) => err.code === "not_found" }),
    nudge: (id: string) => api.nudge(id),
  };
}

export type DocumentStore = ReturnType<typeof createDocumentStore>;
