/**
 * @module components/inventory/ConsumptionLogger
 *
 * Fast entry UI for logging ingredient/item consumption.
 * Designed for ~15 second completion per entry — search, qty, reason, done.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useLocation } from "../../context/LocationContext.js";
import { useLocationIngredients, useConsumptionLog, type ConsumptionLogEntry } from "../../hooks/useInventory.js";
import { Search, Check, Pencil, Trash2, Loader2, ClipboardEdit, Clock, X } from "lucide-react";
import { CATEGORY_LABELS } from "@culinaire/shared";

/* ── Reason + Shift chips ───────────────────────────────────────── */

const REASONS = [
  { key: "kitchen_operations", label: "Kitchen" },
  { key: "foh_operations", label: "FOH" },
  { key: "staff_consumption", label: "Staff" },
  { key: "cleaning", label: "Cleaning" },
  { key: "admin", label: "Admin" },
  { key: "breakage", label: "Breakage" },
  { key: "other", label: "Other" },
] as const;

const SHIFTS = [
  { key: "morning", label: "AM" },
  { key: "afternoon", label: "PM" },
  { key: "evening", label: "Eve" },
  { key: "closing", label: "Close" },
] as const;

const REASON_LABELS: Record<string, string> = Object.fromEntries(
  REASONS.map((r) => [r.key, r.label]),
);

/* ── Helpers ────────────────────────────────────────────────────── */

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/* ── Component ──────────────────────────────────────────────────── */

export default function ConsumptionLogger() {
  const { selectedLocationId } = useLocation();
  const { items: locationItems, isLoading: itemsLoading } =
    useLocationIngredients(selectedLocationId);
  const { logs, isLoading: logsLoading, logConsumption, editLog, deleteLog } =
    useConsumptionLog(selectedLocationId);

  /* --- form state --- */
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<typeof locationItems[number] | null>(null);
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [shift, setShift] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* --- inline edit state --- */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const qtyRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  /* --- search filtering --- */
  const activeItems = locationItems.filter((i) => i.activeInd !== false);
  const searchResults = searchQuery.trim().length > 0
    ? activeItems
        .filter((i) =>
          i.ingredientName.toLowerCase().includes(searchQuery.toLowerCase()),
        )
        .slice(0, 8)
    : [];

  /* --- today's entries --- */
  const todayEntries = logs.filter((e) => isToday(e.loggedAt));

  /* --- handlers --- */

  const handleSelectItem = useCallback(
    (item: typeof locationItems[number]) => {
      setSelectedItem(item);
      setSearchQuery("");
      setError(null);
      setTimeout(() => qtyRef.current?.focus(), 50);
    },
    [],
  );

  const handleClearItem = useCallback(() => {
    setSelectedItem(null);
    setQuantity("");
    setReason("");
    setShift(null);
    setNotes("");
    setError(null);
    setTimeout(() => searchRef.current?.focus(), 50);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!selectedItem || !quantity || !reason || !selectedLocationId) return;
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      setError("Quantity must be greater than 0");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await logConsumption({
        ingredientId: selectedItem.ingredientId,
        quantity: qty,
        unit: selectedItem.unitOverride || selectedItem.baseUnit,
        reason,
        shift: shift ?? undefined,
        notes: notes.trim() || undefined,
        storeLocationId: selectedLocationId,
      });
      setShowSuccess(true);
      handleClearItem();
      setTimeout(() => setShowSuccess(false), 1500);
    } catch (err: any) {
      setError(err.message || "Failed to log consumption");
    } finally {
      setSaving(false);
    }
  }, [selectedItem, quantity, reason, shift, notes, selectedLocationId, logConsumption, handleClearItem]);

  const handleStartEdit = useCallback((entry: ConsumptionLogEntry) => {
    setEditingId(entry.consumptionLogId);
    setEditQty(entry.quantity);
    setEditReason(entry.reason);
    setEditNotes(entry.notes || "");
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingId) return;
    try {
      await editLog(editingId, {
        quantity: parseFloat(editQty),
        reason: editReason,
        notes: editNotes.trim() || null,
      });
      setEditingId(null);
    } catch {
      // keep edit mode open on error
    }
  }, [editingId, editQty, editReason, editNotes, editLog]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm("Delete this consumption entry?")) return;
      await deleteLog(id);
    },
    [deleteLog],
  );

  /* --- keyboard shortcut: Enter to submit --- */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && selectedItem && quantity && reason) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, selectedItem, quantity, reason],
  );

  /* ── render ───────────────────────────────────────────────────── */

  const unit = selectedItem
    ? selectedItem.unitOverride || selectedItem.baseUnit
    : "";
  const currentStock = selectedItem?.currentQty
    ? Number(selectedItem.currentQty)
    : null;

  return (
    <div
      className="space-y-5"
      onKeyDown={handleKeyDown}
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#D4A574]/20 to-[#D4A574]/5 flex items-center justify-center">
            <ClipboardEdit size={16} className="text-[#D4A574]" />
          </div>
          <h2 className="text-sm font-semibold tracking-wide text-[#E0E0E0] uppercase">
            Transfer
          </h2>
        </div>
        <div className="flex items-center gap-1.5 text-[#666] text-xs">
          <Clock size={12} />
          <span>{todayEntries.length} today</span>
        </div>
      </div>

      {/* ── Success flash ──────────────────────────────────────── */}
      {showSuccess && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm animate-fade-in shadow-[0_0_16px_rgba(16,185,129,0.1)]">
          <Check size={16} />
          <span className="font-medium">Logged successfully</span>
        </div>
      )}

      {/* ── Entry card ─────────────────────────────────────────── */}
      <div className="bg-[#111]/80 backdrop-blur-md border border-white/5 rounded-xl p-5 space-y-4">
        {/* Search */}
        {!selectedItem && (
          <div className="relative">
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#666]"
              />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-xl pl-10 pr-4 py-2.5 text-sm text-[#E0E0E0] placeholder-[#555] focus:outline-none focus:border-[#D4A574]/40 focus:shadow-[0_0_12px_rgba(212,165,116,0.08)] transition-all"
                autoFocus
              />
            </div>

            {/* Dropdown */}
            {searchResults.length > 0 && (
              <div className="absolute z-30 mt-1.5 w-full bg-[#161616]/95 backdrop-blur-xl border border-[#D4A574]/15 rounded-xl shadow-lg shadow-black/40 overflow-hidden">
                {searchResults.map((item) => (
                  <button
                    key={item.ingredientId}
                    onClick={() => handleSelectItem(item)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-[#D4A574]/8 transition-colors group"
                  >
                    <div className="flex flex-col">
                      <span className="text-sm text-[#E0E0E0] group-hover:text-white transition-colors">
                        {item.ingredientName}
                      </span>
                      <span className="text-xs text-[#666]">
                        {CATEGORY_LABELS[item.ingredientCategory as keyof typeof CATEGORY_LABELS] ?? item.ingredientCategory}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-[#888]">
                        {item.currentQty != null
                          ? `${Number(item.currentQty).toFixed(1)} ${item.unitOverride || item.baseUnit}`
                          : `— ${item.unitOverride || item.baseUnit}`}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {searchQuery.trim().length > 0 && searchResults.length === 0 && !itemsLoading && (
              <div className="absolute z-30 mt-1.5 w-full bg-[#161616]/95 backdrop-blur-xl border border-[#2A2A2A] rounded-xl p-4 text-center text-sm text-[#666]">
                No items found
              </div>
            )}
          </div>
        )}

        {/* Selected item card */}
        {selectedItem && (
          <div className="space-y-4">
            {/* Item header */}
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-white">
                  {selectedItem.ingredientName}
                </span>
                <span className="text-xs text-[#888]">
                  {unit}
                  {currentStock != null && (
                    <span className="ml-2 text-[#D4A574]">
                      {currentStock.toFixed(1)} in stock
                    </span>
                  )}
                </span>
              </div>
              <button
                onClick={handleClearItem}
                className="p-1.5 rounded-lg hover:bg-white/5 text-[#666] hover:text-[#E0E0E0] transition-colors"
                title="Clear selection"
              >
                <X size={16} />
              </button>
            </div>

            {/* Qty + Reason row */}
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#888] font-medium">Qty</label>
                <div className="flex items-center gap-1.5">
                  <input
                    ref={qtyRef}
                    type="number"
                    step="0.1"
                    min="0"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="0.0"
                    className="w-24 bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-[#E0E0E0] placeholder-[#555] focus:outline-none focus:border-[#D4A574]/40 focus:shadow-[0_0_8px_rgba(212,165,116,0.08)] transition-all text-center"
                  />
                  <span className="text-xs text-[#666]">{unit}</span>
                </div>
              </div>

              <div className="flex flex-col gap-1 flex-1 min-w-0">
                <label className="text-xs text-[#888] font-medium">Reason</label>
                <div className="flex flex-wrap gap-1.5">
                  {REASONS.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => setReason(r.key)}
                      className={`px-3 py-1.5 rounded-full text-xs border transition-all cursor-pointer ${
                        reason === r.key
                          ? "bg-[#D4A574]/20 text-[#D4A574] border-[#D4A574]/30 shadow-[0_0_8px_rgba(212,165,116,0.1)]"
                          : "bg-[#161616] text-[#888] border-[#2A2A2A] hover:border-[#444] hover:text-[#BBB]"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Shift + Notes row */}
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#888] font-medium">
                  Shift <span className="text-[#555]">(optional)</span>
                </label>
                <div className="flex gap-1.5">
                  {SHIFTS.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => setShift(shift === s.key ? null : s.key)}
                      className={`px-3 py-1.5 rounded-full text-xs border transition-all cursor-pointer ${
                        shift === s.key
                          ? "bg-[#D4A574]/20 text-[#D4A574] border-[#D4A574]/30 shadow-[0_0_8px_rgba(212,165,116,0.1)]"
                          : "bg-[#161616] text-[#888] border-[#2A2A2A] hover:border-[#444] hover:text-[#BBB]"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1 flex-1 min-w-0">
                <label className="text-xs text-[#888] font-medium">
                  Notes <span className="text-[#555]">(optional)</span>
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional notes..."
                  className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-[#E0E0E0] placeholder-[#555] focus:outline-none focus:border-[#D4A574]/40 transition-all"
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <p className="text-xs text-red-400/90">{error}</p>
            )}

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={saving || !quantity || !reason}
              className="w-full sm:w-auto bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A] font-semibold rounded-xl px-6 py-2.5 text-sm transition-all hover:shadow-[0_0_20px_rgba(212,165,116,0.2)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Logging...
                </>
              ) : (
                "Transfer"
              )}
            </button>
          </div>
        )}

        {/* Empty state */}
        {!selectedItem && searchQuery.trim().length === 0 && (
          <p className="text-xs text-[#555] text-center py-2">
            Start typing to search for an item
          </p>
        )}
      </div>

      {/* ── Today's entries ────────────────────────────────────── */}
      <div className="space-y-2.5">
        <h3 className="text-xs font-semibold tracking-wide text-[#888] uppercase">
          Today's Entries
        </h3>

        {logsLoading && (
          <div className="flex items-center justify-center py-6 text-[#666]">
            <Loader2 size={18} className="animate-spin" />
          </div>
        )}

        {!logsLoading && todayEntries.length === 0 && (
          <div className="bg-[#111]/60 border border-white/5 rounded-xl px-4 py-6 text-center">
            <ClipboardEdit size={20} className="mx-auto mb-2 text-[#444]" />
            <p className="text-xs text-[#555]">No entries logged today</p>
          </div>
        )}

        {!logsLoading &&
          todayEntries.map((entry) =>
            editingId === entry.consumptionLogId ? (
              /* inline edit row */
              <div
                key={entry.consumptionLogId}
                className="bg-[#111]/80 backdrop-blur-md border border-[#D4A574]/20 rounded-xl px-4 py-3 space-y-2.5 animate-fade-in"
              >
                <div className="flex gap-2 items-center flex-wrap">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={editQty}
                    onChange={(e) => setEditQty(e.target.value)}
                    className="w-20 bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-2 py-1.5 text-xs text-[#E0E0E0] focus:outline-none focus:border-[#D4A574]/40 transition-all text-center"
                  />
                  <span className="text-xs text-[#666]">{entry.unit || entry.baseUnit}</span>
                  <span className="text-xs text-[#E0E0E0] font-medium">
                    {entry.ingredientName}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {REASONS.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => setEditReason(r.key)}
                      className={`px-2.5 py-1 rounded-full text-xs border transition-all cursor-pointer ${
                        editReason === r.key
                          ? "bg-[#D4A574]/20 text-[#D4A574] border-[#D4A574]/30"
                          : "bg-[#161616] text-[#888] border-[#2A2A2A] hover:border-[#444]"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Notes..."
                    className="flex-1 bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-2 py-1.5 text-xs text-[#E0E0E0] placeholder-[#555] focus:outline-none focus:border-[#D4A574]/40 transition-all"
                  />
                  <button
                    onClick={handleSaveEdit}
                    className="px-3 py-1.5 bg-[#D4A574]/20 text-[#D4A574] rounded-lg text-xs font-medium hover:bg-[#D4A574]/30 transition-colors"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="px-3 py-1.5 bg-white/5 text-[#888] rounded-lg text-xs hover:bg-white/10 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              /* read-only row */
              <div
                key={entry.consumptionLogId}
                className="group flex items-center gap-3 bg-[#111]/60 border border-white/5 rounded-xl px-4 py-2.5 hover:border-white/10 transition-all"
              >
                <div className="flex items-center gap-1.5 min-w-[5rem]">
                  <span className="text-sm font-medium text-[#E0E0E0]">
                    {Number(entry.quantity).toFixed(1)}
                  </span>
                  <span className="text-xs text-[#666]">
                    {entry.unit || entry.baseUnit}
                  </span>
                </div>
                <span className="text-sm text-[#CCC] flex-1 truncate">
                  {entry.ingredientName}
                </span>
                <span
                  className="px-2 py-0.5 rounded-full text-xs bg-[#1A1A1A] border border-[#2A2A2A] text-[#888]"
                >
                  {REASON_LABELS[entry.reason] ?? entry.reason}
                </span>
                <span className="text-xs text-[#666] min-w-[4.5rem] text-right">
                  {formatTime(entry.loggedAt)}
                </span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleStartEdit(entry)}
                    className="p-1 rounded-md hover:bg-white/5 text-[#666] hover:text-[#D4A574] transition-colors"
                    title="Edit"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => handleDelete(entry.consumptionLogId)}
                    className="p-1 rounded-md hover:bg-white/5 text-[#666] hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ),
          )}
      </div>
    </div>
  );
}
