/**
 * @module components/roster/PublishPanel
 *
 * Publishing a roster always discloses Award-engine coverage — what was
 * checked and what was explicitly NOT checked — with the SAME visual
 * weight whether or not any warning fired. An empty warning list is not
 * itself a green light: without this disclosure, silence would read as
 * "the system verified this roster is compliant," which is false when (as
 * today) zero award_rule rows exist to check against. CoverageDisclosure
 * below takes no `warnings` prop at all, so it structurally cannot vary
 * based on whether any fired.
 *
 * Compliance-document holds (heldShifts) are a hard gate, never published —
 * distinct from Award warnings (awardWarnings), which are advisory only and
 * never block.
 */

import { useState } from "react";
import { AlertTriangle, Check, Loader2, ShieldAlert, X } from "lucide-react";
import { usePublish, type AwardCoverage, type PublishResult } from "../../hooks/useRoster.js";

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function CoverageDisclosure({ coverage }: { coverage: AwardCoverage }) {
  const total = coverage.checked.length + coverage.notChecked.length;
  return (
    <div className="rounded-lg border border-dark-200 bg-dark-100 px-4 py-3">
      <div className="flex items-start gap-2">
        <ShieldAlert className="size-4 text-gold shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-white">
            Checked {coverage.checked.length} of {total} Award rostering rule categories.
          </p>
          <p className="mt-1 text-xs text-dark-600">
            <span className="text-dark-500">NOT checked:</span> {coverage.notChecked.join(", ")}.
          </p>
          {coverage.checked.length > 0 && (
            <p className="mt-1 text-xs text-dark-600">
              <span className="text-dark-500">Checked:</span> {coverage.checked.join(", ")}.
            </p>
          )}
          <p className="mt-2 text-xs text-dark-500">
            Pay rates, penalties, allowances, and loadings are never checked by CulinAIre — verify those separately.
          </p>
        </div>
      </div>
    </div>
  );
}

export function PublishPanel({
  storeLocationId,
  onClose,
  onPublished,
}: {
  storeLocationId: string;
  onClose: () => void;
  /** Called once publish succeeds — lets the caller refresh its own shift list (status flips Draft -> Published). */
  onPublished?: () => void;
}) {
  const { publish, isPublishing } = usePublish();
  const [from, setFrom] = useState(() => addDaysIso(0));
  const [to, setTo] = useState(() => addDaysIso(7));
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePublish() {
    setError(null);
    try {
      const r = await publish(storeLocationId, from, to);
      setResult(r);
      onPublished?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish roster");
    }
  }

  return (
    <div className="rounded-xl border border-gold/20 bg-dark-50 p-4 animate-scale-in space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Publish roster</h3>
        <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-dark-200 text-dark-500 hover:text-white transition-all" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>

      {!result && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-dark-600">
              From
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
              />
            </label>
            <label className="text-xs text-dark-600">
              To
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
              />
            </label>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            type="button"
            onClick={handlePublish}
            disabled={isPublishing}
            className="flex items-center gap-1.5 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-dark transition-all hover:bg-gold-hover disabled:opacity-50"
          >
            {isPublishing && <Loader2 className="size-3.5 animate-spin" />}
            Publish
          </button>
        </>
      )}

      {result && (
        <div className="space-y-4 animate-fade-in">
          <CoverageDisclosure coverage={result.awardCoverage} />

          {result.awardWarnings.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-dark-500 uppercase tracking-wider">Advisory warnings — never block publish</p>
              {result.awardWarnings.map((w, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-300"
                >
                  <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
                  {w.message}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 text-sm text-white">
            <Check className="size-4 text-emerald-400" aria-hidden="true" />
            {result.publishedShiftIds.length} shift{result.publishedShiftIds.length === 1 ? "" : "s"} published
          </div>

          {result.heldShifts.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-dark-500 uppercase tracking-wider">
                Held back — not published, missing compliance requirements
              </p>
              {result.heldShifts.map((h) => (
                <div
                  key={h.shiftId}
                  className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-300"
                >
                  {h.reason}
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-dark-200 px-4 py-2 text-sm text-white hover:bg-dark-300 transition-all"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
