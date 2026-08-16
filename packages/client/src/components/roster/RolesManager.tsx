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
import { useRosterRoles, getRoleDocuments, setRoleDocuments, type RosterRole } from "../../hooks/useRoster.js";
import { EmptyState } from "../ui/EmptyState.js";

export function RolesManager() {
  const canManage = useHasPermission()("roster:manage");
  const { roles, isLoading, error, create, remove } = useRosterRoles();
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [roleName, setRoleName] = useState("");

  async function handleAdd() {
    setFormError(null);
    if (!roleName.trim()) {
      setFormError("Role name is required");
      return;
    }
    setSaving(true);
    try {
      await create({ roleName: roleName.trim() });
      setRoleName("");
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
}: {
  role: RosterRole;
  canManage: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [docTypes, setDocTypes] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [docsError, setDocsError] = useState<string | null>(null);

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
        </button>
        {canManage && (
          <button
            type="button"
            onClick={onDelete}
            className="p-1.5 rounded-lg hover:bg-dark-200 text-dark-500 hover:text-red-400 transition-all"
            aria-label="Delete role"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
      {isExpanded && (
        <div className="border-t border-gold/20 bg-dark/50 px-4 py-3 space-y-2 animate-fade-in">
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
            <div className="flex gap-2 pt-1">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="e.g. RSA"
                className="flex-1 rounded-lg bg-dark-100 border border-dark-200 px-3 py-1.5 text-xs text-white placeholder-dark-500 focus:outline-none focus:border-gold/50"
              />
              <button
                type="button"
                onClick={() => {
                  const trimmed = input.trim();
                  if (!trimmed) return;
                  handleSaveDocs([...docTypes, trimmed]);
                  setInput("");
                }}
                className="rounded-lg bg-dark-200 px-3 py-1.5 text-xs text-white hover:bg-dark-300 transition-all"
              >
                Add
              </button>
            </div>
          )}
          {docsError && <p className="text-xs text-red-400">{docsError}</p>}
        </div>
      )}
    </div>
  );
}
