/**
 * Report a message or a person on The Bench: a reason, an optional note, Send.
 * The reporter only ever learns that the report arrived.
 */

import { useEffect, useState } from "react";
import { X, Flag, Loader2 } from "lucide-react";
import { BENCH_REPORT_REASONS, BENCH_REPORT_REASON_LABELS, type BenchReportReason } from "@culinaire/shared/schemas/bench";
import { sendBenchReport, type ReportTarget } from "../../hooks/useBenchSafety.js";

const NOTE_MAX = 500;

interface BenchReportDialogProps {
  target: ReportTarget;
  onClose: () => void;
}

export function BenchReportDialog({ target, onClose }: BenchReportDialogProps) {
  const [reason, setReason] = useState<BenchReportReason | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason || sending) return;
    setSending(true);
    setError(null);
    const failed = await sendBenchReport(target, reason, note);
    setSending(false);
    if (!failed) setSent(true);
    else if (failed.code === "RATE_LIMITED") setError("You've sent the most reports allowed for today. Try again tomorrow.");
    else setError(failed.error);
  }

  const title = target.messageId ? "Report this message" : `Report ${target.person.userName}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-dark-50/95 backdrop-blur-xl p-5 shadow-[0_16px_50px_-12px_rgba(0,0,0,0.7)] animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[#FAFAFA]">
            <Flag className="size-4 text-gold" /> {title}
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded text-dark-600 hover:text-[#FAFAFA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50" aria-label="Close (Esc)">
            <X className="size-4" />
          </button>
        </div>

        {sent ? (
          <div className="text-center py-4">
            <p className="text-sm text-[#E5E5E5]">Thanks. A moderator will look at it.</p>
            <button
              type="button"
              onClick={onClose}
              autoFocus
              className="mt-5 px-4 py-2 rounded-xl bg-gradient-to-r from-gold to-gold-hover text-dark text-sm font-medium hover:shadow-[0_0_12px_rgba(212,165,116,0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 transition-all"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <fieldset>
              <legend className="text-xs text-dark-600 mb-2">What's wrong with it?</legend>
              <div className="flex flex-col gap-1">
                {BENCH_REPORT_REASONS.map((r) => (
                  <label
                    key={r}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-all has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold/50 ${
                      reason === r
                        ? "border-gold/40 bg-gold/10 text-[#FAFAFA] shadow-[0_0_12px_rgba(212,165,116,0.15)]"
                        : "border-white/5 text-[#E5E5E5] hover:bg-white/5"
                    }`}
                  >
                    <input
                      type="radio"
                      name="bench-report-reason"
                      value={r}
                      checked={reason === r}
                      onChange={() => setReason(r)}
                      className="accent-[#D4A574]"
                    />
                    {BENCH_REPORT_REASON_LABELS[r]}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="block mt-4">
              <span className="text-xs text-dark-600">Anything to add? (optional)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={NOTE_MAX}
                rows={3}
                className="mt-1 w-full px-3 py-2 text-sm text-white rounded-lg border border-white/10 bg-dark resize-none focus:outline-none focus:ring-2 focus:ring-gold/50"
              />
              <span className="block text-right text-[11px] text-dark-500">{note.length}/{NOTE_MAX}</span>
            </label>

            {error && <p role="alert" className="mt-2 text-sm text-red-400">{error}</p>}

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-dark-600 hover:text-[#FAFAFA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                disabled={!reason || sending}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-gold to-gold-hover text-dark text-sm font-medium hover:shadow-[0_0_12px_rgba(212,165,116,0.3)] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 transition-all"
              >
                {sending && <Loader2 className="size-4 animate-spin" />}
                Send
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
