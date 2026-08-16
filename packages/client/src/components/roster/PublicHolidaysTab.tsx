/**
 * @module components/roster/PublicHolidaysTab
 *
 * Admin loader for the gazetted public-holiday calendar (Fair Work s.114).
 * Deliberately clerical: a human enters each jurisdiction+year's dates once
 * a year. There is no bulk auto-population — publishRoster() fail-loud
 * blocks with "Public holidays for VIC 2027 are not loaded." until someone
 * has loaded that jurisdiction+year here.
 */

import { useCallback, useEffect, useState } from "react";
import { CalendarOff, Loader2, Plus, Trash2 } from "lucide-react";
import { useHasPermission } from "../../hooks/useHasPermission.js";
import {
  listPublicHolidays,
  createPublicHoliday,
  deletePublicHoliday,
  type PublicHoliday,
} from "../../hooks/useRoster.js";
import { EmptyState } from "../ui/EmptyState.js";

const JURISDICTIONS = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];

type Status = "loading" | "error" | "ready";

const emptyForm = {
  jurisdiction: JURISDICTIONS[0],
  holidayDate: "",
  holidayName: "",
  isRegional: false,
  regionNote: "",
  sourceCitation: "",
};

export function PublicHolidaysTab() {
  const canManage = useHasPermission()("roster:manage");
  const [status, setStatus] = useState<Status>("loading");
  const [holidays, setHolidays] = useState<PublicHoliday[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      setHolidays(await listPublicHolidays());
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd() {
    setFormError(null);
    const year = Number(form.holidayDate.slice(0, 4));
    if (!form.holidayDate || Number.isNaN(year)) {
      setFormError("A valid date is required");
      return;
    }
    if (!form.holidayName.trim()) {
      setFormError("Holiday name is required");
      return;
    }
    setSaving(true);
    try {
      const created = await createPublicHoliday({
        jurisdiction: form.jurisdiction,
        holidayDate: form.holidayDate,
        holidayName: form.holidayName.trim(),
        isRegional: form.isRegional,
        regionNote: form.regionNote.trim() || null,
        sourceCitation: form.sourceCitation.trim() || null,
        loadedForYear: year,
      });
      setHolidays((prev) => [...prev, created].sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction) || a.holidayDate.localeCompare(b.holidayDate)));
      setForm(emptyForm);
      setShowAdd(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to add public holiday");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deletePublicHoliday(id);
      setHolidays((prev) => prev.filter((h) => h.publicHolidayId !== id));
    } catch {
      // ponytail: silent no-op on failed delete, row simply stays — add a
      // toast if this turns out to be confusing in practice.
    } finally {
      setDeletingId(null);
    }
  }

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center p-6 py-16">
        <Loader2 className="size-6 animate-spin text-gold" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div role="alert" className="m-6 rounded-xl border border-dark-200 bg-dark-100 px-4 py-10 text-center">
        <p className="text-sm text-[#E5E5E5]">We couldn&apos;t load the public holiday calendar. Please try again.</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-dark transition-all duration-200 hover:-translate-y-0.5 hover:bg-gold-hover"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#FAFAFA]">Public Holidays</h2>
          <p className="mt-1 text-sm text-dark-600">
            Gazetted public holidays by state. Publishing a roster into a jurisdiction and year with
            nothing loaded here is blocked — load each year&apos;s dates once they&apos;re declared.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-gold to-gold-hover px-4 py-2 text-sm font-semibold text-dark transition-all hover:shadow-[0_0_12px_rgba(212,165,116,0.2)] active:scale-[0.98]"
          >
            <Plus className="size-4" /> Add holiday
          </button>
        )}
      </div>

      {showAdd && (
        <div className="rounded-xl border border-gold/20 bg-dark-50 p-4 animate-scale-in space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-dark-600">
              Jurisdiction
              <select
                value={form.jurisdiction}
                onChange={(e) => setForm((f) => ({ ...f, jurisdiction: e.target.value }))}
                className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
              >
                {JURISDICTIONS.map((j) => (
                  <option key={j} value={j}>
                    {j}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-dark-600">
              Date
              <input
                type="date"
                value={form.holidayDate}
                onChange={(e) => setForm((f) => ({ ...f, holidayDate: e.target.value }))}
                className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
              />
            </label>
          </div>
          <label className="block text-xs text-dark-600">
            Holiday name
            <input
              type="text"
              value={form.holidayName}
              onChange={(e) => setForm((f) => ({ ...f, holidayName: e.target.value }))}
              placeholder="e.g. King's Birthday"
              className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white placeholder-dark-500 focus:outline-none focus:border-gold/50"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-dark-600">
            <input
              type="checkbox"
              checked={form.isRegional}
              onChange={(e) => setForm((f) => ({ ...f, isRegional: e.target.checked }))}
              className="size-4 rounded border-dark-300 bg-dark accent-gold focus:outline-none focus:ring-2 focus:ring-gold-ring"
            />
            Regional (not observed statewide)
          </label>
          {form.isRegional && (
            <label className="block text-xs text-dark-600">
              Region note
              <input
                type="text"
                value={form.regionNote}
                onChange={(e) => setForm((f) => ({ ...f, regionNote: e.target.value }))}
                placeholder="e.g. Metro Melbourne only"
                className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white placeholder-dark-500 focus:outline-none focus:border-gold/50"
              />
            </label>
          )}
          <label className="block text-xs text-dark-600">
            Source citation (optional)
            <input
              type="text"
              value={form.sourceCitation}
              onChange={(e) => setForm((f) => ({ ...f, sourceCitation: e.target.value }))}
              placeholder="e.g. business.vic.gov.au public holidays 2026"
              className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white placeholder-dark-500 focus:outline-none focus:border-gold/50"
            />
          </label>
          {formError && <p className="text-sm text-red-400">{formError}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowAdd(false);
                setForm(emptyForm);
                setFormError(null);
              }}
              className="rounded-lg px-4 py-2 text-sm text-dark-600 hover:text-white transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-dark transition-all hover:bg-gold-hover disabled:opacity-50"
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      )}

      {holidays.length === 0 && !showAdd ? (
        <EmptyState
          icon={CalendarOff}
          title="No public holidays loaded"
          body="Publishing a roster will block until the venue's jurisdiction and year are loaded here."
          action={canManage ? { label: "Add a holiday", onClick: () => setShowAdd(true) } : undefined}
        />
      ) : (
        <div className="rounded-xl border border-dark-200 overflow-hidden">
          {holidays.map((h) => (
            <div
              key={h.publicHolidayId}
              className="flex items-center justify-between gap-4 border-b border-dark-200/30 px-4 py-3 last:border-b-0"
            >
              <div className="flex items-center gap-3">
                <span className="rounded-full border border-dark-300 px-2 py-0.5 text-xs text-dark-600">
                  {h.jurisdiction}
                </span>
                <span className="text-sm text-white">{h.holidayName}</span>
                <span className="text-xs text-dark-600">{h.holidayDate}</span>
                {h.isRegional && (
                  <span className="rounded-full border border-gold/30 px-2 py-0.5 text-xs text-gold">Regional</span>
                )}
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => handleDelete(h.publicHolidayId)}
                  disabled={deletingId === h.publicHolidayId}
                  className="p-1.5 rounded-lg hover:bg-dark-200 text-dark-500 hover:text-red-400 transition-all disabled:opacity-50"
                  aria-label={`Remove ${h.holidayName}`}
                >
                  {deletingId === h.publicHolidayId ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
