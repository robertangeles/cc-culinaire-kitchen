/**
 * The count screens' data: the open stock take, each area's sheet and saved lines, this chef's claims,
 * and the outbox entries. Everything downloaded is also written to the phone (kv) so the app can reopen
 * and keep counting with no signal. Claiming and submitting are online-only (owner-approved offline rules).
 */

import { ApiError } from "../api/client";
import type { KvStore } from "../storage/kv";
import type { Outbox, OutboxEntry } from "../outbox/outbox";
import type { ActiveSession, AreaSheet, CountApi, MissingItem } from "./countApi";
import { buildAnswers, reviewRows, submitCheck, type Answer, type ServerLine, type SubmitCheck } from "./countFlow";

export interface CountSnapshot {
  phase: "loading" | "none" | "categoryMode" | "error" | "ready";
  /** True when showing what was last downloaded because the server could not be reached. */
  offline: boolean;
  error?: string;
  session: ActiveSession | null;
  sheets: AreaSheet[];
  /** Areas this chef holds, with the claim their counts are made under. */
  claims: Record<string, { claimRevision: number }>;
  serverLines: Record<string, ServerLine[]>;
  entries: Record<string, OutboxEntry[]>;
}

type Downloaded = Pick<CountSnapshot, "session" | "sheets" | "claims" | "serverLines">;

export type OpenAreaResult = { status: "claimed" } | { status: "held" } | { status: "submitted" } | { status: "offline" };

export type SubmitOutcome =
  | { ok: true }
  | { ok: false; reason: "blocked"; check: SubmitCheck }
  | { ok: false; reason: "missing"; missing: MissingItem[]; message: string }
  | { ok: false; reason: "error"; message: string };

export interface CountStoreDeps {
  api: CountApi;
  kv: KvStore;
  outbox: Outbox;
  getUserId: () => number;
  locationId: string;
  /** Ask the sender to run (the outbox drain), e.g. right after a count is saved. */
  kick: () => void;
}

const isOffline = (err: unknown) => err instanceof ApiError && (err.code === "network" || err.code === "timeout");

export function createCountStore({ api, kv, outbox, getUserId, locationId, kick }: CountStoreDeps) {
  const cacheKey = `count.${locationId}`;
  let snapshot: CountSnapshot = { phase: "loading", offline: false, session: null, sheets: [], claims: {}, serverLines: {}, entries: {} };
  const listeners = new Set<() => void>();

  function set(next: Partial<CountSnapshot>) {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
  }

  async function writeCache() {
    const { session, sheets, claims, serverLines } = snapshot;
    await kv.set(cacheKey, JSON.stringify({ session, sheets, claims, serverLines } satisfies Downloaded));
  }

  async function loadEntries() {
    const { session, sheets } = snapshot;
    if (!session) return set({ entries: {} });
    const pairs = await Promise.all(sheets.map(async (s) => [s.categoryName, await outbox.entriesFor(session.sessionId, s.categoryName)] as const));
    set({ entries: Object.fromEntries(pairs) });
  }
  outbox.subscribe(() => void loadEntries());

  async function download(): Promise<void> {
    const session = await api.activeSession();
    if (!session) {
      await kv.delete(cacheKey);
      return set({ phase: "none", offline: false, error: undefined, session: null, sheets: [], claims: {}, serverLines: {}, entries: {} });
    }
    if (session.countMode !== "AREA") return set({ phase: "categoryMode", offline: false, error: undefined, session, sheets: [], claims: {}, serverLines: {}, entries: {} });

    const sheets = await api.countSheets(session.sessionId);
    const held = session.categories.filter((c) => c.claimedByUserId === getUserId() && c.categoryStatus === "IN_PROGRESS");
    const claims = Object.fromEntries(held.map((c) => [c.categoryName, { claimRevision: c.claimRevision }]));
    const serverLines = Object.fromEntries(await Promise.all(held.map(async (c) => [c.categoryName, await api.areaLines(session.sessionId, c.categoryName)] as const)));
    set({ phase: "ready", offline: false, error: undefined, session, sheets, claims, serverLines });
    await writeCache();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    /** Download the current stock take, or fall back to the last download when there is no signal. */
    async refresh(): Promise<void> {
      try {
        await download();
      } catch (err) {
        const raw = isOffline(err) ? await kv.get(cacheKey) : null;
        if (raw) set({ phase: "ready", offline: true, error: undefined, ...(JSON.parse(raw) as Downloaded) });
        else set({ phase: "error", error: isOffline(err) ? "Connect to download the stock take." : err instanceof ApiError ? err.message : "Something went wrong. Try again." });
      }
      await loadEntries();
    },

    /** Start counting an area. An area this chef already holds opens with no signal; a free one must be claimed online. */
    async openArea(areaName: string): Promise<OpenAreaResult> {
      const session = snapshot.session;
      if (!session) return { status: "offline" };
      if (snapshot.claims[areaName]) return { status: "claimed" };
      try {
        const claim = await api.claimArea(session.sessionId, areaName);
        if (claim.status !== "claimed") return { status: claim.status };
        const lines = await api.areaLines(session.sessionId, areaName).catch(() => [] as ServerLine[]);
        set({ claims: { ...snapshot.claims, [areaName]: { claimRevision: claim.claimRevision } }, serverLines: { ...snapshot.serverLines, [areaName]: lines } });
        await writeCache();
        return { status: "claimed" };
      } catch (err) {
        if (isOffline(err)) return { status: "offline" };
        throw err;
      }
    },

    answers(areaName: string): Map<string, Answer> {
      return buildAnswers(snapshot.serverLines[areaName] ?? [], snapshot.entries[areaName] ?? []);
    },

    /** Save a count on the phone and ask the sender to send it. */
    async saveCount(areaName: string, count: { ingredientId: string; ingredientName: string; rawQty: number; countedUnit: string }): Promise<void> {
      const session = snapshot.session;
      const claim = snapshot.claims[areaName];
      if (!session || !claim) throw new Error("Open this area before counting it.");
      await outbox.enqueue({ sessionId: session.sessionId, categoryName: areaName, claimRevision: claim.claimRevision, ...count });
      await loadEntries(); // the caller reads answers() next, so the new entry must already be in
      kick();
    },

    /** Submit an area for review (online-only). Blocked here until every count has reached the server. */
    async submit(areaName: string): Promise<SubmitOutcome> {
      const session = snapshot.session;
      const sheet = snapshot.sheets.find((s) => s.categoryName === areaName);
      const claim = snapshot.claims[areaName];
      if (!session || !sheet || !claim) return { ok: false, reason: "error", message: "Open this area before submitting it." };

      const check = submitCheck(reviewRows(sheet.items, this.answers(areaName)));
      if (!check.ok) return { ok: false, reason: "blocked", check };
      try {
        const result = await api.submitArea(session.sessionId, areaName, claim.claimRevision);
        if (result.ok) {
          await this.refresh();
          return { ok: true };
        }
        return { ok: false, reason: "missing", missing: result.missing, message: result.message };
      } catch (err) {
        return { ok: false, reason: "error", message: err instanceof ApiError ? err.message : "Something went wrong. Try again." };
      }
    },
  };
}

export type CountStore = ReturnType<typeof createCountStore>;
