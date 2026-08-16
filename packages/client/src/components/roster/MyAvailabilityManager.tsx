/**
 * @module components/roster/MyAvailabilityManager
 *
 * Staff self-service: set the recurring windows you're available to work.
 * Own-only — the server enforces this (roster:read-own, ownership-checked),
 * this component never lets you touch anyone else's row.
 */

import { useState } from "react";
import { CalendarClock, Loader2, Plus, Trash2 } from "lucide-react";
import { useMyAvailability } from "../../hooks/useRoster.js";
import { EmptyState } from "../ui/EmptyState.js";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function MyAvailabilityManager() {
  const { availability, isLoading, error, create, remove } = useMyAvailability();
  const [showAdd, setShowAdd] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [availableFrom, setAvailableFrom] = useState("09:00");
  const [availableUntil, setAvailableUntil] = useState("17:00");
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [effectiveUntil, setEffectiveUntil] = useState("");

  async function handleAdd() {
    setFormError(null);
    setSaving(true);
    try {
      await create({
        dayOfWeek,
        availableFrom,
        availableUntil,
        effectiveFrom,
        effectiveUntil: effectiveUntil || null,
      });
      setShowAdd(false);
      setEffectiveUntil("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to add availability");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 text-gold animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <p className="text-sm text-dark-600">When you're generally available to work.</p>
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-gold to-gold-hover px-4 py-2 text-sm font-semibold text-dark transition-all hover:shadow-[0_0_12px_rgba(212,165,116,0.2)] active:scale-[0.98]"
        >
          <Plus className="size-4" /> Add
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {showAdd && (
        <div className="rounded-xl border border-gold/20 bg-dark-50 p-4 animate-scale-in">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs text-dark-600">
              Day
              <select
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
                className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
              >
                {DAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-dark-600">
                From
                <input
                  type="time"
                  value={availableFrom}
                  onChange={(e) => setAvailableFrom(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
                />
              </label>
              <label className="text-xs text-dark-600">
                Until
                <input
                  type="time"
                  value={availableUntil}
                  onChange={(e) => setAvailableUntil(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
                />
              </label>
            </div>
            <label className="text-xs text-dark-600">
              Starting from
              <input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
              />
            </label>
            <label className="text-xs text-dark-600">
              Until (optional)
              <input
                type="date"
                value={effectiveUntil}
                onChange={(e) => setEffectiveUntil(e.target.value)}
                className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
              />
            </label>
          </div>
          {formError && <p className="mt-2 text-sm text-red-400">{formError}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAdd(false)}
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

      {availability.length === 0 && !showAdd ? (
        <EmptyState
          icon={CalendarClock}
          title="No availability set yet"
          body="Add the windows you're generally free to work — managers use this when building the roster."
          action={{ label: "Add availability", onClick: () => setShowAdd(true) }}
        />
      ) : (
        <div className="rounded-xl border border-dark-200 overflow-hidden">
          {availability.map((a) => (
            <div
              key={a.staffAvailabilityId}
              className="flex items-center justify-between border-b border-dark-200/30 px-4 py-3 last:border-b-0"
            >
              <div className="text-sm">
                <span className="text-white font-medium">{DAYS[a.dayOfWeek]}</span>
                <span className="text-dark-600">
                  {" "}
                  {a.availableFrom}–{a.availableUntil}
                </span>
                <span className="text-dark-500 text-xs">
                  {" "}
                  from {a.effectiveFrom}
                  {a.effectiveUntil ? ` to ${a.effectiveUntil}` : ""}
                </span>
              </div>
              <button
                type="button"
                onClick={() => remove(a.staffAvailabilityId)}
                className="p-1.5 rounded-lg hover:bg-dark-200 text-dark-500 hover:text-red-400 transition-all"
                aria-label="Remove availability"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
