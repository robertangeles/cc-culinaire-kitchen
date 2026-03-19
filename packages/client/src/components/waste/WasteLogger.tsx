/**
 * @module components/waste/WasteLogger
 *
 * Quick waste logging form — mobile-first, minimal friction.
 * Includes ingredient autocomplete (debounced 300ms), quantity/unit,
 * optional reason/shift/cost/notes, and a list of recent logs.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Trash2, Plus, Check, Loader2, X } from "lucide-react";

const UNITS = ["g", "kg", "ml", "L", "each", "bunch", "portion"] as const;

const REASONS = [
  "",
  "Overproduction",
  "Spoilage",
  "Trim/Peel",
  "Plate Waste",
  "Contamination",
  "Expired",
  "Other",
] as const;

const SHIFTS = ["", "Breakfast", "Lunch", "Dinner", "Prep", "Other"] as const;

interface WasteLog {
  wasteLogId: string;
  ingredientName: string;
  quantity: number;
  unit: string;
  reason: string | null;
  shift: string | null;
  estimatedCost: number | null;
  notes: string | null;
  loggedAt: string;
}

export function WasteLogger() {
  // Form state
  const [ingredientName, setIngredientName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<string>("g");
  const [reason, setReason] = useState("");
  const [shift, setShift] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [notes, setNotes] = useState("");

  // Autocomplete
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Recent logs
  const [recentLogs, setRecentLogs] = useState<WasteLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);

  // Fetch recent logs
  const fetchRecentLogs = useCallback(async () => {
    try {
      const res = await fetch("/api/waste?limit=10", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setRecentLogs(data.logs ?? []);
      }
    } catch {
      // silent
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  useEffect(() => {
    fetchRecentLogs();
  }, [fetchRecentLogs]);

  // Autocomplete debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (ingredientName.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/waste/suggestions?q=${encodeURIComponent(ingredientName.trim())}`,
          { credentials: "include" },
        );
        if (res.ok) {
          const data = await res.json();
          setSuggestions(data.ingredients ?? []);
          setShowSuggestions(true);
        }
      } catch {
        // silent
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [ingredientName]);

  function selectSuggestion(name: string) {
    setIngredientName(name);
    setShowSuggestions(false);
    setSuggestions([]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ingredientName.trim() || !quantity) return;

    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const body: Record<string, unknown> = {
        ingredientName: ingredientName.trim(),
        quantity: Number(quantity),
        unit,
      };
      if (reason) body.reason = reason;
      if (shift) body.shift = shift;
      if (estimatedCost) body.estimatedCost = Number(estimatedCost);
      if (notes.trim()) body.notes = notes.trim();

      const res = await fetch("/api/waste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Failed (${res.status})`);
      }

      // Clear form
      setIngredientName("");
      setQuantity("");
      setUnit("g");
      setReason("");
      setShift("");
      setEstimatedCost("");
      setNotes("");
      setSuccessMessage("Waste logged successfully");
      setTimeout(() => setSuccessMessage(null), 3000);

      // Refresh recent logs
      fetchRecentLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(wasteLogId: string) {
    try {
      const res = await fetch(`/api/waste/${wasteLogId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        setRecentLogs((prev) => prev.filter((l) => l.wasteLogId !== wasteLogId));
      }
    } catch {
      // silent
    }
  }

  return (
    <div>
      {/* Success toast */}
      {successMessage && (
        <div className="mb-4 flex items-center gap-2 bg-green-900/50 border border-green-700 rounded-lg p-3">
          <Check className="size-4 text-green-400 shrink-0" />
          <p className="text-sm text-green-300">{successMessage}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 flex items-center gap-2 bg-red-900/50 border border-red-700 rounded-lg p-3">
          <X className="size-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <h2 className="text-lg font-semibold text-white mb-4">Log Waste</h2>

        {/* Ingredient name with autocomplete */}
        <div className="mb-4 relative">
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Ingredient <span className="text-amber-500">*</span>
          </label>
          <input
            ref={inputRef}
            type="text"
            value={ingredientName}
            onChange={(e) => setIngredientName(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            placeholder="e.g. Salmon, Tomatoes, Cream..."
            className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm"
            required
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute z-10 w-full mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg max-h-40 overflow-y-auto">
              {suggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onMouseDown={() => selectSuggestion(s)}
                    className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-gray-600 transition-colors"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Quantity + Unit row */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Quantity <span className="text-amber-500">*</span>
            </label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0"
              min="0"
              step="any"
              className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Unit</label>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm"
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Reason + Shift row */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Reason</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm"
            >
              {REASONS.map((r) => (
                <option key={r} value={r}>{r || "-- Select --"}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Shift</label>
            <select
              value={shift}
              onChange={(e) => setShift(e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm"
            >
              {SHIFTS.map((s) => (
                <option key={s} value={s}>{s || "-- Select --"}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Estimated cost */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-1">Estimated Cost ($)</label>
          <input
            type="number"
            value={estimatedCost}
            onChange={(e) => setEstimatedCost(e.target.value)}
            placeholder="0.00"
            min="0"
            step="0.01"
            className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm"
          />
        </div>

        {/* Notes */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-300 mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional details..."
            rows={2}
            className="w-full px-3 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm resize-none"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting || !ingredientName.trim() || !quantity}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors text-base min-h-[44px]"
        >
          {submitting ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <>
              <Plus className="size-5" />
              Log Waste
            </>
          )}
        </button>
      </form>

      {/* Recent logs */}
      <div className="mt-8">
        <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">Recent Logs</h3>

        {loadingLogs && (
          <div className="flex justify-center py-8">
            <Loader2 className="size-6 animate-spin text-amber-500" />
          </div>
        )}

        {!loadingLogs && recentLogs.length === 0 && (
          <div className="text-center py-8">
            <Trash2 className="size-8 mx-auto text-gray-600 mb-2" />
            <p className="text-gray-500 text-sm">No waste logged yet. Start tracking above.</p>
          </div>
        )}

        {!loadingLogs && recentLogs.length > 0 && (
          <div className="space-y-2">
            {recentLogs.map((log) => (
              <div
                key={log.wasteLogId}
                className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3 border border-gray-700"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm font-medium truncate">
                    {log.ingredientName}{" "}
                    <span className="text-gray-400 font-normal">
                      — {log.quantity} {log.unit}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {log.reason && <span className="mr-3">{log.reason}</span>}
                    {log.shift && <span className="mr-3">{log.shift}</span>}
                    {log.estimatedCost != null && (
                      <span className="mr-3">${Number(log.estimatedCost).toFixed(2)}</span>
                    )}
                    {new Date(log.loggedAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(log.wasteLogId)}
                  className="ml-3 p-2 text-gray-500 hover:text-red-400 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                  title="Delete log"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
