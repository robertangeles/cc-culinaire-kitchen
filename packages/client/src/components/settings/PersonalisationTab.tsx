/**
 * @module components/settings/PersonalisationTab
 *
 * Admin UI for managing database-driven personalisation options.
 * Allows admins to add, edit, or remove options for:
 *   - Skill Levels
 *   - Cuisine Preferences
 *   - Dietary Restrictions
 *   - Kitchen Equipment
 *
 * Changes take effect immediately for all users (KitchenWizard + MyKitchenTab
 * fetch from the API at runtime, so no redeploy is needed).
 */

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface ProfileOption {
  optionId: number;
  optionType: string;
  optionValue: string;
  optionLabel: string;
  optionDescription: string | null;
  sortOrder: number;
  activeInd: boolean;
}

interface GroupedOptions {
  skill_level: ProfileOption[];
  cuisine: ProfileOption[];
  dietary: ProfileOption[];
  equipment: ProfileOption[];
}

type SectionKey = keyof GroupedOptions;

const SECTIONS: { key: SectionKey; label: string; hasDescription: boolean }[] = [
  { key: "skill_level", label: "Skill Levels",          hasDescription: true  },
  { key: "cuisine",     label: "Cuisine Preferences",   hasDescription: false },
  { key: "dietary",     label: "Dietary Restrictions",  hasDescription: false },
  { key: "equipment",   label: "Kitchen Equipment",     hasDescription: false },
];

/** Convert a label to a slug-style value. */
function toValue(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/, "");
}

export function PersonalisationTab() {
  const [options, setOptions]   = useState<GroupedOptions | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");

  // Which sections are expanded
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    skill_level: true,
    cuisine:     true,
    dietary:     true,
    equipment:   true,
  });

  // Add form state per section
  const [adding, setAdding] = useState<Record<SectionKey, boolean>>({
    skill_level: false,
    cuisine:     false,
    dietary:     false,
    equipment:   false,
  });
  const [addForm, setAddForm] = useState<Record<SectionKey, { label: string; description: string }>>({
    skill_level: { label: "", description: "" },
    cuisine:     { label: "", description: "" },
    dietary:     { label: "", description: "" },
    equipment:   { label: "", description: "" },
  });
  const [addSaving, setAddSaving] = useState<Record<SectionKey, boolean>>({
    skill_level: false, cuisine: false, dietary: false, equipment: false,
  });

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm]   = useState({ label: "", description: "" });
  const [editSaving, setEditSaving] = useState(false);

  // Delete confirm
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);

  const fetchOptions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/personalisation-options", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load options");
      const data: GroupedOptions = await res.json();
      setOptions(data);
    } catch {
      setError("Failed to load personalisation options.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOptions(); }, [fetchOptions]);

  function toggleExpand(key: SectionKey) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleAdd(key: SectionKey) {
    setAdding((prev) => ({ ...prev, [key]: !prev[key] }));
    setAddForm((prev) => ({ ...prev, [key]: { label: "", description: "" } }));
  }

  async function handleAdd(key: SectionKey) {
    const { label, description } = addForm[key];
    if (!label.trim()) return;

    setAddSaving((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch("/api/admin/personalisation-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          optionType: key,
          optionValue: toValue(label),
          optionLabel: label.trim(),
          optionDescription: description.trim() || undefined,
          sortOrder: (options?.[key]?.length ?? 0),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Failed to add");
      }
      await fetchOptions();
      setAdding((prev) => ({ ...prev, [key]: false }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add option.");
    } finally {
      setAddSaving((prev) => ({ ...prev, [key]: false }));
    }
  }

  function startEdit(opt: ProfileOption) {
    setEditingId(opt.optionId);
    setEditForm({ label: opt.optionLabel, description: opt.optionDescription ?? "" });
    setDeletingId(null);
  }

  async function handleSaveEdit(optionId: number) {
    if (!editForm.label.trim()) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/admin/personalisation-options/${optionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          optionLabel: editForm.label.trim(),
          optionDescription: editForm.description.trim() || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      await fetchOptions();
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save option.");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete(optionId: number) {
    setDeleteSaving(true);
    try {
      const res = await fetch(`/api/admin/personalisation-options/${optionId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete");
      await fetchOptions();
      setDeletingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete option.");
    } finally {
      setDeleteSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[#999999]">
        <Loader2 className="size-5 animate-spin mr-2" />
        Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 py-6 border-b border-[#2A2A2A]">
        <h1 className="text-xl font-semibold text-[#FAFAFA]">Personalisation</h1>
        <p className="mt-1 text-sm text-[#999999]">
          Manage the selectable options shown to users in the Kitchen Profile wizard and settings.
          Changes take effect immediately — no redeploy required.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-8 mt-4 flex items-center gap-2 text-sm text-red-400 bg-red-900/30 border border-red-700/40 rounded-lg px-4 py-3">
          <AlertCircle className="size-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError("")} className="ml-auto">
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* Sections */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-4">
        {SECTIONS.map(({ key, label, hasDescription }) => {
          const items = options?.[key] ?? [];
          const isExpanded = expanded[key];
          const isAdding = adding[key];

          return (
            <div key={key} className="border border-[#2A2A2A] rounded-xl overflow-hidden">
              {/* Section header */}
              <button
                type="button"
                onClick={() => toggleExpand(key)}
                className="w-full flex items-center justify-between px-5 py-4 bg-[#0A0A0A] hover:bg-[#1E1E1E] transition-colors"
              >
                <span className="text-sm font-semibold text-[#FAFAFA]">
                  {label}
                  <span className="ml-2 text-xs font-normal text-[#999999]">
                    {items.filter((o) => o.activeInd).length} active
                    {items.some((o) => !o.activeInd) ? `, ${items.filter((o) => !o.activeInd).length} inactive` : ""}
                  </span>
                </span>
                {isExpanded ? <ChevronUp className="size-4 text-[#999999]" /> : <ChevronDown className="size-4 text-[#999999]" />}
              </button>

              {isExpanded && (
                <div className="divide-y divide-[#2A2A2A]">
                  {/* Option rows */}
                  {items.map((opt) => (
                    <div
                      key={opt.optionId}
                      className={`px-5 py-3 ${!opt.activeInd ? "opacity-50" : ""}`}
                    >
                      {editingId === opt.optionId ? (
                        /* Edit form */
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={editForm.label}
                            onChange={(e) => setEditForm((p) => ({ ...p, label: e.target.value }))}
                            className="w-full rounded-lg border border-[#2A2A2A] px-3 py-1.5 text-sm text-[#FAFAFA] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50"
                            placeholder="Label"
                            autoFocus
                          />
                          {hasDescription && (
                            <input
                              type="text"
                              value={editForm.description}
                              onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))}
                              className="w-full rounded-lg border border-[#2A2A2A] px-3 py-1.5 text-sm text-[#999999] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50"
                              placeholder="Description (optional)"
                            />
                          )}
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSaveEdit(opt.optionId)}
                              disabled={editSaving || !editForm.label.trim()}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#D4A574] rounded-lg hover:bg-[#C4956A] disabled:opacity-50"
                            >
                              {editSaving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                              Save
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#E5E5E5] bg-[#1E1E1E] rounded-lg hover:bg-[#2A2A2A]"
                            >
                              <X className="size-3" /> Cancel
                            </button>
                          </div>
                        </div>
                      ) : deletingId === opt.optionId ? (
                        /* Delete confirm */
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-[#E5E5E5] flex-1">
                            Delete <strong>{opt.optionLabel}</strong>? This cannot be undone.
                          </span>
                          <button
                            onClick={() => handleDelete(opt.optionId)}
                            disabled={deleteSaving}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
                          >
                            {deleteSaving ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                            Delete
                          </button>
                          <button
                            onClick={() => setDeletingId(null)}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[#E5E5E5] bg-[#1E1E1E] rounded-lg hover:bg-[#2A2A2A]"
                          >
                            <X className="size-3" /> Cancel
                          </button>
                        </div>
                      ) : (
                        /* Normal row */
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-[#FAFAFA]">{opt.optionLabel}</span>
                            {opt.optionDescription && (
                              <span className="text-xs text-[#999999] ml-2">{opt.optionDescription}</span>
                            )}
                            {!opt.activeInd && (
                              <span className="ml-2 text-xs text-[#999999] bg-[#1E1E1E] px-1.5 py-0.5 rounded">inactive</span>
                            )}
                          </div>
                          <button
                            onClick={() => startEdit(opt)}
                            className="p-1.5 rounded-lg text-[#999999] hover:text-[#E5E5E5] hover:bg-[#1E1E1E] transition-colors"
                            title="Edit"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            onClick={() => { setDeletingId(opt.optionId); setEditingId(null); }}
                            className="p-1.5 rounded-lg text-[#999999] hover:text-red-400 hover:bg-red-900/30 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                  {items.length === 0 && (
                    <div className="px-5 py-4 text-sm text-[#999999] italic">
                      No options yet. Add one below.
                    </div>
                  )}

                  {/* Add form */}
                  {isAdding ? (
                    <div className="px-5 py-4 bg-[#D4A574]/10 space-y-2">
                      <input
                        type="text"
                        value={addForm[key].label}
                        onChange={(e) => setAddForm((p) => ({ ...p, [key]: { ...p[key], label: e.target.value } }))}
                        className="w-full rounded-lg border border-[#2A2A2A] px-3 py-1.5 text-sm text-[#FAFAFA] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50"
                        placeholder="Label (e.g. Nordic / New Nordic)"
                        autoFocus
                      />
                      {hasDescription && (
                        <input
                          type="text"
                          value={addForm[key].description}
                          onChange={(e) => setAddForm((p) => ({ ...p, [key]: { ...p[key], description: e.target.value } }))}
                          className="w-full rounded-lg border border-[#2A2A2A] px-3 py-1.5 text-sm text-[#999999] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50"
                          placeholder="Description (optional)"
                        />
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAdd(key)}
                          disabled={addSaving[key] || !addForm[key].label.trim()}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#D4A574] rounded-lg hover:bg-[#C4956A] disabled:opacity-50"
                        >
                          {addSaving[key] ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                          Add
                        </button>
                        <button
                          onClick={() => toggleAdd(key)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#E5E5E5] bg-[#1E1E1E] rounded-lg hover:bg-[#2A2A2A]"
                        >
                          <X className="size-3" /> Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="px-5 py-3">
                      <button
                        onClick={() => toggleAdd(key)}
                        className="flex items-center gap-2 text-sm text-[#D4A574] hover:text-[#D4A574] font-medium"
                      >
                        <Plus className="size-4" /> Add {label.slice(0, -1)}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
