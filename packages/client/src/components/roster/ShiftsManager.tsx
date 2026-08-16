/**
 * @module components/roster/ShiftsManager
 *
 * The roster builder: create shifts, assign staff, and publish. Assignment
 * failures from canAssign() are surfaced verbatim — "Cannot assign. Alex's
 * RSA expired on 15 June 2026." — never paraphrased or swallowed.
 */

import { useEffect, useState } from "react";
import { CalendarDays, ChevronDown, ChevronRight, Loader2, MapPin, Plus, Send, Trash2, UserPlus } from "lucide-react";
import { useLocation } from "../../context/LocationContext.js";
import { useHasPermission } from "../../hooks/useHasPermission.js";
import {
  useShifts,
  useRosterRoles,
  useOrgMembers,
  fetchShiftAssignments,
  type Shift,
  type ShiftAssignmentRow,
  type OrgMember,
} from "../../hooks/useRoster.js";
import { EmptyState } from "../ui/EmptyState.js";
import { PublishPanel } from "./PublishPanel.js";

function formatShiftTime(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const dateFmt: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
  const timeFmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  return `${start.toLocaleDateString("en-AU", dateFmt)}, ${start.toLocaleTimeString("en-AU", timeFmt)}–${end.toLocaleTimeString("en-AU", timeFmt)}`;
}

function statusTone(status: string): string {
  if (status === "Published") return "border-emerald-500/40 text-emerald-400";
  if (status === "Cancelled") return "border-red-500/40 text-red-400";
  return "border-dark-300 text-dark-600"; // Draft
}

export function ShiftsManager() {
  const hasPermission = useHasPermission();
  const canManage = hasPermission("roster:manage");
  const canPublish = hasPermission("roster:publish");
  const { locations, selectedLocationId } = useLocation();
  const orgId = locations.find((l) => l.storeLocationId === selectedLocationId)?.organisationId ?? null;

  const { shifts, isLoading, error, refresh, create, cancel, assign, removeAssignment } = useShifts(selectedLocationId);
  const { roles } = useRosterRoles();
  const { members } = useOrgMembers(orgId);

  const [showCreate, setShowCreate] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rosterRoleId, setRosterRoleId] = useState("");
  const [startDatetime, setStartDatetime] = useState("");
  const [endDatetime, setEndDatetime] = useState("");

  function roleName(id: string): string {
    return roles.find((r) => r.rosterRoleId === id)?.roleName ?? "—";
  }

  async function handleCreate() {
    setFormError(null);
    if (!rosterRoleId || !startDatetime || !endDatetime || !selectedLocationId) {
      setFormError("Role, start, and end are all required");
      return;
    }
    setSaving(true);
    try {
      await create({
        storeLocationId: selectedLocationId,
        rosterRoleId,
        startDatetime: new Date(startDatetime).toISOString(),
        endDatetime: new Date(endDatetime).toISOString(),
      });
      setShowCreate(false);
      setRosterRoleId("");
      setStartDatetime("");
      setEndDatetime("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create shift");
    } finally {
      setSaving(false);
    }
  }

  if (!selectedLocationId) {
    return (
      <EmptyState
        icon={MapPin}
        title="No venue selected"
        body="Pick a venue from the location switcher to see and build its roster."
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 text-gold animate-spin" />
      </div>
    );
  }

  const visibleShifts = [...shifts]
    .filter((s) => s.status !== "Cancelled")
    .sort((a, b) => a.startDatetime.localeCompare(b.startDatetime));

  return (
    <div className="space-y-4 animate-fade-in-up">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-dark-600">Shifts at this venue.</p>
        <div className="flex gap-2">
          {canManage && (
            <button
              type="button"
              onClick={() => setShowCreate((v) => !v)}
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-gold to-gold-hover px-4 py-2 text-sm font-semibold text-dark transition-all hover:shadow-[0_0_12px_rgba(212,165,116,0.2)] active:scale-[0.98]"
            >
              <Plus className="size-4" /> New shift
            </button>
          )}
          {canPublish && (
            <button
              type="button"
              onClick={() => setShowPublish((v) => !v)}
              className="flex items-center gap-1.5 rounded-xl border border-gold/30 px-4 py-2 text-sm font-semibold text-gold transition-all hover:bg-gold-dim active:scale-[0.98]"
            >
              <Send className="size-4" /> Publish…
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {showPublish && selectedLocationId && (
        <PublishPanel storeLocationId={selectedLocationId} onClose={() => setShowPublish(false)} onPublished={refresh} />
      )}

      {showCreate && (
        <div className="rounded-xl border border-gold/20 bg-dark-50 p-4 animate-scale-in">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-xs text-dark-600">
              Role
              <select
                value={rosterRoleId}
                onChange={(e) => setRosterRoleId(e.target.value)}
                className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
              >
                <option value="">Select a role…</option>
                {roles.map((r) => (
                  <option key={r.rosterRoleId} value={r.rosterRoleId}>
                    {r.roleName}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-dark-600">
              Start
              <input
                type="datetime-local"
                value={startDatetime}
                onChange={(e) => setStartDatetime(e.target.value)}
                className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
              />
            </label>
            <label className="text-xs text-dark-600">
              End
              <input
                type="datetime-local"
                value={endDatetime}
                onChange={(e) => setEndDatetime(e.target.value)}
                className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
              />
            </label>
          </div>
          {formError && <p className="mt-2 text-sm text-red-400">{formError}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded-lg px-4 py-2 text-sm text-dark-600 hover:text-white transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-dark transition-all hover:bg-gold-hover disabled:opacity-50"
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              Create
            </button>
          </div>
        </div>
      )}

      {visibleShifts.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No shifts yet"
          body="Build the roster by creating shifts and assigning staff to them."
          action={canManage ? { label: "New shift", onClick: () => setShowCreate(true) } : undefined}
        />
      ) : (
        <div className="rounded-xl border border-dark-200 overflow-hidden">
          {visibleShifts.map((s) => (
            <ShiftRow
              key={s.shiftId}
              shift={s}
              roleName={roleName(s.rosterRoleId)}
              members={members}
              canManage={canManage}
              isExpanded={expandedId === s.shiftId}
              onToggle={() => setExpandedId(expandedId === s.shiftId ? null : s.shiftId)}
              onCancel={() => cancel(s.shiftId)}
              onAssign={(userId) => assign(s.shiftId, userId)}
              onRemoveAssignment={removeAssignment}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ShiftRow({
  shift,
  roleName,
  members,
  canManage,
  isExpanded,
  onToggle,
  onCancel,
  onAssign,
  onRemoveAssignment,
}: {
  shift: Shift;
  roleName: string;
  members: OrgMember[];
  canManage: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onCancel: () => void;
  onAssign: (userId: number) => Promise<void>;
  onRemoveAssignment: (assignmentId: string) => Promise<void>;
}) {
  const [assignments, setAssignments] = useState<ShiftAssignmentRow[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    if (!isExpanded) return;
    setLoadingAssignments(true);
    fetchShiftAssignments(shift.shiftId)
      .then(setAssignments)
      .catch(() => setAssignments([]))
      .finally(() => setLoadingAssignments(false));
  }, [isExpanded, shift.shiftId]);

  async function handleAssign() {
    if (!selectedUserId) return;
    setAssignError(null);
    setAssigning(true);
    try {
      await onAssign(Number(selectedUserId));
      setAssignments(await fetchShiftAssignments(shift.shiftId));
      setSelectedUserId("");
    } catch (err) {
      // Relayed verbatim — this is canAssign's dated refusal message, e.g.
      // "Cannot assign. Alex's RSA expired on 15 June 2026." Never paraphrased.
      setAssignError(err instanceof Error ? err.message : "Failed to assign staff");
    } finally {
      setAssigning(false);
    }
  }

  async function handleRemove(assignmentId: string) {
    await onRemoveAssignment(assignmentId);
    setAssignments(await fetchShiftAssignments(shift.shiftId));
  }

  return (
    <div className="border-b border-dark-200/30 last:border-b-0">
      <div className="flex items-center justify-between px-4 py-3">
        <button type="button" onClick={onToggle} className="flex items-center gap-1.5 text-left flex-1 min-w-0">
          {isExpanded ? (
            <ChevronDown className="size-3 text-dark-500 shrink-0" />
          ) : (
            <ChevronRight className="size-3 text-dark-500 shrink-0" />
          )}
          <span className="text-white text-sm truncate">{roleName}</span>
          <span className="text-dark-600 text-xs truncate">{formatShiftTime(shift.startDatetime, shift.endDatetime)}</span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(shift.status)}`}>
            {shift.status}
          </span>
          {canManage && shift.status === "Draft" && (
            <button
              type="button"
              onClick={onCancel}
              className="p-1.5 rounded-lg hover:bg-dark-200 text-dark-500 hover:text-red-400 transition-all"
              aria-label="Cancel shift"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      {isExpanded && (
        <div className="border-t border-gold/20 bg-dark/50 px-4 py-3 space-y-2 animate-fade-in">
          <p className="text-xs text-dark-500 uppercase tracking-wider">Assigned staff</p>
          {loadingAssignments ? (
            <Loader2 className="size-4 text-gold animate-spin" />
          ) : assignments.length === 0 ? (
            <p className="text-xs text-dark-600">Nobody assigned yet.</p>
          ) : (
            <ul className="space-y-1">
              {assignments.map((a) => (
                <li key={a.assignmentId} className="flex items-center justify-between text-sm">
                  <span className="text-white">
                    {a.staffName} <span className="text-dark-600 text-xs">({a.status})</span>
                  </span>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => handleRemove(a.assignmentId)}
                      className="p-1 rounded-lg hover:bg-dark-200 text-dark-500 hover:text-red-400 transition-all"
                      aria-label={`Remove ${a.staffName}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canManage && shift.status === "Draft" && (
            <div className="flex gap-2 pt-2">
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="flex-1 rounded-lg bg-dark-100 border border-dark-200 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-gold/50"
              >
                <option value="">Assign staff…</option>
                {members
                  .filter((m) => !assignments.some((a) => a.userId === m.userId))
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.displayName}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                onClick={handleAssign}
                disabled={assigning || !selectedUserId}
                className="flex items-center gap-1 rounded-lg bg-dark-200 px-3 py-1.5 text-xs text-white hover:bg-dark-300 transition-all disabled:opacity-50"
              >
                {assigning ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}
                Assign
              </button>
            </div>
          )}
          {assignError && (
            <p className="text-xs text-red-400 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 mt-1">
              {assignError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
