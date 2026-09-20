/**
 * @module components/roster/PublicHolidaysTab
 *
 * Admin loader for the gazetted public-holiday calendar (Fair Work s.114).
 * Deliberately clerical: a human enters each jurisdiction+year's dates once
 * a year. There is no bulk auto-population — publishRoster() fail-loud
 * blocks with "Public holidays for VIC 2027 are not loaded." until someone
 * has loaded that jurisdiction+year here.
 *
 * Jurisdiction + Year are a client-side filter (dataset is small — no
 * server-side pagination needed) so the list never renders more than one
 * jurisdiction/year at a time. See docs/specs/public-holidays-filters-plan.md
 * for the full design + eng review.
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
  isPartialDay: false,
  partialDayFromTime: "",
};

/**
 * Best default year: the current calendar year if it has loaded data, else
 * the nearest loaded year — ties (equidistant past/future) prefer the
 * future, since an admin here is almost always preparing upcoming rosters,
 * not auditing history. Zero loaded years anywhere falls back to the
 * current calendar year (the Year select's only option in that case).
 */
function pickDefaultYear(loadedYears: number[]): number {
  const currentYear = new Date().getFullYear();
  if (loadedYears.length === 0 || loadedYears.includes(currentYear)) {
    return currentYear;
  }
  return [...loadedYears].sort((a, b) => {
    const distanceDiff = Math.abs(a - currentYear) - Math.abs(b - currentYear);
    return distanceDiff !== 0 ? distanceDiff : b - a; // tie: prefer future (larger year)
  })[0];
}

/** "2026-01-01" -> "Thu, 1 Jan 2026". Matches the approved mockup. */
function formatHolidayDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * organisation.default_jurisdiction — admin-settable via Settings ->
 * Organisation -> Branding, already returned by GET /api/organisations/mine
 * but not otherwise exposed to any client hook/context. Failures (network,
 * no org membership) degrade to null -> NSW fallback rather than blocking
 * the page; this is a nice-to-have default, not required data.
 */
async function fetchOrgDefaultJurisdiction(): Promise<string | null> {
  try {
    const res = await fetch("/api/organisations/mine", { credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    return data.organisation?.defaultJurisdiction || null;
  } catch {
    return null;
  }
}

export function PublicHolidaysTab() {
  const canManage = useHasPermission()("roster:manage");
  const [status, setStatus] = useState<Status>("loading");
  const [holidays, setHolidays] = useState<PublicHoliday[]>([]);
  const [activeJurisdiction, setActiveJurisdiction] = useState(JURISDICTIONS[0]);
  const [activeYear, setActiveYear] = useState(new Date().getFullYear());
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const [loaded, orgDefaultJurisdiction] = await Promise.all([
        listPublicHolidays(),
        fetchOrgDefaultJurisdiction(),
      ]);
      setHolidays(loaded);
      // Guard against a stale/unexpected default_jurisdiction value (e.g. a
      // jurisdiction no longer in the list) — an unmatched value would leave
      // no pill selected and permanently filter the table to empty.
      setActiveJurisdiction(
        orgDefaultJurisdiction && (JURISDICTIONS as string[]).includes(orgDefaultJurisdiction)
          ? orgDefaultJurisdiction
          : JURISDICTIONS[0],
      );
      setActiveYear(pickDefaultYear([...new Set(loaded.map((h) => h.loadedForYear))]));
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openAdd() {
    setForm({ ...emptyForm, jurisdiction: activeJurisdiction });
    setShowAdd(true);
  }

  function cancelAdd() {
    setShowAdd(false);
    setForm({ ...emptyForm, jurisdiction: activeJurisdiction });
    setFormError(null);
  }

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
    if (form.isPartialDay && !form.partialDayFromTime) {
      setFormError("A start time is required for a partial-day holiday");
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
        partialDayFromTime: form.isPartialDay ? form.partialDayFromTime : null,
      });
      setHolidays((prev) => [...prev, created]);
      // Jump the active filter to match, so a save outside the previous
      // filter is never silently invisible — the whole reason this exists.
      setActiveJurisdiction(created.jurisdiction);
      setActiveYear(created.loadedForYear);
      setForm({ ...emptyForm, jurisdiction: created.jurisdiction });
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

  const loadedYears = [...new Set(holidays.map((h) => h.loadedForYear))].sort((a, b) => b - a);
  const yearOptions = loadedYears.length > 0 ? loadedYears : [new Date().getFullYear()];
  const filteredHolidays = holidays
    .filter((h) => h.jurisdiction === activeJurisdiction && h.loadedForYear === activeYear)
    .sort((a, b) => a.holidayDate.localeCompare(b.holidayDate));
  const isGloballyEmpty = holidays.length === 0;

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
            onClick={() => (showAdd ? cancelAdd() : openAdd())}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-gold to-gold-hover px-4 py-2 text-sm font-semibold text-dark transition-all hover:shadow-[0_0_12px_rgba(212,165,116,0.2)] active:scale-[0.98]"
          >
            <Plus className="size-4" /> Add holiday
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div>
          <p className="mb-2 text-xs font-medium text-dark-600">Jurisdiction</p>
          <div
            role="tablist"
            aria-label="Jurisdiction filter"
            className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-dark-200 bg-dark-50 p-1"
          >
            {JURISDICTIONS.map((j) => (
              <button
                key={j}
                type="button"
                role="tab"
                aria-selected={activeJurisdiction === j}
                onClick={() => setActiveJurisdiction(j)}
                className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                  activeJurisdiction === j
                    ? "bg-gold text-dark"
                    : "text-dark-600 hover:bg-dark-100/50 hover:text-white"
                }`}
              >
                {j}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-2 block text-xs font-medium text-dark-600" htmlFor="public-holidays-year">
            Year
          </label>
          <select
            id="public-holidays-year"
            value={activeYear}
            onChange={(e) => setActiveYear(Number(e.target.value))}
            className="rounded-lg border border-dark-200 bg-dark-100 px-3 py-2 text-sm text-white focus:border-gold/50 focus:outline-none"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {showAdd && (
        <div className="rounded-xl border border-gold/20 bg-dark-50 p-4 animate-scale-in space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-dark-600">
              Jurisdiction
              <select
                aria-label="Holiday jurisdiction"
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
          <label className="flex items-center gap-2 text-xs text-dark-600">
            <input
              type="checkbox"
              checked={form.isPartialDay}
              onChange={(e) => setForm((f) => ({ ...f, isPartialDay: e.target.checked }))}
              className="size-4 rounded border-dark-300 bg-dark accent-gold focus:outline-none focus:ring-2 focus:ring-gold-ring"
            />
            Partial day (only from a given time until midnight)
          </label>
          {form.isPartialDay && (
            <label className="block text-xs text-dark-600">
              Applies from
              <input
                type="time"
                value={form.partialDayFromTime}
                onChange={(e) => setForm((f) => ({ ...f, partialDayFromTime: e.target.value }))}
                className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
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
              onClick={cancelAdd}
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

      {filteredHolidays.length === 0 && !showAdd ? (
        <EmptyState
          icon={CalendarOff}
          variant={isGloballyEmpty ? "invitation" : "no-match"}
          title={isGloballyEmpty ? "No public holidays loaded" : "No holidays loaded"}
          body={
            isGloballyEmpty
              ? "Publishing a roster will block until the venue's jurisdiction and year are loaded here."
              : `No holidays loaded for ${activeJurisdiction} in ${activeYear}.`
          }
          action={canManage ? { label: "Add a holiday", onClick: openAdd } : undefined}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-dark-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-200/30 text-xs uppercase tracking-wider text-dark-600">
                  <th scope="col" className="px-4 py-3 text-left font-semibold">
                    Jurisdiction
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold">
                    Holiday
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold">
                    Date
                  </th>
                  <th scope="col" className="px-4 py-3 text-left font-semibold">
                    Tags
                  </th>
                  {canManage && <th scope="col" className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody>
                {filteredHolidays.map((h) => (
                  <tr
                    key={h.publicHolidayId}
                    className="border-b border-dark-200/30 last:border-b-0 hover:bg-dark-100/40 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="rounded-full border border-dark-300 px-2 py-0.5 text-xs text-dark-600">
                        {h.jurisdiction}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-white">{h.holidayName}</td>
                    <td className="px-4 py-3 text-dark-600">{formatHolidayDate(h.holidayDate)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {h.isRegional && (
                          <span className="rounded-full border border-gold/30 px-2 py-0.5 text-xs text-gold">
                            Regional
                          </span>
                        )}
                        {h.partialDayFromTime && (
                          <span className="rounded-full border border-gold/30 px-2 py-0.5 text-xs text-gold">
                            From {h.partialDayFromTime}
                          </span>
                        )}
                      </div>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
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
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-dark-600">
            Showing {filteredHolidays.length} holiday{filteredHolidays.length === 1 ? "" : "s"} for{" "}
            {activeJurisdiction} in {activeYear}.
          </p>
        </>
      )}
    </div>
  );
}
