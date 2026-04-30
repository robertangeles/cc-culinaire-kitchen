/**
 * @module components/inventory/ConsumptionLogger
 *
 * Fast entry UI for logging ingredient/item consumption.
 * Designed for ~15 second completion per entry — search, qty, reason, done.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useLocation } from "../../context/LocationContext.js";
import { useLocationIngredients, useConsumptionLog, type ConsumptionLogEntry } from "../../hooks/useInventory.js";
import { useMenuItems } from "../../hooks/useMenuItems.js";
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
  { key: "return_to_stock", label: "Return to Stockroom" },
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
  const { items: locationItems, isLoading: itemsLoading, refresh: refreshItems } =
    useLocationIngredients(selectedLocationId);
  const { logs, isLoading: logsLoading, logConsumption, editLog, deleteLog } =
    useConsumptionLog(selectedLocationId);
  // Phase 4 (B1): menu items list for the optional dish-attribution dropdown.
  // Only shown when reason === "kitchen_operations" (the dish-attributable reason).
  const { items: menuItems } = useMenuItems();

  /* --- form state --- */
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<typeof locationItems[number] | null>(null);
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [menuItemId, setMenuItemId] = useState<string>("");
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
    setMenuItemId("");
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
        // Only attach menuItemId when reason is dish-attributable. Other
        // reasons (FOH, staff, cleaning, etc.) shouldn't carry a dish FK.
        menuItemId: reason === "kitchen_operations" && menuItemId ? menuItemId : null,
        quantity: qty,
        unit: selectedItem.unitOverride || selectedItem.baseUnit,
        reason,
        shift: shift ?? undefined,
        notes: notes.trim() || undefined,
        storeLocationId: selectedLocationId,
      });
      setShowSuccess(true);
      handleClearItem();
      refreshItems(); // reload stock levels after deduction/return
      setTimeout(() => setShowSuccess(false), 1500);
    } catch (err: any) {
      setError(err.message || "Failed to log consumption");
    } finally {
      setSaving(false);
    }
  }, [selectedItem, quantity, reason, menuItemId, shift, notes, selectedLocationId, logConsumption, handleClearItem, refreshItems]);

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
        {/* Reason selector — pick reason FIRST so we know if 0-stock items should be enabled */}
        {!selectedItem && (
          <div>
            <label className="text-xs text-[#888] font-medium mb-1.5 block">What are you doing?</label>
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map((r) => {
                const isReturn = r.key === "return_to_stock";
                const isActive = reason === r.key;
                return (
                  <button
                    key={r.key}
                    onClick={() => setReason(isActive ? "" : r.key)}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-all ${
                      isActive
                        ? isReturn
                          ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                          : "bg-[#D4A574]/20 text-[#D4A574] border-[#D4A574]/30"
                        : "bg-[#161616] text-[#888] border-[#2A2A2A] hover:border-[#444]"
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Item picker — category browse */}
        {!selectedItem && (
          <div className="space-y-2">
            {/* Filter input */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Filter items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-[#555] focus:outline-none focus:border-[#D4A574]/30 transition-all"
                autoFocus
              />
            </div>

            {/* Category tabs — clickable filter */}
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setActiveCat(null)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                  activeCat === null
                    ? "bg-[#D4A574]/15 text-[#D4A574] border-[#D4A574]/30"
                    : "bg-white/[0.03] text-[#888] border-white/5 hover:border-[#D4A574]/20 hover:text-[#ccc]"
                }`}
              >
                All
              </button>
              {(() => {
                const activeItems = locationItems.filter((i) => i.activeInd !== false);
                const cats = [...new Set(activeItems.map((i) => i.ingredientCategory))].sort();
                return cats.map((cat) => {
                  const catLabel = cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                  const count = activeItems.filter((i) => i.ingredientCategory === cat).length;
                  return (
                    <button
                      key={cat}
                      onClick={() => setActiveCat(activeCat === cat ? null : cat)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                        activeCat === cat
                          ? "bg-[#D4A574]/15 text-[#D4A574] border-[#D4A574]/30"
                          : "bg-white/[0.03] text-[#888] border-white/5 hover:border-[#D4A574]/20 hover:text-[#ccc]"
                      }`}
                    >
                      {catLabel} ({count})
                    </button>
                  );
                });
              })()}
            </div>

            {/* Item list grouped by category */}
            <div className="max-h-60 overflow-y-auto rounded-lg border border-[#1E1E1E]">
              {/* Column header */}
              <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.02] border-b border-[#1E1E1E]">
                <span className="text-[10px] text-[#666] uppercase tracking-wider">Item</span>
                <span className="text-[10px] text-[#666] uppercase tracking-wider">Current Stock</span>
              </div>
              {(() => {
                const activeItems = locationItems.filter((i) => i.activeInd !== false);
                const visible = activeItems.filter((i) => {
                  if (activeCat && i.ingredientCategory !== activeCat) return false;
                  if (searchQuery && !i.ingredientName.toLowerCase().includes(searchQuery.toLowerCase())) return false;
                  return true;
                });
                const grouped = new Map<string, typeof activeItems>();
                for (const item of visible) {
                  const cat = item.ingredientCategory;
                  if (!grouped.has(cat)) grouped.set(cat, []);
                  grouped.get(cat)!.push(item);
                }
                if (grouped.size === 0) {
                  return <p className="px-3 py-4 text-xs text-[#666] text-center">No items match</p>;
                }
                return [...grouped.entries()].map(([cat, items]) => {
                  const catLabel = cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                  return (
                    <div key={cat}>
                      <div className="px-3 py-1.5 bg-white/[0.02] text-[10px] text-[#666] uppercase tracking-wider font-medium border-t border-[#1E1E1E] first:border-t-0">
                        {catLabel}
                      </div>
                      {items.map((item) => {
                        const stock = Number(item.currentQty || 0);
                        const isReturn = reason === "return_to_stock";
                        const outOfStock = stock <= 0 && !isReturn;
                        return (
                          <button
                            key={item.ingredientId}
                            onClick={() => !outOfStock && handleSelectItem(item)}
                            disabled={outOfStock}
                            className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                              outOfStock
                                ? "text-[#444] cursor-not-allowed"
                                : "text-[#ccc] hover:bg-[#D4A574]/5 cursor-pointer"
                            }`}
                          >
                            <span className={outOfStock ? "line-through" : ""}>{item.ingredientName}</span>
                            <span className={`text-[10px] tabular-nums ${outOfStock ? "text-red-400/60" : "text-[#888]"}`}>
                              {outOfStock ? "Out of stock" : `${stock.toFixed(1)} ${item.baseUnit}`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                });
              })()}
            </div>
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

            {/* Phase 4 (B1): optional dish attribution. Only renders for the
                "Kitchen" reason — other reasons (FOH, staff, cleaning, etc.)
                aren't dish-attributable so the dropdown would be noise. */}
            {reason === "kitchen_operations" && menuItems.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[#888] font-medium">
                  Dish <span className="text-[#555]">(optional — for yield variance)</span>
                </label>
                <select
                  value={menuItemId}
                  onChange={(e) => setMenuItemId(e.target.value)}
                  className="bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-[#E0E0E0] focus:outline-none focus:border-[#D4A574]/40 transition-all"
                >
                  <option value="">— No specific dish —</option>
                  {menuItems.map((m) => (
                    <option key={m.menuItemId} value={m.menuItemId}>
                      {m.name} <span className="text-[#666]">({m.category})</span>
                    </option>
                  ))}
                </select>
              </div>
            )}

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
                {/* Entries are final — no edits */}
              </div>
            ),
          )}
      </div>
    </div>
  );
}
