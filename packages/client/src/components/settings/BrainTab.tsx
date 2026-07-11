/**
 * @module components/settings/BrainTab
 *
 * Admin settings for The Brain — the per-user AI memory layer
 * (docs/specs/brain-memory.md). Exposes the five `brain_*` rollout flags as
 * live toggles (no more devtools `PUT /api/settings` surgery) plus a health
 * readout from `GET /api/brain/stats` (queue depth by status, memories/day,
 * in-process capture counters).
 *
 * Rollout guidance is baked into the UI: capture/recall/distillation only do
 * anything while the master `brain_enabled` is on, and the recommended order is
 * capture → (warm the corpus) → distillation → recall. Each toggle writes a
 * single flag immediately (the settings PUT invalidates the server cache) and
 * refreshes the stats. All flag flips are instantly reversible.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  AlertCircle,
  Brain,
  RefreshCw,
  BarChart3,
  Database,
  Wand2,
} from "lucide-react";

const API = import.meta.env.VITE_API_URL ?? "";

/** Health snapshot returned by GET /api/brain/stats. */
interface BrainStats {
  flags: Record<string, string>;
  statusCounts: Record<string, number>;
  memoriesLast24h: number;
  memoriesLast7d: number;
  capture: { recorded: number; skipped: number; errors: number };
}

/** Analytics returned by GET /api/brain/analytics (Phase 3 T18). */
interface RecallStats {
  totalRecalls: number;
  hitRate: number;
  avgHits: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  daily: Array<{ dateKey: number; recalls: number; avgHits: number; avgLatencyMs: number }>;
}
interface CorpusStats {
  totalMemories: number;
  byScope: { user: number; org: number };
  byStatus: Record<string, number>;
  growth: Array<{ dateKey: number; scopeKey: number; total: number }>;
  topOrgs: Array<{ organisationId: number; count: number }>;
}
interface BrainAnalytics {
  recall: RecallStats;
  corpus: CorpusStats;
}

/** The five rollout flags, in recommended activation order. */
const FLAGS: {
  key: string;
  label: string;
  desc: string;
  /** When true, the flag is a no-op until the master flag is on. */
  needsMaster?: boolean;
}[] = [
  {
    key: "brain_enabled",
    label: "Brain (master)",
    desc: "Master switch. Off means capture, recall, and the embed worker are all inert — instant kill.",
  },
  {
    key: "brain_capture_enabled",
    label: "Capture",
    desc: "Record chat turns as memories and embed them. Warm the corpus here before turning on recall.",
    needsMaster: true,
  },
  {
    key: "brain_distillation_enabled",
    label: "Distillation filter",
    desc: "Drop low-value turns (retrieval questions, chit-chat) before storing, so Your Brain stays signal.",
    needsMaster: true,
  },
  {
    key: "brain_recall_enabled",
    label: "Recall",
    desc: "Ground answers in the user's own memories and show the “grounded in your Brain” chip.",
    needsMaster: true,
  },
  {
    key: "brain_nudges_enabled",
    label: "Proactive nudges",
    desc: "Send opted-in users the occasional actionable suggestion from their kitchen's recent activity, via the notification bell. Rate-limited; each user opts in on Your Brain.",
    needsMaster: true,
  },
  {
    key: "brain_compaction_enabled",
    label: "Compaction",
    desc: "Nightly, merge each user's coldest memories over the cap below into one digest and archive the originals, so recall stays fast. No-op unless the cap is above 0.",
    needsMaster: true,
  },
];

export function BrainTab() {
  const [flags, setFlags] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<BrainStats | null>(null);
  const [analytics, setAnalytics] = useState<BrainAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [reembedding, setReembedding] = useState(false);
  const [reembedMsg, setReembedMsg] = useState("");

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/brain/stats`, { credentials: "include" });
      if (!res.ok) return;
      const data: BrainStats = await res.json();
      setStats(data);
      // The stats payload echoes the live flags — treat it as the source of truth.
      if (data.flags) setFlags(data.flags);
      // Analytics (Phase 3 T18) — best-effort; the readout still works without it.
      // Only accept a well-formed payload so a partial/unexpected response can't
      // crash the render (the tiles guard on analytics.recall existing).
      const ares = await fetch(`${API}/api/brain/analytics`, { credentials: "include" });
      if (ares.ok) {
        const a = (await ares.json()) as Partial<BrainAnalytics>;
        if (a?.recall && a?.corpus) setAnalytics(a as BrainAnalytics);
      }
    } catch {
      // Non-fatal — the toggles still work without the readout.
    }
  }, []);

  async function reembedFailed() {
    setReembedding(true);
    setReembedMsg("");
    try {
      const res = await fetch(`${API}/api/brain/reembed-failed`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to requeue");
      const { requeued } = (await res.json()) as { requeued: number };
      setReembedMsg(`Requeued ${requeued} memor${requeued === 1 ? "y" : "ies"} for re-embed.`);
      await loadStats();
    } catch {
      setReembedMsg("Couldn't requeue — try again.");
    } finally {
      setReembedding(false);
    }
  }

  useEffect(() => {
    (async () => {
      await loadStats();
      setLoading(false);
    })();
    // Refresh the health readout periodically so queue depth stays current.
    const id = setInterval(loadStats, 10_000);
    return () => clearInterval(id);
  }, [loadStats]);

  const masterOn = flags.brain_enabled === "true";

  async function saveValue(key: string, value: string) {
    setSavingKey(key);
    setErrorMsg("");
    const prev = flags[key];
    // Optimistic update.
    setFlags((f) => ({ ...f, [key]: value }));
    try {
      const res = await fetch(`${API}/api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Failed to save");
      }
      await loadStats();
    } catch (err) {
      // Revert on failure.
      setFlags((f) => ({ ...f, [key]: prev }));
      setErrorMsg(err instanceof Error ? err.message : "Failed to update flag.");
    } finally {
      setSavingKey(null);
    }
  }

  const toggle = (key: string, next: boolean) => saveValue(key, next ? "true" : "false");

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-[#999999]">
        <Loader2 className="size-5 animate-spin mr-2" />
        Loading Brain settings…
      </div>
    );
  }

  const errorsCount = stats?.capture.errors ?? 0;
  const failedCount = stats?.statusCounts.failed ?? 0;

  return (
    <div className="max-w-3xl space-y-6 p-6">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-[#FAFAFA]">
          <Brain className="size-4 text-[#D4A574]" />
          The Brain
        </h2>
        <p className="text-sm text-[#999999] mt-1">
          Per-user AI memory. Flip flags one at a time; every change is instant and reversible.
          Recommended order: Capture → let it warm → Distillation → Recall.
        </p>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/30 border border-red-700/40 rounded-lg px-3 py-2">
          <AlertCircle className="size-4 flex-shrink-0" /> {errorMsg}
        </div>
      )}

      {/* Health readout */}
      <div className="rounded-xl border border-[#2A2A2A] bg-[#111111] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-[#E5E5E5]">Health</h3>
          <button
            type="button"
            onClick={loadStats}
            className="flex items-center gap-1.5 text-xs text-[#999999] hover:text-[#FAFAFA] transition-colors"
            aria-label="Refresh Brain health"
          >
            <RefreshCw className="size-3.5" /> Refresh
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Ready" value={stats?.statusCounts.ready ?? 0} />
          <Stat label="Pending" value={stats?.statusCounts.pending ?? 0} />
          <Stat
            label="Failed"
            value={stats?.statusCounts.failed ?? 0}
            tone={(stats?.statusCounts.failed ?? 0) > 0 ? "warn" : undefined}
          />
          <Stat label="Memories / 24h" value={stats?.memoriesLast24h ?? 0} />
        </div>
        <div className="mt-3 pt-3 border-t border-white/5 grid grid-cols-3 gap-3">
          <Stat label="Captured (boot)" value={stats?.capture.recorded ?? 0} small />
          <Stat label="Skipped (boot)" value={stats?.capture.skipped ?? 0} small />
          <Stat
            label="Errors (boot)"
            value={errorsCount}
            small
            tone={errorsCount > 0 ? "warn" : undefined}
          />
        </div>
        {errorsCount > 0 && (
          <p className="mt-3 text-xs text-[#D4A574]">
            Capture errors since boot — check the <code>brain_capture_error</code> log alert. A broken
            capture path is otherwise silent by design.
          </p>
        )}
        {/* Re-embed panel (T18) — only when there's something stuck to requeue. */}
        {(failedCount > 0 || reembedMsg) && (
          <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between gap-3">
            <p className="text-xs text-[#999999]">
              {reembedMsg
                ? reembedMsg
                : `${failedCount} memor${failedCount === 1 ? "y" : "ies"} failed to embed after 3 tries. Requeue to try again.`}
            </p>
            {failedCount > 0 && (
              <button
                type="button"
                onClick={reembedFailed}
                disabled={reembedding}
                className="flex flex-shrink-0 items-center gap-1.5 rounded-lg bg-[#D4A574] px-3 py-1.5 text-xs font-medium text-[#0A0A0A] hover:bg-[#C4956A] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D4A574]/60 disabled:opacity-50"
              >
                {reembedding ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
                Re-embed failed
              </button>
            )}
          </div>
        )}
      </div>

      {/* Analytics dashboards (Phase 3 T18) — recall + corpus signal */}
      <div className="rounded-xl border border-[#2A2A2A] bg-[#111111] p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="size-4 text-[#D4A574]" />
          <h3 className="text-sm font-semibold text-[#E5E5E5]">Analytics</h3>
          <span className="text-[11px] text-[#666666]">recall &amp; corpus signal, last 30 days</span>
        </div>
        {!analytics || analytics.recall.totalRecalls === 0 ? (
          <p className="text-xs text-[#999999] py-2">
            No recall activity yet — the dashboards fill in as the Brain is used. Capture and recall
            events feed <code>fact_brain_recall</code>; the nightly job snapshots corpus size.
          </p>
        ) : (
          <>
            <div className="text-[11px] uppercase tracking-wide text-[#777777] mb-2">Recall (30d)</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Hit rate" value={`${Math.round(analytics.recall.hitRate * 100)}%`} />
              <Stat label="Recalls" value={analytics.recall.totalRecalls} />
              <Stat label="Avg latency" value={`${Math.round(analytics.recall.avgLatencyMs)}ms`} />
              <Stat label="p95 latency" value={`${Math.round(analytics.recall.p95LatencyMs)}ms`} />
            </div>
          </>
        )}
        <div className="mt-3 pt-3 border-t border-white/5">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[#777777] mb-2">
            <Database className="size-3" /> Corpus
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Total" value={analytics?.corpus.totalMemories ?? (stats?.statusCounts.ready ?? 0)} small />
            <Stat label="Private" value={analytics?.corpus.byScope.user ?? 0} small />
            <Stat label="Shared" value={analytics?.corpus.byScope.org ?? 0} small />
            <Stat label="Archived" value={analytics?.corpus.byStatus.archived ?? 0} small />
          </div>
        </div>
      </div>

      {/* Flag toggles */}
      <div className="space-y-2">
        {FLAGS.map((f) => {
          const on = flags[f.key] === "true";
          const dimmed = f.needsMaster && !masterOn;
          return (
            <div
              key={f.key}
              className={`flex items-start justify-between gap-4 rounded-xl border px-4 py-3 transition-colors ${
                on
                  ? "border-[#D4A574]/40 bg-[#D4A574]/[0.06] shadow-[0_0_12px_rgba(212,165,116,0.10)]"
                  : "border-[#2A2A2A] bg-[#111111]"
              }`}
            >
              <div className="min-w-0">
                <span className="text-sm font-medium text-[#FAFAFA]">{f.label}</span>
                <p className="text-xs text-[#999999] mt-0.5">{f.desc}</p>
                {dimmed && (
                  <p className="text-xs text-[#D4A574]/80 mt-1">Turn on the master switch first.</p>
                )}
              </div>
              <ToggleSwitch
                on={on}
                disabled={savingKey === f.key}
                busy={savingKey === f.key}
                onChange={(next) => toggle(f.key, next)}
                label={f.label}
              />
            </div>
          );
        })}

        {/* Compaction cap — brain_compaction_enabled is a no-op unless this is > 0. */}
        <div className="flex items-start justify-between gap-4 rounded-xl border border-[#2A2A2A] bg-[#111111] px-4 py-3">
          <div className="min-w-0">
            <span className="text-sm font-medium text-[#FAFAFA]">Compaction cap</span>
            <p className="text-xs text-[#999999] mt-0.5">
              Memories per user before the coldest are compacted. 0 disables compaction even when the
              toggle above is on.
            </p>
          </div>
          <input
            type="number"
            min={0}
            key={flags.brain_compaction_cap ?? "0"}
            defaultValue={flags.brain_compaction_cap ?? "0"}
            disabled={savingKey === "brain_compaction_cap"}
            aria-label="Compaction cap"
            onBlur={(e) => {
              const v = String(Math.max(0, parseInt(e.target.value || "0", 10) || 0));
              if (v !== (flags.brain_compaction_cap ?? "0")) saveValue("brain_compaction_cap", v);
            }}
            className="w-20 flex-shrink-0 rounded-lg border border-[#2A2A2A] bg-[#0A0A0A] px-2 py-1 text-right text-sm text-[#E5E5E5] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/60 disabled:opacity-50"
          />
        </div>
      </div>

      <p className="text-xs text-[#666666]">
        Distillation model: <code className="text-[#999999]">{flags.brain_distillation_model ?? "—"}</code>
      </p>
    </div>
  );
}

/** Small labelled metric for the health readout. */
function Stat({
  label,
  value,
  tone,
  small,
}: {
  label: string;
  value: number | string;
  tone?: "warn";
  small?: boolean;
}) {
  return (
    <div>
      <div
        className={`${small ? "text-lg" : "text-2xl"} font-semibold ${
          tone === "warn" ? "text-red-400" : "text-[#FAFAFA]"
        }`}
      >
        {value}
      </div>
      <div className="text-[11px] text-[#999999]">{label}</div>
    </div>
  );
}

/** Accessible on/off switch matching the app's amber accent. */
function ToggleSwitch({
  on,
  disabled,
  busy,
  onChange,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  busy?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`Toggle ${label}`}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#D4A574]/60 disabled:opacity-50 disabled:cursor-not-allowed ${
        on ? "bg-[#D4A574]" : "bg-[#333333]"
      }`}
    >
      <span
        className={`inline-flex h-4 w-4 items-center justify-center rounded-full bg-white transition-transform ${
          on ? "translate-x-6" : "translate-x-1"
        }`}
      >
        {busy && <Loader2 className="size-3 animate-spin text-[#666]" />}
      </span>
    </button>
  );
}
