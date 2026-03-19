/**
 * @module components/waste/WasteLogger
 *
 * Quick waste logging form — mobile-first, minimal friction.
 * Includes ingredient autocomplete (debounced 300ms), quantity/unit,
 * optional reason/shift/cost/notes, recent logs with inline editing,
 * daily totals, and quick-log buttons for frequent ingredients.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Trash2, Check, Loader2, X, Pencil, Scale, DollarSign, BarChart3 } from "lucide-react";
import { useAuth } from "../../context/AuthContext.js";
import type { WasteTab } from "../../pages/WasteIntelligencePage.js";

const UNITS = ["kg", "g", "L", "ml", "each", "portion", "bunch"] as const;

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
  loggedBy?: string | null;
  userId?: number;
}

interface DailyTotal {
  weight: number;
  cost: number;
}

interface Props {
  onSwitchTab: (tab: WasteTab) => void;
  teamView?: boolean;
  isOrgAdmin?: boolean;
}

/** Return a human-friendly relative time string */
function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr > 1 ? "s" : ""} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay} days ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function WasteLogger({ onSwitchTab, teamView = false, isOrgAdmin = false }: Props) {
  const { user } = useAuth();
  // Form state
  const [ingredientName, setIngredientName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState<string>("kg");
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
  const [successData, setSuccessData] = useState<{ name: string; qty: string; unit: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPostActions, setShowPostActions] = useState(false);

  // Recent logs
  const [recentLogs, setRecentLogs] = useState<WasteLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);

  // Daily total
  const [dailyTotal, setDailyTotal] = useState<DailyTotal | null>(null);

  // Quick-log (top 5 frequent ingredients)
  const [quickLogItems, setQuickLogItems] = useState<string[]>([]);

  // Inline editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Partial<WasteLog>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  // Fetch recent logs
  const fetchRecentLogs = useCallback(async () => {
    try {
      const teamParam = teamView ? "&teamView=true" : "";
      const res = await fetch(`/api/waste?limit=10${teamParam}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        const logs: WasteLog[] = data?.logs ?? [];
        setRecentLogs(logs);

        // Derive top-5 frequent ingredients for quick-log buttons
        const freq: Record<string, number> = {};
        for (const log of logs) {
          freq[log.ingredientName] = (freq[log.ingredientName] ?? 0) + 1;
        }
        const sorted = Object.entries(freq)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name]) => name);
        setQuickLogItems(sorted);
      }
    } catch {
      // silent
    } finally {
      setLoadingLogs(false);
    }
  }, [teamView]);

  // Fetch today's daily total from summary
  const fetchDailyTotal = useCallback(async () => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const teamParam = teamView ? "&teamView=true" : "";
      const res = await fetch(
        `/api/waste/summary?startDate=${today}&endDate=${today}${teamParam}`,
        { credentials: "include" },
      );
      if (res.ok) {
        const data = await res.json();
        setDailyTotal({
          weight: Number(data?.totalWeight ?? 0),
          cost: Number(data?.totalCost ?? 0),
        });
      }
    } catch {
      // silent
    }
  }, [teamView]);

  useEffect(() => {
    fetchRecentLogs();
    fetchDailyTotal();
  }, [fetchRecentLogs, fetchDailyTotal]);

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
          setSuggestions(data?.ingredients ?? []);
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

  function clearForm() {
    setIngredientName("");
    setQuantity("");
    setUnit("kg");
    setReason("");
    setShift("");
    setEstimatedCost("");
    setNotes("");
    setShowPostActions(false);
    setSuccessData(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ingredientName.trim() || !quantity) return;

    setSubmitting(true);
    setError(null);
    setSuccessData(null);
    setShowPostActions(false);

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

      // Save success info before clearing
      setSuccessData({ name: ingredientName.trim(), qty: quantity, unit });
      setShowPostActions(true);
      setTimeout(() => setSuccessData(null), 3000);

      // Refresh data
      fetchRecentLogs();
      fetchDailyTotal();
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
        fetchDailyTotal();
      }
    } catch {
      // silent
    }
  }

  function startEdit(log: WasteLog) {
    setEditingId(log.wasteLogId);
    setEditFields({
      ingredientName: log.ingredientName,
      quantity: log.quantity,
      unit: log.unit,
      estimatedCost: log.estimatedCost,
      reason: log.reason,
      shift: log.shift,
      notes: log.notes,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditFields({});
  }

  async function saveEdit(wasteLogId: string) {
    setSavingEdit(true);
    try {
      const body: Record<string, unknown> = {};
      if (editFields.ingredientName) body.ingredientName = editFields.ingredientName;
      if (editFields.quantity != null) body.quantity = Number(editFields.quantity);
      if (editFields.unit) body.unit = editFields.unit;
      if (editFields.estimatedCost != null) body.estimatedCost = Number(editFields.estimatedCost);
      if (editFields.reason !== undefined) body.reason = editFields.reason || null;
      if (editFields.shift !== undefined) body.shift = editFields.shift || null;
      if (editFields.notes !== undefined) body.notes = editFields.notes || null;

      const res = await fetch(`/api/waste/${wasteLogId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setEditingId(null);
        setEditFields({});
        fetchRecentLogs();
        fetchDailyTotal();
      }
    } catch {
      // silent
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div>
      {/* Daily total banner */}
      {dailyTotal && (dailyTotal.weight > 0 || dailyTotal.cost > 0) && (
        <div className="mb-4 flex items-center gap-4 bg-[#161616] border border-[#2A2A2A] rounded-xl p-4">
          <div className="flex items-center gap-2">
            <Scale className="size-4 text-[#D4A574]" />
            <span className="text-sm text-[#E5E5E5]">{teamView ? "Team today:" : "Today\u0027s waste:"}</span>
          </div>
          <span className="text-white font-semibold">{dailyTotal.weight.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg</span>
          <span className="text-[#666666]">|</span>
          <div className="flex items-center gap-1">
            <DollarSign className="size-3.5 text-[#D4A574]" />
            <span className="text-white font-semibold">{dailyTotal.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </div>
      )}

      {/* Success toast */}
      {successData && (
        <div className="mb-4 flex items-center gap-2 bg-emerald-900/50 border border-emerald-700 rounded-lg p-3">
          <Check className="size-4 text-emerald-400 shrink-0" />
          <p className="text-sm text-emerald-300">
            Logged! {successData.name} — {successData.qty} {successData.unit}
          </p>
        </div>
      )}

      {/* Post-log action buttons */}
      {showPostActions && (
        <div className="mb-4 flex gap-3">
          <button
            onClick={clearForm}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#161616] hover:bg-[#1E1E1E] text-white font-medium rounded-lg transition-colors border border-[#2A2A2A] min-h-[44px] text-sm"
          >
            Log Another
          </button>
          <button
            onClick={() => onSwitchTab("dashboard")}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#D4A574]/20 hover:bg-[#D4A574]/30 text-[#D4A574] font-medium rounded-lg transition-colors border border-[#D4A574]/30 min-h-[44px] text-sm"
          >
            <BarChart3 className="size-4" />
            View Dashboard
          </button>
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
      <form onSubmit={handleSubmit} className="bg-[#161616] rounded-xl p-6 border border-[#2A2A2A]">
        <h2 className="text-lg font-semibold text-white mb-4">Log Waste</h2>

        {/* Ingredient name with autocomplete */}
        <div className="mb-4 relative">
          <label className="block text-sm font-medium text-[#E5E5E5] mb-1">
            What did you throw away? <span className="text-[#D4A574]">*</span>
          </label>
          <input
            ref={inputRef}
            type="text"
            value={ingredientName}
            onChange={(e) => setIngredientName(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            placeholder="e.g., chicken trim, leftover risotto, wilted herbs"
            className="w-full px-3 py-2.5 bg-[#1E1E1E] border border-[#2A2A2A] rounded-lg text-white placeholder-[#666666] focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574] text-sm"
            required
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute z-10 w-full mt-1 bg-[#1E1E1E] border border-[#2A2A2A] rounded-lg shadow-lg max-h-40 overflow-y-auto">
              {suggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onMouseDown={() => selectSuggestion(s)}
                    className="w-full text-left px-3 py-2 text-sm text-[#E5E5E5] hover:bg-[#2A2A2A] transition-colors"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Quick-log buttons */}
        {quickLogItems.length > 0 && (
          <div className="mb-4">
            <p className="text-xs text-[#666666] mb-2">Quick log — your most common items:</p>
            <div className="flex flex-wrap gap-2">
              {quickLogItems.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setIngredientName(item)}
                  className="px-3 py-1.5 bg-[#1E1E1E] hover:bg-[#2A2A2A] text-[#E5E5E5] text-xs rounded-full border border-[#2A2A2A] transition-colors min-h-[36px]"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quantity + Unit row */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-sm font-medium text-[#E5E5E5] mb-1">
              How much? <span className="text-[#D4A574]">*</span>
            </label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0"
              min="0"
              step="any"
              className="w-full px-3 py-2.5 bg-[#1E1E1E] border border-[#2A2A2A] rounded-lg text-white placeholder-[#666666] focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574] text-sm"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Unit</label>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="w-full px-3 py-2.5 bg-[#1E1E1E] border border-[#2A2A2A] rounded-lg text-white focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574] text-sm"
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
            <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Why was it wasted?</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2.5 bg-[#1E1E1E] border border-[#2A2A2A] rounded-lg text-white focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574] text-sm"
            >
              {REASONS.map((r) => (
                <option key={r} value={r}>{r || "-- Select --"}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Which shift?</label>
            <select
              value={shift}
              onChange={(e) => setShift(e.target.value)}
              className="w-full px-3 py-2.5 bg-[#1E1E1E] border border-[#2A2A2A] rounded-lg text-white focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574] text-sm"
            >
              {SHIFTS.map((s) => (
                <option key={s} value={s}>{s || "-- Select --"}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Estimated cost */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Estimated Cost ($)</label>
          <input
            type="number"
            value={estimatedCost}
            onChange={(e) => setEstimatedCost(e.target.value)}
            placeholder="0.00"
            min="0"
            step="0.01"
            className="w-full px-3 py-2.5 bg-[#1E1E1E] border border-[#2A2A2A] rounded-lg text-white placeholder-[#666666] focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574] text-sm"
          />
        </div>

        {/* Notes */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional details..."
            rows={2}
            className="w-full px-3 py-2.5 bg-[#1E1E1E] border border-[#2A2A2A] rounded-lg text-white placeholder-[#666666] focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574] text-sm resize-none"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting || !ingredientName.trim() || !quantity}
          className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-[#D4A574] hover:bg-[#C4956A] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors text-base min-h-[48px]"
        >
          {submitting ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <>
              <Trash2 className="size-5" />
              Log Waste
            </>
          )}
        </button>
      </form>

      {/* Recent logs */}
      <div className="mt-8">
        <h3 className="text-sm font-medium text-[#999999] uppercase tracking-wider mb-3">Recent Logs</h3>

        {loadingLogs && (
          <div className="flex justify-center py-8">
            <Loader2 className="size-6 animate-spin text-[#D4A574]" />
          </div>
        )}

        {!loadingLogs && recentLogs.length === 0 && (
          <div className="text-center py-8">
            <Trash2 className="size-8 mx-auto text-[#666666] mb-2" />
            <p className="text-[#666666] text-sm">No waste logged yet. Start tracking above!</p>
          </div>
        )}

        {!loadingLogs && recentLogs.length > 0 && (
          <div className="space-y-2">
            {recentLogs.map((log) => {
              const isOwnEntry = !log.userId || log.userId === user?.userId;
              const canEditDelete = isOwnEntry || isOrgAdmin;

              return (
              <div
                key={log.wasteLogId}
                className={`bg-[#161616] rounded-lg px-4 py-3 border border-[#2A2A2A] ${
                  teamView && !isOwnEntry ? "border-l-2 border-l-blue-500/60" : ""
                }`}
              >
                {editingId === log.wasteLogId ? (
                  /* Inline edit mode */
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="text"
                        value={editFields.ingredientName ?? ""}
                        onChange={(e) => setEditFields({ ...editFields, ingredientName: e.target.value })}
                        className="px-2 py-1.5 bg-[#1E1E1E] border border-[#2A2A2A] rounded text-white text-sm"
                        placeholder="Ingredient"
                      />
                      <div className="flex gap-2">
                        <input
                          type="number"
                          value={editFields.quantity ?? ""}
                          onChange={(e) => setEditFields({ ...editFields, quantity: Number(e.target.value) })}
                          className="w-20 px-2 py-1.5 bg-[#1E1E1E] border border-[#2A2A2A] rounded text-white text-sm"
                          placeholder="Qty"
                          min="0"
                          step="any"
                        />
                        <select
                          value={editFields.unit ?? "kg"}
                          onChange={(e) => setEditFields({ ...editFields, unit: e.target.value })}
                          className="px-2 py-1.5 bg-[#1E1E1E] border border-[#2A2A2A] rounded text-white text-sm flex-1"
                        >
                          {UNITS.map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <select
                        value={editFields.reason ?? ""}
                        onChange={(e) => setEditFields({ ...editFields, reason: e.target.value })}
                        className="px-2 py-1.5 bg-[#1E1E1E] border border-[#2A2A2A] rounded text-white text-sm"
                      >
                        {REASONS.map((r) => (
                          <option key={r} value={r}>{r || "-- Reason --"}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        value={editFields.estimatedCost ?? ""}
                        onChange={(e) => setEditFields({ ...editFields, estimatedCost: Number(e.target.value) })}
                        className="px-2 py-1.5 bg-[#1E1E1E] border border-[#2A2A2A] rounded text-white text-sm"
                        placeholder="Cost ($)"
                        min="0"
                        step="0.01"
                      />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={cancelEdit}
                        className="px-3 py-1.5 text-sm text-[#999999] hover:text-white bg-[#1E1E1E] hover:bg-[#2A2A2A] rounded transition-colors min-h-[36px]"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => saveEdit(log.wasteLogId)}
                        disabled={savingEdit}
                        className="px-3 py-1.5 text-sm text-white bg-[#D4A574] hover:bg-[#C4956A] rounded transition-colors min-h-[36px] disabled:opacity-50 flex items-center gap-1"
                      >
                        {savingEdit ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Display mode */
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-white text-sm font-medium truncate">
                        {log.ingredientName}{" "}
                        <span className="text-[#999999] font-normal">
                          — {log.quantity} {log.unit}
                        </span>
                      </p>
                      {teamView && log.loggedBy && !isOwnEntry && (
                        <p className="text-xs text-blue-400/70 mt-0.5">
                          Logged by {log.loggedBy}
                        </p>
                      )}
                      <p className="text-xs text-[#666666] mt-0.5">
                        {log.reason && <span className="mr-3">{log.reason}</span>}
                        {log.shift && <span className="mr-3">{log.shift}</span>}
                        {log.estimatedCost != null && (
                          <span className="mr-3">${Number(log.estimatedCost).toFixed(2)}</span>
                        )}
                        <span>{timeAgo(log.loggedAt)}</span>
                      </p>
                    </div>
                    {canEditDelete && (
                      <div className="flex items-center gap-1 ml-2">
                        <button
                          onClick={() => startEdit(log)}
                          className="p-2 text-[#666666] hover:text-[#D4A574] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                          title="Edit log"
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(log.wasteLogId)}
                          className="p-2 text-[#666666] hover:text-red-400 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                          title="Delete log"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
