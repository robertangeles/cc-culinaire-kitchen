/**
 * The transfer screens' data: the transfers to and from this location (kept on the phone for no-signal starts) with the commands still
 * in the queue laid over them, each transfer's detail as last opened (so a receive works with no signal), and what this location has on
 * hand ("You have", absent for someone without `inventory:cost`). Every change only writes to the queue.
 */

import type { TransferDetail, TransferSummary } from "@culinaire/shared/schemas/transfer";
import { ApiError } from "../api/client";
import type { KvStore } from "../storage/kv";
import type { Outbox } from "../outbox/outbox";
import type { TransferApi } from "./transferApi";
import { TRANSFER_CANCEL, TRANSFER_CREATE, TRANSFER_RECEIVE, TRANSFER_SEND, TRANSFER_TYPES, type TransferActionCommand, type TransferCreateCommand, type TransferReceiveCommand } from "./transferCommands";
import { checkReceipt, mergeTransfers, type ReceiptCheck, type TransferRow } from "./transferView";

export interface TransferForm {
  toLocationId: string;
  toLocationName: string;
  /** Quantities as typed. */
  lines: { ingredientId: string; ingredientName: string; unit: string; quantity: string }[];
  notes: string;
  /** Send it now (create, then send) rather than keep it to send later. */
  sendNow: boolean;
}

export interface TransferSnapshot {
  phase: "loading" | "ready" | "error";
  /** True when showing what was last downloaded because the server could not be reached. */
  offline: boolean;
  error?: string;
  rows: TransferRow[];
  /** Store-room quantity here per item; an item with no entry is hidden or unknown (a dash, never 0). */
  onHand: Record<string, number>;
  waiting: number;
  attention: number;
}

export interface TransferStoreDeps {
  api: TransferApi;
  kv: KvStore;
  outbox: Outbox;
  userId: number;
  userName: string;
  locationId: string;
  locationName: string;
  kick: () => void;
  now: () => number;
  newId: () => string;
}

/** The server's limit per line (`LineSchema`): a quantity it refuses is caught before it is queued. Stock on hand is never a reason to refuse. */
const MAX_QTY = 99999;
const isOffline = (err: unknown) => err instanceof ApiError && (err.code === "network" || err.code === "timeout");

export function createTransferStore({ api, kv, outbox, userId, userName, locationId, locationName, kick, now, newId }: TransferStoreDeps) {
  // Per account: another person signing in on this phone must never see this one's list.
  const listKey = `transfers.${userId}.${locationId}`;
  const onHandKey = `transfers.onHand.${userId}.${locationId}`;
  const detailKey = (id: string) => `transfers.detail.${userId}.${id}`;
  let serverRows: TransferSummary[] = [];
  let acceptedSeen: number | null = null;
  let snapshot: TransferSnapshot = { phase: "loading", offline: false, rows: [], onHand: {}, waiting: 0, attention: 0 };
  const listeners = new Set<() => void>();
  const set = (next: Partial<TransferSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  };

  async function rebuild() {
    const entries = await outbox.entriesOfTypes(TRANSFER_TYPES);
    const open = entries.filter((e) => e.status !== "ACCEPTED");
    const accepted = entries.length - open.length;
    set({ rows: mergeTransfers(serverRows, entries, userName), waiting: open.filter((e) => e.status !== "NEEDS_ATTENTION").length, attention: open.filter((e) => e.status === "NEEDS_ATTENTION").length });
    // Something was just sent: the server's list now holds it.
    if (acceptedSeen !== null && accepted > acceptedSeen && snapshot.phase === "ready") void store.refresh();
    acceptedSeen = accepted;
  }

  /** In the background: the form shows "You have" when it can, and never waits for it. */
  async function refreshOnHand() {
    try {
      const onHand = Object.fromEntries((await api.items(locationId)).flatMap((i) => (typeof i.currentQty === "number" ? [[i.ingredientId, i.currentQty]] : [])));
      await kv.set(onHandKey, JSON.stringify(onHand));
      set({ onHand });
    } catch {
      set({ onHand: JSON.parse((await kv.get(onHandKey)) ?? "{}") as Record<string, number> });
    }
  }

  const labelOf = (id: string) => {
    const row = snapshot.rows.find((r) => r.transferId === id);
    return row ? `${row.fromLocationName ?? "?"} to ${row.toLocationName ?? "?"}` : "";
  };

  async function enqueue(type: string, command: unknown) {
    await outbox.enqueueCommand(type, command);
    await rebuild();
    kick();
  }

  const unsubscribe = outbox.subscribe(() => void rebuild());

  const store = {
    getSnapshot: () => snapshot,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    dispose: unsubscribe,

    /** Download the list (and, separately, what is on hand), or fall back to the last download when there is no signal. */
    async refresh(): Promise<void> {
      void refreshOnHand();
      try {
        const [list, pending] = await Promise.all([api.list(locationId), api.pending(locationId)]);
        const byId = new Map([...list, ...pending].map((t) => [t.transferId, t]));
        serverRows = [...byId.values()];
        await kv.set(listKey, JSON.stringify(serverRows));
        set({ phase: "ready", offline: false, error: undefined });
      } catch (err) {
        if (isOffline(err)) {
          serverRows = JSON.parse((await kv.get(listKey)) ?? "[]") as TransferSummary[];
          set({ phase: "ready", offline: true, error: undefined });
        } else {
          set({ phase: "error", error: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
        }
      }
      await rebuild();
    },

    /** A transfer's lines: from the server, else as last opened on this phone (null if never). Refusals (404, 403) are thrown. */
    async detail(transferId: string): Promise<{ detail: TransferDetail | null; offline: boolean }> {
      try {
        const detail = await api.detail(transferId);
        await kv.set(detailKey(transferId), JSON.stringify(detail));
        return { detail, offline: false };
      } catch (err) {
        if (!isOffline(err)) throw err;
        return { detail: JSON.parse((await kv.get(detailKey(transferId))) ?? "null") as TransferDetail | null, offline: true };
      }
    },

    /** The lines of a transfer made on this phone that the server does not hold yet. */
    async localLines(transferId: string) {
      const created = (await outbox.entriesOfTypes([TRANSFER_CREATE])).find((e) => (e.command as TransferCreateCommand).transferId === transferId);
      return created ? (created.command as TransferCreateCommand).lines : null;
    },

    /** A new transfer from this location, saved on the phone at once with a new id; sent along with it when `sendNow`. Returns its id. */
    async create(form: TransferForm): Promise<string> {
      if (!form.toLocationId || form.toLocationId === locationId) throw new Error("Choose where it's going.");
      if (form.lines.length === 0) throw new Error("Add at least one item.");
      const seen = new Set<string>();
      const lines = form.lines.map((l) => {
        if (!l.ingredientId) throw new Error(`Pick ${l.ingredientName || "the item"} from the list.`);
        if (!l.unit) throw new Error(`Pick ${l.ingredientName} from the list again: its unit is not known.`);
        if (seen.has(l.ingredientId)) throw new Error(`${l.ingredientName} is on the transfer twice.`);
        seen.add(l.ingredientId);
        const qty = Number(l.quantity.trim().replace(",", "."));
        if (l.quantity.trim() === "" || !Number.isFinite(qty) || qty <= 0) throw new Error(`Enter how much ${l.ingredientName} is going.`);
        if (qty > MAX_QTY) throw new Error(`That's more ${l.ingredientName} than the app can record in one transfer.`);
        return { ingredientId: l.ingredientId, ingredientName: l.ingredientName, sentQty: qty, sentUnit: l.unit };
      });
      const command: TransferCreateCommand = { transferId: newId(), fromLocationId: locationId, fromLocationName: locationName, toLocationId: form.toLocationId, toLocationName: form.toLocationName, lines, notes: form.notes.trim() || null, createdAt: new Date(now()).toISOString() };
      await outbox.enqueueCommand(TRANSFER_CREATE, command);
      if (form.sendNow) await outbox.enqueueCommand(TRANSFER_SEND, { transferId: command.transferId, label: `${locationName} to ${form.toLocationName}` } satisfies TransferActionCommand);
      await rebuild();
      kick();
      return command.transferId;
    },

    send: (transferId: string) => enqueue(TRANSFER_SEND, { transferId, label: labelOf(transferId) } satisfies TransferActionCommand),
    cancel: (transferId: string) => enqueue(TRANSFER_CANCEL, { transferId, label: labelOf(transferId) } satisfies TransferActionCommand),

    /** What arrived, every line (as sent unless typed). Nothing is queued when a quantity would be refused. */
    async receive(detail: TransferDetail, typed: Record<string, string>): Promise<ReceiptCheck> {
      const check = checkReceipt(detail.lines, typed);
      if (!check.ok) return check;
      const command: TransferReceiveCommand = { transferId: detail.transferId, label: `${detail.fromLocationName ?? "?"} to ${detail.toLocationName ?? "?"}`, userId, receivedLines: check.receivedLines, hasDifference: check.differences.length > 0 };
      await enqueue(TRANSFER_RECEIVE, command);
      return check;
    },

    async retry(entryId: string): Promise<void> {
      await outbox.retry(entryId);
      kick();
    },

    async discard(entryId: string): Promise<void> {
      await outbox.discard(entryId);
    },
  };
  return store;
}

export type TransferStore = ReturnType<typeof createTransferStore>;
