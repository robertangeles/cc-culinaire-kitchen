/**
 * @module components/settings/AwardRulesTab
 *
 * Administrator-only editor for `award_rule` — Fair Work award thresholds
 * (e.g. "max ordinary hours = 38, national, effective 1 July 2026"). Ships
 * with zero rows by design (see awardRuleService.ts's header comment); this
 * tab is the infrastructure a named IR-competent owner will eventually use,
 * not gated on that owner existing yet.
 *
 * Server-side write function auto-supersedes: creating a rule for a
 * (ruleType, jurisdiction) that already has an active row transparently
 * closes the old one — this drawer's Create and Edit are the same action
 * from the data's perspective, matching that design (Section 1 of the plan).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Loader2, RotateCcw, Scale, Upload } from "lucide-react";
import { EmptyState } from "../ui/EmptyState.js";
import { RuleDrawer } from "./RuleDrawer.js";
import { useRuleDrawer } from "./useRuleDrawer.js";
import {
  listAwardRules,
  upsertAwardRule,
  previewAwardRuleCsv,
  commitAwardRuleCsvImport,
  AWARD_RULE_TYPES,
  AU_JURISDICTIONS,
  type AwardRule,
  type NewAwardRule,
  type CsvImportPreview,
  type CsvImportCommitResult,
} from "../../hooks/useRoster.js";

type ListState = "loading" | "error" | "ready";

const emptyForm = {
  awardCode: "MA000009",
  ruleType: AWARD_RULE_TYPES[0] as string,
  jurisdiction: "",
  thresholdValue: "",
  effectiveFrom: "",
  sourceCitation: "",
};

function formatRuleType(ruleType: string): string {
  return ruleType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function AwardRulesTab() {
  const [status, setStatus] = useState<ListState>("loading");
  const [rules, setRules] = useState<AwardRule[]>([]);
  const {
    open: drawerOpen,
    setOpen: setDrawerOpen,
    form,
    setForm,
    saveError,
    setSaveError,
    saving,
    setSaving,
    openDrawer,
    closeDrawer,
  } = useRuleDrawer(emptyForm);

  const [importDrawerOpen, setImportDrawerOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<CsvImportPreview | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<CsvImportCommitResult | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      setRules(await listAwardRules());
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openImportDrawer() {
    setImportPreview(null);
    setImportError(null);
    setImportResult(null);
    setImportDrawerOpen(true);
  }

  function closeImportDrawer() {
    setImportDrawerOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportResult(null);
    try {
      setImportPreview(await previewAwardRuleCsv(file));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to preview CSV");
      setImportPreview(null);
    }
  }

  async function handleImportCommit() {
    if (!importPreview || importPreview.valid.length === 0) return;
    setImporting(true);
    setImportError(null);
    try {
      const result = await commitAwardRuleCsvImport(importPreview.valid);
      setImportResult(result);
      setImportPreview(null);
      await load();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to commit CSV import");
    } finally {
      setImporting(false);
    }
  }

  async function handleSave() {
    setSaveError(null);
    const thresholdValue = Number(form.thresholdValue);
    if (!form.awardCode.trim()) {
      setSaveError("An award code is required");
      return;
    }
    if (!form.effectiveFrom) {
      setSaveError("An effective-from date is required");
      return;
    }
    if (!Number.isFinite(thresholdValue) || thresholdValue <= 0) {
      setSaveError("Threshold value must be a positive number");
      return;
    }

    const input: NewAwardRule = {
      awardCode: form.awardCode.trim(),
      ruleType: form.ruleType,
      jurisdiction: form.jurisdiction || null,
      thresholdValue,
      effectiveFrom: form.effectiveFrom,
      sourceCitation: form.sourceCitation.trim() || null,
    };

    setSaving(true);
    try {
      await upsertAwardRule(input);
      setDrawerOpen(false);
      await load();
    } catch (err) {
      // Inline error inside the open drawer, form values kept — a failed
      // save must never blow away what the user already typed.
      setSaveError(err instanceof Error ? err.message : "Couldn't save this rule — try again");
    } finally {
      setSaving(false);
    }
  }

  if (status === "error") {
    return (
      <div role="alert" className="m-6 rounded-xl border border-dark-200 bg-dark-100 px-4 py-10 text-center">
        <p className="text-sm text-[#E5E5E5]">We couldn&apos;t load the award rules. Please try again.</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-dark transition-all duration-200 hover:-translate-y-0.5 hover:bg-gold-hover"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-[#FAFAFA]">Award Rules</h2>
            <span className="rounded-full border border-gold/30 px-2 py-0.5 text-xs text-gold">
              Administrator only
            </span>
          </div>
          <p className="mt-1 text-sm text-dark-600">
            Define and manage award rules that drive pay conditions and compliance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openImportDrawer}
            className="flex items-center gap-1.5 rounded-lg border border-dark-200 px-4 py-2 text-sm text-dark-600 transition-all hover:border-gold/30 hover:text-white"
          >
            <Upload className="size-4" /> Import CSV
          </button>
          <button
            type="button"
            onClick={openDrawer}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-gold to-gold-hover px-4 py-2 text-sm font-semibold text-dark transition-all hover:shadow-[0_0_12px_rgba(212,165,116,0.2)] active:scale-[0.98]"
          >
            <Plus className="size-4" /> Add Rule
          </button>
        </div>
      </div>

      {status === "loading" && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-gold" />
        </div>
      )}

      {status === "ready" && rules.length === 0 && (
        <EmptyState
          icon={Scale}
          title="No award rules yet"
          body="Award rules define pay conditions and compliance thresholds. Add your first rule to get started."
        />
      )}

      {status === "ready" && rules.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-dark-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-200 text-left text-xs text-dark-600">
                <th className="px-4 py-3 font-medium">Award Code</th>
                <th className="px-4 py-3 font-medium">Rule Type</th>
                <th className="px-4 py-3 font-medium">Jurisdiction</th>
                <th className="px-4 py-3 font-medium">Threshold</th>
                <th className="px-4 py-3 font-medium">Effective From</th>
                <th className="px-4 py-3 font-medium">Source Citation</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr
                  key={r.awardRuleId}
                  className="border-b border-dark-200/30 text-[#E5E5E5] transition-all last:border-b-0 hover:-translate-y-0.5 hover:bg-dark-100/60"
                >
                  <td className="px-4 py-3">{r.awardCode}</td>
                  <td className="px-4 py-3">{formatRuleType(r.ruleType)}</td>
                  <td className="px-4 py-3">{r.jurisdiction ?? "National"}</td>
                  <td className="px-4 py-3">{r.thresholdValue}</td>
                  <td className="px-4 py-3">{r.effectiveFrom}</td>
                  <td className="px-4 py-3">{r.sourceCitation ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RuleDrawer
        open={drawerOpen}
        title="Add Award Rule"
        onClose={closeDrawer}
        footer={
          <>
            <button
              type="button"
              onClick={closeDrawer}
              className="rounded-lg px-4 py-2 text-sm text-dark-600 transition-all hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-dark transition-all duration-200 hover:-translate-y-0.5 hover:bg-gold-hover disabled:opacity-50"
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              Save
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {saveError && (
            <p role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-400">
              {saveError}
            </p>
          )}
          <label className="block text-xs text-dark-600">
            Award Code
            <input
              type="text"
              value={form.awardCode}
              onChange={(e) => setForm((f) => ({ ...f, awardCode: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-dark-200 bg-dark-100 px-3 py-2 text-sm text-white focus:border-gold/50 focus:outline-none"
            />
          </label>
          <label className="block text-xs text-dark-600">
            Rule Type
            <select
              value={form.ruleType}
              onChange={(e) => setForm((f) => ({ ...f, ruleType: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-dark-200 bg-dark-100 px-3 py-2 text-sm text-white focus:border-gold/50 focus:outline-none"
            >
              {AWARD_RULE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {formatRuleType(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-dark-600">
            Jurisdiction
            <select
              value={form.jurisdiction}
              onChange={(e) => setForm((f) => ({ ...f, jurisdiction: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-dark-200 bg-dark-100 px-3 py-2 text-sm text-white focus:border-gold/50 focus:outline-none"
            >
              <option value="">National</option>
              {AU_JURISDICTIONS.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-dark-600">
            Threshold Value
            <input
              type="number"
              step="0.5"
              value={form.thresholdValue}
              onChange={(e) => setForm((f) => ({ ...f, thresholdValue: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-dark-200 bg-dark-100 px-3 py-2 text-sm text-white focus:border-gold/50 focus:outline-none"
            />
          </label>
          <label className="block text-xs text-dark-600">
            Effective From
            <input
              type="date"
              value={form.effectiveFrom}
              onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-dark-200 bg-dark-100 px-3 py-2 text-sm text-white focus:border-gold/50 focus:outline-none"
            />
          </label>
          <label className="block text-xs text-dark-600">
            Source Citation
            <input
              type="text"
              value={form.sourceCitation}
              onChange={(e) => setForm((f) => ({ ...f, sourceCitation: e.target.value }))}
              placeholder="e.g. MA000009 cl 32"
              className="mt-1 w-full rounded-lg border border-dark-200 bg-dark-100 px-3 py-2 text-sm text-white placeholder-dark-500 focus:border-gold/50 focus:outline-none"
            />
          </label>
        </div>
      </RuleDrawer>

      <RuleDrawer
        open={importDrawerOpen}
        title="Import Award Rules from CSV"
        onClose={closeImportDrawer}
        footer={
          <>
            <button
              type="button"
              onClick={closeImportDrawer}
              className="rounded-lg px-4 py-2 text-sm text-dark-600 transition-all hover:text-white"
            >
              {importResult ? "Close" : "Cancel"}
            </button>
            {importPreview && importPreview.valid.length > 0 && !importResult && (
              <button
                type="button"
                onClick={() => void handleImportCommit()}
                disabled={importing}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-dark transition-all duration-200 hover:-translate-y-0.5 hover:bg-gold-hover disabled:opacity-50"
              >
                {importing && <Loader2 className="size-3.5 animate-spin" />}
                Import {importPreview.valid.length} row{importPreview.valid.length === 1 ? "" : "s"}
              </button>
            )}
          </>
        }
      >
        <div className="space-y-3">
          {!importPreview && !importResult && (
            <>
              <p className="text-sm text-dark-600">
                Columns: awardCode, ruleType, jurisdiction (blank = national), thresholdValue, effectiveFrom, sourceCitation.
                A header row is optional.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                aria-label="CSV file"
                onChange={(e) => void handleFileSelected(e)}
                className="block w-full text-sm text-dark-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gold file:px-4 file:py-2 file:text-sm file:font-semibold file:text-dark hover:file:bg-gold-hover"
              />
            </>
          )}

          {importError && (
            <p role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-400">
              {importError}
            </p>
          )}

          {importPreview && (
            <div className="space-y-3">
              <p className="text-sm text-dark-600">
                {importPreview.valid.length} valid, {importPreview.invalid.length} invalid.
              </p>
              {importPreview.invalid.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-xs text-red-400">
                  {importPreview.invalid.map((row) => (
                    <li key={row.rowIndex}>
                      Row {row.rowIndex}: {row.reason}
                    </li>
                  ))}
                </ul>
              )}
              {importPreview.valid.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-dark-200 bg-dark-100 p-3 text-xs text-[#E5E5E5]">
                  {importPreview.valid.map((row) => (
                    <li key={row.rowIndex}>
                      Row {row.rowIndex}: {row.awardCode} — {formatRuleType(row.ruleType)} (
                      {row.jurisdiction ?? "National"}), {row.thresholdValue}, from {row.effectiveFrom}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {importResult && (
            <p className="rounded-lg border border-dark-200 bg-dark-100 px-3 py-2 text-sm text-[#E5E5E5]">
              Imported {importResult.imported}, skipped {importResult.skipped}.
              {importResult.errors.length > 0 && (
                <span className="mt-1 block text-red-400">
                  {importResult.errors.map((e) => `Row ${e.row}: ${e.reason}`).join("; ")}
                </span>
              )}
            </p>
          )}
        </div>
      </RuleDrawer>
    </div>
  );
}
