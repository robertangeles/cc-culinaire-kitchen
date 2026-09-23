/**
 * @module components/roster/RolesManager
 *
 * Roster roles ("Bartender", "Line Cook") and, per role, which compliance
 * document types are required to be assigned into it. Create/edit require
 * roster:manage; the list itself is roster:read-all.
 */

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, ListChecks, Plus, Trash2 } from "lucide-react";
import { useHasPermission } from "../../hooks/useHasPermission.js";
import { useLocation } from "../../context/LocationContext.js";
import {
  useRosterRoles,
  getRoleDocuments,
  setRoleDocuments,
  type RosterRole,
  type RoleVenueConflict,
} from "../../hooks/useRoster.js";
import { useDocumentTypeSelection } from "../../hooks/useDocumentTypeSelection.js";
import { EmptyState } from "../ui/EmptyState.js";
import { DOCUMENT_TYPES } from "../../lib/complianceDocumentTypes.js";
import { OtherDocumentTypeInput } from "../compliance/OtherDocumentTypeInput.js";
import { VenueSelect } from "./VenueSelect.js";

export function RolesManager() {
  const canManage = useHasPermission()("roster:manage");
  const { roles, isLoading, error, create, update, remove } = useRosterRoles();
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [roleName, setRoleName] = useState("");
  const [venueId, setVenueId] = useState<string | null>(null);

  async function handleAdd() {
    setFormError(null);
    if (!roleName.trim()) {
      setFormError("Role name is required");
      return;
    }
    setSaving(true);
    try {
      await create({ roleName: roleName.trim(), storeLocationId: venueId });
      setRoleName("");
      setVenueId(null);
      setShowAdd(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create role");
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
      {canManage && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-dark-600">Roles staff can be rostered into, and what each one requires.</p>
          <button
            type="button"
            onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-gold to-gold-hover px-4 py-2 text-sm font-semibold text-dark transition-all hover:shadow-[0_0_12px_rgba(212,165,116,0.2)] active:scale-[0.98]"
          >
            <Plus className="size-4" /> Add role
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {showAdd && (
        <div className="rounded-xl border border-gold/20 bg-dark-50 p-4 animate-scale-in">
          <label className="text-xs text-dark-600">
            Role name
            <input
              type="text"
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              placeholder="e.g. Bartender"
              className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white placeholder-dark-500 focus:outline-none focus:border-gold/50"
            />
          </label>
          <label className="block text-xs text-dark-600">
            Venue
            <VenueSelect value={venueId} onChange={setVenueId} disabled={saving} />
          </label>
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

      {roles.length === 0 && !showAdd ? (
        <EmptyState
          icon={ListChecks}
          title="No roles defined yet"
          body="Add the roles staff get rostered into — you'll set which certificates each one requires next."
          action={canManage ? { label: "Add a role", onClick: () => setShowAdd(true) } : undefined}
        />
      ) : (
        <div className="rounded-xl border border-dark-200 overflow-hidden">
          {roles.map((r) => (
            <RoleRow
              key={r.rosterRoleId}
              role={r}
              canManage={canManage}
              isExpanded={expandedId === r.rosterRoleId}
              onToggle={() => setExpandedId(expandedId === r.rosterRoleId ? null : r.rosterRoleId)}
              onDelete={() => remove(r.rosterRoleId)}
              onUpdate={(data) => update(r.rosterRoleId, data)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RoleRow({
  role,
  canManage,
  isExpanded,
  onToggle,
  onDelete,
  onUpdate,
}: {
  role: RosterRole;
  canManage: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => Promise<void>;
  onUpdate: (data: { roleName: string; storeLocationId: string | null; confirmed?: boolean }) => Promise<void>;
}) {
  const { locations } = useLocation();
  const [docTypes, setDocTypes] = useState<string[]>([]);
  const {
    selectedType,
    setSelectedType,
    otherType,
    setOtherType,
    pendingType,
    otherTypeDuplicateOf,
    reset: resetDocumentType,
  } = useDocumentTypeSelection("", docTypes);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editVenueId, setEditVenueId] = useState<string | null>(role.storeLocationId);
  const [savingVenue, setSavingVenue] = useState(false);
  const [venueError, setVenueError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<RoleVenueConflict[] | null>(null);

  // Keep in sync when the underlying role changes externally (e.g. this
  // row's own successful save refreshes the parent's roles list, or
  // another session edited it) — RoleRow stays mounted (keyed by
  // rosterRoleId), so local edit state would otherwise go stale.
  useEffect(() => {
    setEditVenueId(role.storeLocationId);
  }, [role.storeLocationId]);

  const venueLabel = role.storeLocationId
    ? (locations.find((l) => l.storeLocationId === role.storeLocationId)?.locationName ?? "Unknown venue")
    : null;

  function handleVenueChange(next: string | null) {
    setEditVenueId(next);
    // Reset-on-change: a warning computed for a previous selection must
    // never be confirmable against a since-changed value (this exact bug
    // class already shipped once in ShiftTimeFields.tsx).
    setConflicts(null);
    setVenueError(null);
  }

  async function handleSaveVenue(confirmed = false) {
    setVenueError(null);
    setSavingVenue(true);
    try {
      await onUpdate({ roleName: role.roleName, storeLocationId: editVenueId, confirmed });
      setConflicts(null);
    } catch (err) {
      const withConflicts = err as Error & { conflicts?: RoleVenueConflict[] };
      if (withConflicts.conflicts && withConflicts.conflicts.length > 0) {
        setConflicts(withConflicts.conflicts);
      } else {
        setVenueError(err instanceof Error ? err.message : "Failed to update venue");
      }
    } finally {
      setSavingVenue(false);
    }
  }

  async function handleDelete() {
    setDeleteError(null);
    try {
      await onDelete();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete role");
    }
  }

  useEffect(() => {
    if (!isExpanded) return;
    getRoleDocuments(role.rosterRoleId)
      .then((types) => setDocTypes(types))
      .catch((err) => setDocsError(err instanceof Error ? err.message : "Failed to load requirements"));
  }, [isExpanded, role.rosterRoleId]);

  async function handleSaveDocs(next: string[]) {
    setDocsError(null);
    try {
      const saved = await setRoleDocuments(role.rosterRoleId, next);
      setDocTypes(saved);
    } catch (err) {
      setDocsError(err instanceof Error ? err.message : "Failed to save requirements");
    }
  }

  return (
    <div className="border-b border-dark-200/30 last:border-b-0">
      <div className="flex items-center justify-between px-4 py-3">
        <button type="button" onClick={onToggle} className="flex items-center gap-1.5 text-left flex-1">
          {isExpanded ? (
            <ChevronDown className="size-3 text-dark-500 shrink-0" />
          ) : (
            <ChevronRight className="size-3 text-dark-500 shrink-0" />
          )}
          <span className="text-white text-sm">{role.roleName}</span>
          {venueLabel && (
            <span className="animate-scale-in inline-flex items-center rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-xs text-gold">
              {venueLabel} only
            </span>
          )}
        </button>
        {canManage && (
          <button
            type="button"
            onClick={handleDelete}
            className="p-1.5 rounded-lg hover:bg-dark-200 text-dark-500 hover:text-red-400 transition-all"
            aria-label="Delete role"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      {deleteError && <p className="px-4 pb-3 text-sm text-red-400">{deleteError}</p>}
      {isExpanded && (
        <div className="border-t border-gold/20 bg-dark/50 px-4 py-3 space-y-2 animate-fade-in">
          {canManage && (
            <div className="space-y-1.5 pb-2 border-b border-dark-200/30">
              <label className="block text-xs text-dark-500 uppercase tracking-wider">
                Venue
                <VenueSelect value={editVenueId} onChange={handleVenueChange} disabled={savingVenue} />
              </label>
              {venueError && (
                <p role="alert" className="text-xs text-red-400">
                  {venueError}
                </p>
              )}
              {conflicts && (
                <div
                  role="alert"
                  className="animate-scale-in rounded-lg border border-gold/20 bg-gold/10 px-3 py-2 text-xs text-gold space-y-2"
                >
                  <p>
                    Templates at other venues will stop showing this role until you either revert this change or
                    update those templates: {conflicts.map((c) => c.locationName).join(", ")}.
                  </p>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        // "Cancel" means cancel the venue change, not just dismiss the
                        // warning — leaving editVenueId at the conflicting value made
                        // "Save changes" reappear right underneath with nothing actually
                        // cancelled.
                        setEditVenueId(role.storeLocationId);
                        setConflicts(null);
                      }}
                      className="text-xs text-dark-600 hover:text-white transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveVenue(true)}
                      disabled={savingVenue}
                      className="flex items-center gap-1.5 rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-dark hover:bg-gold-hover disabled:opacity-50"
                    >
                      {savingVenue && <Loader2 className="size-3 animate-spin" />}
                      Save anyway
                    </button>
                  </div>
                </div>
              )}
              {editVenueId !== role.storeLocationId && !conflicts && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleSaveVenue(false)}
                    disabled={savingVenue}
                    className="flex items-center gap-1.5 rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-dark hover:bg-gold-hover disabled:opacity-50"
                  >
                    {savingVenue && <Loader2 className="size-3 animate-spin" />}
                    Save changes
                  </button>
                </div>
              )}
            </div>
          )}
          <p className="text-xs text-dark-500 uppercase tracking-wider">Required documents</p>
          <div className="flex flex-wrap gap-1.5">
            {docTypes.length === 0 && <span className="text-xs text-dark-600">None required</span>}
            {docTypes.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full border border-dark-300 px-2.5 py-1 text-xs text-dark-600"
              >
                {t}
                {canManage && (
                  <button
                    type="button"
                    onClick={() => handleSaveDocs(docTypes.filter((d) => d !== t))}
                    aria-label={`Remove ${t}`}
                    className="hover:text-red-400"
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
          </div>
          {canManage && (
            <div className="flex flex-col gap-2 pt-1">
              <div className="flex gap-2">
                <select
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  aria-label="Document type"
                  className="flex-1 rounded-lg bg-dark-100 border border-dark-200 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-gold/50"
                >
                  <option value="">Choose a document type</option>
                  {DOCUMENT_TYPES.filter((t) => !docTypes.includes(t)).map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!pendingType}
                  onClick={() => {
                    if (!pendingType) return;
                    handleSaveDocs([...docTypes, pendingType]);
                    resetDocumentType();
                  }}
                  className="rounded-lg bg-dark-200 px-3 py-1.5 text-xs text-white hover:bg-dark-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add
                </button>
              </div>
              {selectedType === "Other" && (
                <>
                  <OtherDocumentTypeInput
                    value={otherType}
                    onChange={setOtherType}
                    className="rounded-lg bg-dark-100 border border-dark-200 px-3 py-1.5 text-xs text-white placeholder-dark-500 focus:outline-none focus:border-gold/50"
                  />
                  {otherTypeDuplicateOf && (
                    <p className="text-xs text-red-400">
                      Did you mean “{otherTypeDuplicateOf}”? This role already treats that as the same document.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          {docsError && <p className="text-xs text-red-400">{docsError}</p>}
        </div>
      )}
    </div>
  );
}
