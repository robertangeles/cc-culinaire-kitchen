/**
 * @module hooks/useBenchSafety
 *
 * Blocking, reporting and the moderators' queue on The Bench.
 * Every failure comes back as the server's sentence and code.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { parseApiErrorBody } from "@culinaire/shared";
import type { BenchReport, BenchReportReason } from "@culinaire/shared/schemas/bench";

const API = import.meta.env.VITE_API_URL ?? "";

export interface BenchPerson {
  userId: number;
  userName: string;
  userPhotoPath: string | null;
}

/** A message (with its author) or a person. */
export interface ReportTarget {
  person: BenchPerson;
  messageId?: string;
}

export interface BenchFailure {
  error: string;
  code?: string;
}

async function failure(res: Response): Promise<BenchFailure> {
  const { error, code } = parseApiErrorBody(await res.json().catch(() => null));
  return { error: error ?? `The server answered ${res.status}. Try again.`, code };
}

const OFFLINE: BenchFailure = { error: "Couldn't reach the server. Check your connection and try again." };

/** A write to the API; null on success. */
async function send(method: string, path: string, body?: unknown): Promise<BenchFailure | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.ok ? null : await failure(res);
  } catch {
    return OFFLINE;
  }
}

/** POST /api/bench/reports: a message or a person. */
export function sendBenchReport(target: ReportTarget, reason: BenchReportReason, note: string) {
  const about = target.messageId ? { messageId: target.messageId } : { userId: target.person.userId };
  return send("POST", "/api/bench/reports", { ...about, reason, note: note.trim() || undefined });
}

/** The people I blocked, and blocking/unblocking them. `enabled` is false for guests. */
export function useBenchBlocks(enabled: boolean) {
  const [blocked, setBlocked] = useState<BenchPerson[]>([]);

  useEffect(() => {
    if (!enabled) return;
    fetch(`${API}/api/bench/blocks`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((list: BenchPerson[] | null) => { if (list) setBlocked(list); })
      .catch(() => undefined);
  }, [enabled]);

  const blockedIds = useMemo(() => new Set(blocked.map((p) => p.userId)), [blocked]);

  const block = useCallback(async (person: BenchPerson) => {
    const failed = await send("POST", "/api/bench/blocks", { userId: person.userId });
    if (!failed) setBlocked((prev) => (prev.some((p) => p.userId === person.userId) ? prev : [...prev, person]));
    return failed;
  }, []);

  const unblock = useCallback(async (userId: number) => {
    const failed = await send("DELETE", `/api/bench/blocks/${userId}`);
    if (!failed) setBlocked((prev) => prev.filter((p) => p.userId !== userId));
    return failed;
  }, []);

  return { blocked, blockedIds, block, unblock };
}

export type ReportStatus = "open" | "closed";
export type ReportAction = "hide" | "dismiss" | "resolve";

/** The moderators' queue (bench:moderate). */
export function useBenchReports(status: ReportStatus) {
  const [answer, setAnswer] = useState<{ status: ReportStatus; reports: BenchReport[]; error: string | null } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true; // the answer may come after a switch to the other list
    (async () => {
      let reports: BenchReport[] = [];
      let error: string | null = null;
      try {
        const res = await fetch(`${API}/api/bench/reports?status=${status}`, { credentials: "include" });
        if (res.ok) reports = await res.json();
        else error = (await failure(res)).error;
      } catch {
        error = OFFLINE.error;
      }
      if (current) setAnswer({ status, reports, error });
    })();
    return () => { current = false; };
  }, [status, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  // The list on screen until a fresh answer replaces it; none while the other list loads
  const shown = answer?.status === status ? answer : null;

  const act = useCallback(
    (id: string, action: ReportAction, note?: string) =>
      send("POST", `/api/bench/reports/${id}/${action}`, note?.trim() ? { note: note.trim() } : {}),
    [],
  );

  return { reports: shown?.reports ?? [], loading: !shown, loadError: shown?.error ?? null, reload, act };
}
