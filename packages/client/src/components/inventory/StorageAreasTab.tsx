/**
 * @module components/inventory/StorageAreasTab
 *
 * Admin surface for storage areas — the named places stock physically lives
 * (Stock Room, Bar, Walk-in).
 *
 * Areas are COUNT SHEETS, not ledgers. Defining one never moves stock: there is
 * still exactly one on-hand number per item per venue. What an area does is
 * organise the stocktake walk shelf-to-sheet, and carry a par so the bar can be
 * restocked to a known level.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { useLocation } from "../../context/LocationContext.js";
import {
  useStorageAreas,
  useLocationIngredients,
  type StorageArea,
  type AreaItem,
} from "../../hooks/useInventory.js";
import {
  Boxes, Plus, Pencil, Trash2, Loader2, X, Check, Search,
  ChevronUp, ChevronDown, PackageOpen,
} from "lucide-react";

/* ── Item picker ────────────────────────────────────────────────── */

function AreaItemsEditor({
  area,
  onClose,
}: {
  area: StorageArea;
  onClose: () => void;
}) {
  const { selectedLocationId } = useLocation();
  const { items: locationItems } = useLocationIngredients(selectedLocationId);
  const { getItems, setItems } = useStorageAreas(selectedLocationId);

  const [rows, setRows] = useState<AreaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    getItems(area.storageAreaId).then((r) => {
      if (!cancelled) {
        setRows(r);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [area.storageAreaId, getItems]);

  const assignedIds = useMemo(() => new Set(rows.map((r) => r.ingredientId)), [rows]);

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return locationItems
      .filter((i) => i.activeInd !== false && !assignedIds.has(i.ingredientId))
      .filter((i) => i.ingredientName.toLowerCase().includes(q))
      .slice(0, 6);
  }, [search, locationItems, assignedIds]);

  const addItem = (ingredientId: string, ingredientName: string, baseUnit: string) => {
    setRows((r) => [
      ...r,
      { ingredientId, ingredientName, baseUnit, areaParLevel: null, sortOrder: r.length },
    ]);
    setSearch("");
  };

  const move = (index: number, delta: number) => {
    setRows((r) => {
      const next = [...r];
      const target = index + delta;
      if (target < 0 || target >= next.length) return r;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((row, i) => ({ ...row, sortOrder: i }));
    });
  };

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await setItems(
        area.storageAreaId,
        rows.map((r, i) => ({
          ingredientId: r.ingredientId,
          areaParLevel: r.areaParLevel != null && r.areaParLevel !== "" ? Number(r.areaParLevel) : null,
          sortOrder: i,
        })),
      );
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, [area.storageAreaId, rows, setItems, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-[fadeIn_150ms_ease-out] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="area-items-title"
    >
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col bg-[#111]/95 backdrop-blur-md border border-[#D4A574]/20 rounded-2xl shadow-[0_0_32px_rgba(212,165,116,0.1)]">
        <div className="flex items-start justify-between p-5 pb-3">
          <div>
            <h3 id="area-items-title" className="text-base font-semibold text-[#EEE]">
              What's in {area.areaName}?
            </h3>
            <p className="text-xs text-[#888] mt-0.5">
              These items appear on this area's count sheet, in this order. Set a par to get a
              restock list.
            </p>
          </div>
          <button onClick={onClose} className="text-[#666] hover:text-[#CCC] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Add */}
        <div className="px-5 pb-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
            <input
              type="text"
              placeholder="Add an item..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-[#555] focus:outline-none focus:border-[#D4A574]/30 transition-all"
            />
          </div>
          {candidates.length > 0 && (
            <div className="mt-1 rounded-lg border border-[#2A2A2A] overflow-hidden">
              {candidates.map((c) => (
                <button
                  key={c.ingredientId}
                  onClick={() => addItem(c.ingredientId, c.ingredientName, c.baseUnit)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-[#ccc] hover:bg-[#D4A574]/5 transition-colors"
                >
                  <span>{c.ingredientName}</span>
                  <span className="text-[10px] text-[#666]">{c.baseUnit}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto px-5">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="size-5 animate-spin text-[#D4A574]" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-xs text-[#666] text-center py-10">
              Nothing here yet. Search above to put items on this sheet.
            </p>
          ) : (
            <div className="rounded-lg border border-[#2A2A2A] divide-y divide-[#2A2A2A]/40">
              {rows.map((row, i) => (
                <div key={row.ingredientId} className="flex items-center gap-2 px-3 py-2">
                  <div className="flex flex-col">
                    <button
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${row.ingredientName} up`}
                      className="text-[#555] hover:text-[#D4A574] disabled:opacity-20 disabled:hover:text-[#555] transition-colors"
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      onClick={() => move(i, 1)}
                      disabled={i === rows.length - 1}
                      aria-label={`Move ${row.ingredientName} down`}
                      className="text-[#555] hover:text-[#D4A574] disabled:opacity-20 disabled:hover:text-[#555] transition-colors"
                    >
                      <ChevronDown size={12} />
                    </button>
                  </div>
                  <span className="flex-1 text-sm text-[#CCC] truncate">{row.ingredientName}</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      placeholder="par"
                      aria-label={`Par level for ${row.ingredientName}`}
                      value={row.areaParLevel ?? ""}
                      onChange={(e) =>
                        setRows((r) =>
                          r.map((x, xi) => (xi === i ? { ...x, areaParLevel: e.target.value } : x)),
                        )
                      }
                      className="w-16 bg-[#0A0A0A] border border-[#2A2A2A] rounded-md px-2 py-1 text-xs text-white text-right placeholder-[#555] focus:outline-none focus:border-[#D4A574]/30"
                    />
                    <span className="text-[10px] text-[#666] w-10">{row.baseUnit}</span>
                  </div>
                  <button
                    onClick={() => setRows((r) => r.filter((_, xi) => xi !== i))}
                    aria-label={`Remove ${row.ingredientName}`}
                    className="text-[#555] hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <p className="px-5 pt-3 text-xs text-red-400/90">{error}</p>}

        <div className="flex justify-end gap-2 p-5 pt-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-[#999] hover:text-[#CCC] border border-[#2A2A2A] hover:border-[#3A3A3A] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A] font-semibold rounded-xl px-5 py-2 text-sm transition-all hover:shadow-[0_0_20px_rgba(212,165,116,0.2)] hover:brightness-110 disabled:opacity-40 flex items-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save sheet
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Tab ────────────────────────────────────────────────────────── */

export default function StorageAreasTab() {
  const { selectedLocationId } = useLocation();
  const { areas, isLoading, create, update, deactivate } = useStorageAreas(selectedLocationId);

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editingItemsFor, setEditingItemsFor] = useState<StorageArea | null>(null);

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      await create(name, areas.length);
      setNewName("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }, [newName, areas.length, create]);

  const handleRename = useCallback(async (areaId: string) => {
    const name = editName.trim();
    if (!name) return;
    setError(null);
    try {
      await update(areaId, { areaName: name });
      setEditingId(null);
    } catch (err: any) {
      setError(err.message);
    }
  }, [editName, update]);

  const handleReorder = useCallback(async (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= areas.length) return;
    // Swap the two sort_orders — the walk order is what the counter follows.
    await update(areas[index].storageAreaId, { sortOrder: areas[target].sortOrder });
    await update(areas[target].storageAreaId, { sortOrder: areas[index].sortOrder });
  }, [areas, update]);

  const handleDeactivate = useCallback(async (area: StorageArea) => {
    setError(null);
    try {
      await deactivate(area.storageAreaId);
    } catch (err: any) {
      setError(err.message);
    }
  }, [deactivate]);

  if (!selectedLocationId) {
    return <p className="text-sm text-[#666] text-center py-16">Select a location first.</p>;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-[#D4A574]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {editingItemsFor && (
        <AreaItemsEditor area={editingItemsFor} onClose={() => setEditingItemsFor(null)} />
      )}

      {/* Add an area */}
      <div className="bg-[#111]/80 backdrop-blur-md border border-white/5 rounded-xl p-5 space-y-3">
        <div>
          <label htmlFor="new-area" className="text-xs text-[#888] font-medium mb-1.5 block">
            Add a storage area
          </label>
          <div className="flex gap-2">
            <input
              id="new-area"
              type="text"
              placeholder="Stock Room, Bar, FOH counter..."
              value={newName}
              maxLength={50}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="flex-1 bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2 text-sm text-white placeholder-[#555] focus:outline-none focus:border-[#D4A574]/30 transition-all"
            />
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A] font-semibold rounded-lg px-4 py-2 text-sm transition-all hover:shadow-[0_0_20px_rgba(212,165,116,0.2)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Add
            </button>
          </div>
        </div>
        <p className="text-[11px] text-[#666]">
          Areas organise the count. Stock still belongs to the whole site — moving something to
          the bar never changes what you have.
        </p>
        {error && <p className="text-xs text-red-400/90">{error}</p>}
      </div>

      {/* The areas */}
      {areas.length === 0 ? (
        <div className="text-center py-16 rounded-xl bg-[#161616] border border-[#2A2A2A]">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[#D4A574]/10 border border-[#D4A574]/20 flex items-center justify-center shadow-[0_0_20px_rgba(212,165,116,0.1)]">
            <Boxes className="size-7 text-[#D4A574]" />
          </div>
          <h3 className="text-base font-semibold text-white mb-1">Create your first area</h3>
          <p className="text-sm text-[#888] max-w-sm mx-auto">
            Stock Room, Bar, FOH counter — wherever you actually walk when you count.
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-[#111]/80 backdrop-blur-md border border-white/5 divide-y divide-[#2A2A2A]/40">
          {areas.map((area, i) => (
            <div
              key={area.storageAreaId}
              className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors"
            >
              <div className="flex flex-col">
                <button
                  onClick={() => handleReorder(i, -1)}
                  disabled={i === 0}
                  aria-label={`Move ${area.areaName} earlier in the walk`}
                  className="text-[#555] hover:text-[#D4A574] disabled:opacity-20 disabled:hover:text-[#555] transition-colors"
                >
                  <ChevronUp size={13} />
                </button>
                <button
                  onClick={() => handleReorder(i, 1)}
                  disabled={i === areas.length - 1}
                  aria-label={`Move ${area.areaName} later in the walk`}
                  className="text-[#555] hover:text-[#D4A574] disabled:opacity-20 disabled:hover:text-[#555] transition-colors"
                >
                  <ChevronDown size={13} />
                </button>
              </div>

              {editingId === area.storageAreaId ? (
                <input
                  autoFocus
                  value={editName}
                  maxLength={50}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename(area.storageAreaId);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={() => setEditingId(null)}
                  aria-label={`Rename ${area.areaName}`}
                  className="flex-1 bg-[#0A0A0A] border border-[#D4A574]/30 rounded-md px-2 py-1 text-sm text-white focus:outline-none"
                />
              ) : (
                <span className="flex-1 text-sm text-white">{area.areaName}</span>
              )}

              <button
                onClick={() => setEditingItemsFor(area)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/[0.03] border border-white/5 text-[#888] hover:border-[#D4A574]/20 hover:text-[#ccc] transition-colors"
              >
                <PackageOpen size={11} />
                {area.itemCount} {area.itemCount === 1 ? "item" : "items"}
              </button>

              <button
                onClick={() => {
                  setEditingId(area.storageAreaId);
                  setEditName(area.areaName);
                }}
                aria-label={`Rename ${area.areaName}`}
                className="text-[#555] hover:text-[#D4A574] transition-colors"
              >
                {editingId === area.storageAreaId ? <Check size={14} /> : <Pencil size={13} />}
              </button>
              <button
                onClick={() => handleDeactivate(area)}
                aria-label={`Remove ${area.areaName}`}
                className="text-[#555] hover:text-red-400 transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
