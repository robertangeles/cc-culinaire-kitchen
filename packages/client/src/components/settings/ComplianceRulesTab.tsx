/**
 * @module components/settings/ComplianceRulesTab
 *
 * Administrator-only editor for `document_expiry_rule` — how long a
 * document type stays valid, and whether expiry blocks rostering. Backend
 * already complete (`upsertExpiryRule` in complianceService.ts, confirmed
 * during the Org Admin plan review) — this tab is the first thing that
 * ever calls `GET/PUT /api/compliance/rules`, both previously orphaned.
 *
 * Distinct from RequiredDocumentsTab (which document TYPES are required)
 * — this tab is about how long a required document stays valid once held.
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, Loader2, RotateCcw, Clock } from "lucide-react";
import { EmptyState } from "../ui/EmptyState.js";
import { RuleDrawer } from "./RuleDrawer.js";
import { AU_JURISDICTIONS } from "../../hooks/useRoster.js";

const API = import.meta.env.VITE_API_URL ?? "";

interface ExpiryRule {
  documentExpiryRuleId: string;
  documentType: string;
  jurisdiction: string | null;
  validityPeriodYears: number | null;
  blockRosterOnExpiry: boolean;
  trainingProviderUrl: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceCitation: string | null;
  notes: string | null;
  alertDays: number[];
}

interface NewExpiryRule {
  documentType: string;
  jurisdiction: string | null;
  validityPeriodYears: number | null;
  blockRosterOnExpiry: boolean;
  trainingProviderUrl: string | null;
  effectiveFrom: string;
  sourceCitation: string | null;
}

type ListState = "loading" | "error" | "ready";

const emptyForm = {
  documentType: "",
  jurisdiction: "",
  validityPeriodYears: "",
  blockRosterOnExpiry: false,
  trainingProviderUrl: "",
  effectiveFrom: "",
  sourceCitation: "",
};

async function fetchRules(): Promise<ExpiryRule[]> {
  const res = await fetch(`${API}/api/compliance/rules`, { credentials: "include" });
  if (!res.ok) throw new Error("Couldn't load document expiry rules.");
  return res.json();
}

async function saveRule(input: NewExpiryRule): Promise<ExpiryRule> {
  const res = await fetch(`${API}/api/compliance/rules`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Couldn't save this rule — try again");
  }
  return res.json();
}

export function ComplianceRulesTab() {
  const [status, setStatus] = useState<ListState>("loading");
  const [rules, setRules] = useState<ExpiryRule[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      setRules(await fetchRules());
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Active rows only — closed/superseded rows are history, visible via the
  // audit log, not this table (Section 11 design decision).
  const activeRules = rules.filter((r) => r.effectiveTo === null);

  function openDrawer() {
    setForm(emptyForm);
    setSaveError(null);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
  }

  async function handleSave() {
    setSaveError(null);
    if (!form.documentType.trim()) {
      setSaveError("A document type is required");
      return;
    }
    if (!form.effectiveFrom) {
      setSaveError("An effective-from date is required");
      return;
    }

    const input: NewExpiryRule = {
      documentType: form.documentType.trim(),
      jurisdiction: form.jurisdiction || null,
      validityPeriodYears: form.validityPeriodYears ? Number(form.validityPeriodYears) : null,
      blockRosterOnExpiry: form.blockRosterOnExpiry,
      trainingProviderUrl: form.trainingProviderUrl.trim() || null,
      effectiveFrom: form.effectiveFrom,
      sourceCitation: form.sourceCitation.trim() || null,
    };

    setSaving(true);
    try {
      await saveRule(input);
      setDrawerOpen(false);
      await load();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save this rule — try again");
    } finally {
      setSaving(false);
    }
  }

  if (status === "error") {
    return (
      <div role="alert" className="m-6 rounded-xl border border-dark-200 bg-dark-100 px-4 py-10 text-center">
        <p className="text-sm text-[#E5E5E5]">We couldn&apos;t load the document expiry rules. Please try again.</p>
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
            <h2 className="text-lg font-semibold text-[#FAFAFA]">Document Expiry Rules</h2>
            <span className="rounded-full border border-gold/30 px-2 py-0.5 text-xs text-gold">
              Administrator only
            </span>
          </div>
          <p className="mt-1 text-sm text-dark-600">
            Define how long a document type stays valid, and whether expiry blocks rostering.
          </p>
        </div>
        <button
          type="button"
          onClick={openDrawer}
          className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-gold to-gold-hover px-4 py-2 text-sm font-semibold text-dark transition-all hover:shadow-[0_0_12px_rgba(212,165,116,0.2)] active:scale-[0.98]"
        >
          <Plus className="size-4" /> Add Rule
        </button>
      </div>

      {status === "loading" && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-6 animate-spin text-gold" />
        </div>
      )}

      {status === "ready" && activeRules.length === 0 && (
        <EmptyState
          icon={Clock}
          title="No expiry rules yet"
          body="Document expiry rules control how long a document type stays valid. Add your first rule to get started."
        />
      )}

      {status === "ready" && activeRules.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-dark-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-200 text-left text-xs text-dark-600">
                <th className="px-4 py-3 font-medium">Document Type</th>
                <th className="px-4 py-3 font-medium">Jurisdiction</th>
                <th className="px-4 py-3 font-medium">Validity (years)</th>
                <th className="px-4 py-3 font-medium">Blocks Roster</th>
                <th className="px-4 py-3 font-medium">Effective From</th>
              </tr>
            </thead>
            <tbody>
              {activeRules.map((r) => (
                <tr
                  key={r.documentExpiryRuleId}
                  className="border-b border-dark-200/30 text-[#E5E5E5] transition-all last:border-b-0 hover:-translate-y-0.5 hover:bg-dark-100/60"
                >
                  <td className="px-4 py-3">{r.documentType}</td>
                  <td className="px-4 py-3">{r.jurisdiction ?? "National"}</td>
                  <td className="px-4 py-3">{r.validityPeriodYears ?? "Never expires"}</td>
                  <td className="px-4 py-3">{r.blockRosterOnExpiry ? "Yes" : "No"}</td>
                  <td className="px-4 py-3">{r.effectiveFrom}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RuleDrawer
        open={drawerOpen}
        title="Add Document Expiry Rule"
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
            Document Type
            <input
              type="text"
              value={form.documentType}
              onChange={(e) => setForm((f) => ({ ...f, documentType: e.target.value }))}
              placeholder="e.g. RSA"
              className="mt-1 w-full rounded-lg border border-dark-200 bg-dark-100 px-3 py-2 text-sm text-white placeholder-dark-500 focus:border-gold/50 focus:outline-none"
            />
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
            Validity Period (years)
            <input
              type="number"
              min="1"
              value={form.validityPeriodYears}
              onChange={(e) => setForm((f) => ({ ...f, validityPeriodYears: e.target.value }))}
              placeholder="Leave blank if it never expires"
              className="mt-1 w-full rounded-lg border border-dark-200 bg-dark-100 px-3 py-2 text-sm text-white placeholder-dark-500 focus:border-gold/50 focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-dark-600">
            <input
              type="checkbox"
              checked={form.blockRosterOnExpiry}
              onChange={(e) => setForm((f) => ({ ...f, blockRosterOnExpiry: e.target.checked }))}
              className="size-4 rounded border-dark-300 bg-dark accent-gold focus:outline-none focus:ring-2 focus:ring-gold-ring"
            />
            Block rostering when this document expires
          </label>
          <label className="block text-xs text-dark-600">
            Training Provider URL
            <input
              type="text"
              value={form.trainingProviderUrl}
              onChange={(e) => setForm((f) => ({ ...f, trainingProviderUrl: e.target.value }))}
              placeholder="https://..."
              className="mt-1 w-full rounded-lg border border-dark-200 bg-dark-100 px-3 py-2 text-sm text-white placeholder-dark-500 focus:border-gold/50 focus:outline-none"
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
              className="mt-1 w-full rounded-lg border border-dark-200 bg-dark-100 px-3 py-2 text-sm text-white focus:border-gold/50 focus:outline-none"
            />
          </label>
        </div>
      </RuleDrawer>
    </div>
  );
}
