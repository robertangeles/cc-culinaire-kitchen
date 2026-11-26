/**
 * @module BenchModerationPage
 *
 * The moderators' queue for The Bench (bench:moderate). Open reports can be
 * acted on (hide the message, dismiss, resolve); closed ones show what was done.
 */

import { useState } from "react";
import { ShieldAlert, ShieldCheck, Loader2, EyeOff, X, Check } from "lucide-react";
import { BENCH_REPORT_REASON_LABELS, type BenchReport } from "@culinaire/shared/schemas/bench";
import { useBenchReports, type ReportAction, type ReportStatus, type BenchFailure } from "../hooks/useBenchSafety.js";
import { PillTabs } from "../components/ui/PillTabs.js";
import { EmptyState } from "../components/ui/EmptyState.js";

const ACTION_DONE: Record<ReportAction, string> = { hide: "hid the message", dismiss: "dismissed", resolve: "resolved" };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function place(r: BenchReport) {
  if (r.channelName) return `#${r.channelName}`;
  return r.messageId ? "Direct message" : "Person";
}

const buttonClass =
  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 disabled:opacity-40 disabled:cursor-not-allowed";

function ReportCard({ report, onAct }: { report: BenchReport; onAct: (action: ReportAction, note?: string) => Promise<void> }) {
  const [mode, setMode] = useState<"dismiss" | "resolve" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const isOpen = report.status === "open";
  const canHide = isOpen && report.messageId !== null && !report.messageGone;

  async function run(action: ReportAction, actionNote?: string) {
    setBusy(true);
    await onAct(action, actionNote);
    setBusy(false);
  }

  return (
    <li className="rounded-2xl border border-white/5 bg-dark-50/60 backdrop-blur p-4 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] hover:-translate-y-0.5 hover:border-white/10 transition-all animate-fade-in-up">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="px-2 py-0.5 rounded-full bg-gold/15 border border-gold/20 text-gold font-medium">
          {BENCH_REPORT_REASON_LABELS[report.reason]}
        </span>
        <span className="text-dark-500">{place(report)}</span>
        <span className="text-dark-500">· {when(report.createdAt)}</span>
        {!isOpen && <span className="ml-auto px-2 py-0.5 rounded-full bg-dark-200 text-dark-600 capitalize">{report.status}</span>}
      </div>

      <p className="mt-2 text-sm text-[#E5E5E5]">
        <span className="text-dark-600">Reported:</span> <span className="font-semibold">{report.reportedUserName}</span>
        <span className="text-dark-600"> · by {report.reporterName}</span>
      </p>

      {report.messageId && (
        <blockquote className="mt-2 px-3 py-2 rounded-lg border-l-2 border-gold/40 bg-dark/60 text-sm text-[#E5E5E5] whitespace-pre-wrap break-words">
          {report.messageBody ?? ""}
          {report.messageGone && <span className="block mt-1 text-xs text-dark-500 italic">This message is gone (hidden or deleted).</span>}
        </blockquote>
      )}
      {report.note && <p className="mt-2 text-sm text-dark-600">Reporter's note: {report.note}</p>}

      {isOpen ? (
        mode ? (
          <form
            className="mt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (mode === "resolve" && !note.trim()) return;
              run(mode, note);
            }}
          >
            <label className="block text-xs text-dark-600">
              {mode === "resolve" ? "What did you do? (required)" : "Note (optional)"}
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                rows={2}
                autoFocus
                className="mt-1 w-full px-3 py-2 text-sm text-white rounded-lg border border-white/10 bg-dark resize-none focus:outline-none focus:ring-2 focus:ring-gold/50"
              />
            </label>
            <div className="mt-2 flex gap-2">
              <button
                type="submit"
                disabled={busy || (mode === "resolve" && !note.trim())}
                className={`${buttonClass} border-transparent bg-gradient-to-r from-gold to-gold-hover text-dark hover:shadow-[0_0_12px_rgba(212,165,116,0.3)]`}
              >
                <Check className="size-3.5" /> {mode === "resolve" ? "Resolve" : "Dismiss"}
              </button>
              <button type="button" onClick={() => { setMode(null); setNote(""); }} className={`${buttonClass} border-white/10 text-dark-600 hover:text-[#FAFAFA]`}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {canHide && (
              <button
                type="button"
                disabled={busy}
                onClick={() => { if (window.confirm("Hide this message from everyone?")) run("hide"); }}
                className={`${buttonClass} border-red-500/30 text-red-300 hover:bg-red-500/10`}
              >
                <EyeOff className="size-3.5" /> Hide message
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => setMode("dismiss")} className={`${buttonClass} border-white/10 text-[#E5E5E5] hover:border-gold/40 hover:text-gold`}>
              <X className="size-3.5" /> Dismiss
            </button>
            <button type="button" disabled={busy} onClick={() => setMode("resolve")} className={`${buttonClass} border-white/10 text-[#E5E5E5] hover:border-gold/40 hover:text-gold`}>
              <Check className="size-3.5" /> Resolve
            </button>
          </div>
        )
      ) : (
        <ul className="mt-3 flex flex-col gap-1 border-t border-white/5 pt-2">
          {report.actions.map((a, i) => (
            <li key={i} className="text-xs text-dark-600">
              <span className="text-[#E5E5E5]">{a.userName}</span> {ACTION_DONE[a.action]} · {when(a.createdAt)}
              {a.note && <span className="block text-dark-500">"{a.note}"</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function BenchModerationPage() {
  const [status, setStatus] = useState<ReportStatus>("open");
  const { reports, loading, loadError, reload, act } = useBenchReports(status);
  const [notice, setNotice] = useState<string | null>(null);

  async function onAct(id: string, action: ReportAction, note?: string) {
    setNotice(null);
    const failed: BenchFailure | null = await act(id, action, note);
    if (failed) setNotice(failed.code === "INVALID_STATE" ? "Someone already closed this report." : failed.error);
    reload();
  }

  return (
    <div className="flex-1 overflow-y-auto bg-dark">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <header className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-r from-gold to-gold-hover shadow-[0_0_12px_rgba(212,165,116,0.2)]">
            <ShieldAlert className="size-5 text-dark" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#FAFAFA]">Bench moderation</h1>
            <p className="text-xs text-dark-600">Reports from The Bench</p>
          </div>
        </header>

        <PillTabs
          tabs={[{ id: "open", label: "Open" }, { id: "closed", label: "Closed" }]}
          active={status}
          onChange={(s) => { setNotice(null); setStatus(s); }}
          ariaLabel="Report status"
          className="mb-6 inline-flex gap-1 rounded-xl border border-dark-200 bg-dark-100 p-1"
          tabClassName="gap-2 rounded-lg px-4 text-sm font-medium transition-all duration-200"
          activeClassName="bg-dark-200 text-[#FAFAFA] shadow-[0_0_12px_rgba(212,165,116,0.15)]"
          inactiveClassName="text-dark-600 hover:text-[#FAFAFA]"
        />

        {notice && <p role="alert" className="mb-4 px-3 py-2 rounded-lg border border-red-500/20 bg-red-500/10 text-sm text-red-300">{notice}</p>}

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-gold" /></div>
        ) : loadError ? (
          <p role="alert" className="text-sm text-red-300">{loadError}</p>
        ) : reports.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title={status === "open" ? "No open reports" : "No closed reports yet"}
            body={status === "open" ? "When someone reports a message or a person, it shows up here." : "Reports you hide, dismiss or resolve show up here."}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {reports.map((r) => (
              <ReportCard key={r.id} report={r} onAct={(action, note) => onAct(r.id, action, note)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
