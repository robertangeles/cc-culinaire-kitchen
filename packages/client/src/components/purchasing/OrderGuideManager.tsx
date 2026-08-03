/**
 * @module components/purchasing/OrderGuideManager
 *
 * Build and maintain order guides — the reusable per-supplier lists the ordering
 * screen works from. Without this the guide-first flow has nothing to show: the
 * PO screen only ever READS guides, so somebody has to author them.
 *
 * Row order is the operator's walk order (shelf-to-sheet), so it's editable and
 * saved. The whole item set is written at once — the server replaces wholesale —
 * which means a dropped or reordered row is a real bug, not cosmetics.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { useLocation } from "../../context/LocationContext.js";
import { useSuppliers, useLocationIngredients } from "../../hooks/useInventory.js";
import { useOrderGuides, useOrderGuideItems } from "../../hooks/useOrderGuides.js";
import {
  BookOpen,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Search,
  Loader2,
  Check,
  X,
} from "lucide-react";

interface DraftItem {
  ingredientId: string;
  ingredientName: string;
}

export default function OrderGuideManager() {
  const { selectedLocationId } = useLocation();
  const { guides, loading, error, createGuide, deleteGuide } = useOrderGuides(selectedLocationId);
  const { suppliers } = useSuppliers();
  const { items: catalog } = useLocationIngredients(selectedLocationId);

  const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null);
  const { items, saveItems } = useOrderGuideItems(selectedGuideId, selectedLocationId);

  // New-guide form
  const [newName, setNewName] = useState("");
  const [newSupplierId, setNewSupplierId] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Local draft of the selected guide's rows, so reorder/remove/add feel instant
  // and only hit the server when the operator saves.
  const [draft, setDraft] = useState<DraftItem[]>([]);
  const [search, setSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(items.map((i) => ({ ingredientId: i.ingredientId, ingredientName: i.ingredientName })));
  }, [items]);

  const selectedGuide = useMemo(
    () => guides.find((g) => g.orderGuideId === selectedGuideId) ?? null,
    [guides, selectedGuideId],
  );

  const draftIds = useMemo(() => new Set(draft.map((d) => d.ingredientId)), [draft]);

  const addable = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog
      .filter((c) => !draftIds.has(c.ingredientId))
      .filter((c) => (q ? c.ingredientName.toLowerCase().includes(q) : true))
      .slice(0, 50);
  }, [catalog, draftIds, search]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) {
      setFormError("Give the guide a name");
      return;
    }
    if (!newSupplierId) {
      setFormError("Pick a supplier");
      return;
    }
    setFormError(null);
    setIsCreating(true);
    try {
      const created = await createGuide({ supplierId: newSupplierId, name: newName.trim() });
      setNewName("");
      setNewSupplierId("");
      if (created?.orderGuideId) setSelectedGuideId(created.orderGuideId);
      setNotice("Guide created — now add the items you order from them.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't create that guide");
    } finally {
      setIsCreating(false);
    }
  }, [newName, newSupplierId, createGuide]);

  const move = useCallback((index: number, delta: number) => {
    setDraft((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const handleSaveItems = useCallback(async () => {
    if (!selectedGuideId) return;
    setIsSaving(true);
    setFormError(null);
    try {
      await saveItems(draft.map((d, idx) => ({ ingredientId: d.ingredientId, sortOrder: idx })));
      setNotice(`Saved ${draft.length} item${draft.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Couldn't save this guide's items");
    } finally {
      setIsSaving(false);
    }
  }, [selectedGuideId, draft, saveItems]);

  if (!selectedLocationId) {
    return (
      <div className="rounded-xl bg-[#161616]/80 border border-[#2A2A2A] p-6 text-center">
        <p className="text-[#999] text-sm">Pick a location to manage its order guides.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-[fadeInUp_200ms_ease-out]">
      {/* Create */}
      <div className="rounded-xl bg-[#161616]/80 backdrop-blur-sm border border-[#2A2A2A] p-4">
        <h3 className="text-sm font-medium text-white flex items-center gap-2 mb-1">
          <BookOpen className="size-4 text-[#D4A574]" />
          Order Guides
        </h3>
        <p className="text-xs text-[#777] mb-3">
          The list you reorder from each week. Ordering fills it to par automatically, so you
          review and send instead of hunting the catalogue.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Guide name (e.g. Weekly Dry Goods)"
            className="px-3 py-2 rounded-lg text-sm bg-[#0A0A0A] text-white border border-[#2A2A2A]
              focus:border-[#D4A574]/40 outline-none placeholder:text-[#555]"
          />
          <select
            value={newSupplierId}
            onChange={(e) => setNewSupplierId(e.target.value)}
            aria-label="Supplier"
            className="px-3 py-2 rounded-lg text-sm bg-[#0A0A0A] text-white border border-[#2A2A2A]
              focus:border-[#D4A574]/40 outline-none"
          >
            <option value="">Select supplier…</option>
            {suppliers.map((s) => (
              <option key={s.supplierId} value={s.supplierId}>
                {s.supplierName}
              </option>
            ))}
          </select>
          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
              bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A]
              hover:shadow-[0_0_12px_rgba(212,165,116,0.2)] disabled:opacity-50 transition-all"
          >
            {isCreating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Create guide
          </button>
        </div>
        {formError && <p className="mt-2 text-xs text-red-400">{formError}</p>}
      </div>

      {/* Existing guides */}
      <div className="rounded-xl bg-[#161616]/80 backdrop-blur-sm border border-[#2A2A2A] p-4">
        {loading ? (
          <div className="py-6 text-center text-[#999] text-sm flex items-center justify-center gap-2">
            <Loader2 className="size-4 animate-spin" /> Loading guides…
          </div>
        ) : error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : guides.length === 0 ? (
          <div className="py-8 text-center">
            <BookOpen className="size-8 mx-auto text-[#D4A574]/40 mb-2" />
            <p className="text-white text-sm font-medium">No order guides yet</p>
            <p className="text-[#777] text-xs mt-1 max-w-sm mx-auto">
              Create one above for a supplier you order from regularly. Then ordering becomes
              “review and send” instead of searching the catalogue every time.
            </p>
          </div>
        ) : (
          <div className="flex gap-2 flex-wrap">
            {guides.map((g) => {
              const active = g.orderGuideId === selectedGuideId;
              return (
                <div
                  key={g.orderGuideId}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
                    active
                      ? "bg-[#D4A574]/15 border-[#D4A574]/40"
                      : "bg-[#1A1A1A] border-[#2A2A2A] hover:border-[#3A3A3A]"
                  }`}
                >
                  <button
                    onClick={() => setSelectedGuideId(active ? null : g.orderGuideId)}
                    className="text-left"
                  >
                    <span
                      className={`block text-xs font-medium ${active ? "text-[#D4A574]" : "text-white"}`}
                    >
                      {g.name}
                    </span>
                    <span className="block text-[10px] text-[#777] mt-0.5">
                      {g.supplierName} · {g.itemCount} item{g.itemCount === 1 ? "" : "s"}
                    </span>
                  </button>
                  <button
                    onClick={async () => {
                      if (selectedGuideId === g.orderGuideId) setSelectedGuideId(null);
                      try {
                        await deleteGuide(g.orderGuideId);
                        setNotice(`Removed “${g.name}”.`);
                      } catch (err) {
                        setFormError(err instanceof Error ? err.message : "Couldn't remove that guide");
                      }
                    }}
                    aria-label={`Remove ${g.name}`}
                    className="p-1 rounded-lg text-[#666] hover:text-red-400 hover:bg-red-500/10 transition-all"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Item editor */}
      {selectedGuide && (
        <div className="rounded-xl bg-[#161616]/80 backdrop-blur-sm border border-[#2A2A2A] p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h4 className="text-sm font-medium text-white">
              {selectedGuide.name}{" "}
              <span className="text-[#777] font-normal">· {selectedGuide.supplierName}</span>
            </h4>
            <button
              onClick={handleSaveItems}
              disabled={isSaving}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold
                bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A]
                hover:shadow-[0_0_12px_rgba(212,165,116,0.2)] disabled:opacity-50 transition-all"
            >
              {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Save items
            </button>
          </div>

          {/* Current rows, in walk order */}
          {draft.length === 0 ? (
            <p className="text-xs text-[#777] py-4 text-center">
              Nothing on this guide yet — add the items you order from {selectedGuide.supplierName}.
            </p>
          ) : (
            <div className="rounded-lg border border-[#2A2A2A] bg-[#0A0A0A]/50 mb-3">
              {draft.map((d, idx) => (
                <div
                  key={d.ingredientId}
                  className="flex items-center gap-2 px-3 py-2 border-b border-[#1A1A1A] last:border-0"
                >
                  <span className="w-6 text-[10px] text-[#555] shrink-0">{idx + 1}</span>
                  <span className="flex-1 text-sm text-white truncate">{d.ingredientName}</span>
                  <button
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    aria-label={`Move ${d.ingredientName} up`}
                    className="p-1 rounded text-[#666] hover:text-white disabled:opacity-25 transition-all"
                  >
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button
                    onClick={() => move(idx, 1)}
                    disabled={idx === draft.length - 1}
                    aria-label={`Move ${d.ingredientName} down`}
                    className="p-1 rounded text-[#666] hover:text-white disabled:opacity-25 transition-all"
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                  <button
                    onClick={() =>
                      setDraft((prev) => prev.filter((x) => x.ingredientId !== d.ingredientId))
                    }
                    aria-label={`Remove ${d.ingredientName}`}
                    className="p-1 rounded text-[#666] hover:text-red-400 transition-all"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add items */}
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[#666]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Add an item…"
              className="w-full pl-9 pr-3 py-2 rounded-lg text-sm bg-[#0A0A0A] text-white
                border border-[#2A2A2A] focus:border-[#D4A574]/40 outline-none placeholder:text-[#555]"
            />
          </div>
          {addable.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-[#2A2A2A] bg-[#0A0A0A]/50">
              {addable.map((c) => (
                <button
                  key={c.ingredientId}
                  onClick={() =>
                    setDraft((prev) => [
                      ...prev,
                      { ingredientId: c.ingredientId, ingredientName: c.ingredientName },
                    ])
                  }
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#1E1E1E] transition-colors
                    border-b border-[#1A1A1A] last:border-0 flex items-center gap-2"
                >
                  <Plus className="size-3.5 text-[#D4A574] shrink-0" />
                  <span className="text-white truncate">{c.ingredientName}</span>
                  <span className="ml-auto text-[10px] text-[#666]">{c.baseUnit}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {notice && <p className="text-xs text-[#999]">{notice}</p>}
    </div>
  );
}
