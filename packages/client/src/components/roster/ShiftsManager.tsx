/**
 * @module components/roster/ShiftsManager
 *
 * The roster builder: create shifts, assign staff, and publish. Assignment
 * failures from canAssign() are surfaced verbatim — "Cannot assign. Alex's
 * RSA expired on 15 June 2026." — never paraphrased or swallowed.
 */

import { useEffect, useState } from "react";
import { CalendarDays, CalendarHeart, ChevronDown, ChevronRight, Loader2, MapPin, Pencil, Plus, Send, Trash2, UserPlus } from "lucide-react";
import { formatShiftRange, durationHours, daysBetweenLocal } from "@culinaire/shared";
import { useLocation } from "../../context/LocationContext.js";
import { useHasPermission } from "../../hooks/useHasPermission.js";
import {
  useShifts,
  useRosterRoles,
  useOrgMembers,
  fetchShiftAssignments,
  requestConsent,
  type Shift,
  type ShiftAssignmentRow,
  type OrgMember,
} from "../../hooks/useRoster.js";
import { EmptyState } from "../ui/EmptyState.js";
import { PublishPanel } from "./PublishPanel.js";

/** Above 16h, or more than a single overnight (>1 calendar-day boundary crossed),
 *  a shift needs an explicit confirm before it can be created or saved. */
function shiftNeedsConfirm(startDatetime: string, endDatetime: string): boolean {
  if (!startDatetime || !endDatetime) return false;
  const startIso = new Date(startDatetime).toISOString();
  const endIso = new Date(endDatetime).toISOString();
  const hours = durationHours(startIso, endIso);
  return hours > 0 && (hours > 16 || daysBetweenLocal(startIso, endIso) > 1);
}

/** "7d 1h", "16h 30m", "45m" — a compact duration label for the warning banner. */
function formatDurationLabel(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const days = Math.floor(totalMinutes / (24 * 60));
  const remHours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (remHours > 0) parts.push(`${remHours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push("0m");
  return parts.join(" ");
}

/** Start/end datetime-local inputs shared by the create form and the Edit
 *  panel, with a live duration readout and a warning + required confirm
 *  checkbox above 16h or when the shift spans more than one overnight. */
export function ShiftTimeFields({
  startDatetime,
  endDatetime,
  onStartChange,
  onEndChange,
  confirmed,
  onConfirmedChange,
}: {
  startDatetime: string;
  endDatetime: string;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
  confirmed: boolean;
  onConfirmedChange: (v: boolean) => void;
}) {
  const hasBoth = Boolean(startDatetime && endDatetime);
  const startIso = hasBoth ? new Date(startDatetime).toISOString() : null;
  const endIso = hasBoth ? new Date(endDatetime).toISOString() : null;
  const hours = startIso && endIso ? durationHours(startIso, endIso) : null;
  const needsWarning = hasBoth && shiftNeedsConfirm(startDatetime, endDatetime);

  // A prior confirm only covers the times it was given for — editing either
  // field again must re-arm the warning, or a confirmed-then-edited shift
  // could submit unconfirmed (the exact class of bad data this form exists
  // to catch).
  function handleStartChange(v: string) {
    onConfirmedChange(false);
    onStartChange(v);
  }
  function handleEndChange(v: string) {
    onConfirmedChange(false);
    onEndChange(v);
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs text-dark-600">
          Start
          <input
            type="datetime-local"
            value={startDatetime}
            onChange={(e) => handleStartChange(e.target.value)}
            className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
          />
        </label>
        <label className="text-xs text-dark-600">
          End
          <input
            type="datetime-local"
            value={endDatetime}
            onChange={(e) => handleEndChange(e.target.value)}
            className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
          />
        </label>
      </div>
      {hours !== null && hours > 0 && (
        <p className="mt-2 text-xs text-dark-600">Duration: {formatDurationLabel(hours)}</p>
      )}
      {needsWarning && (
        <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <p className="text-xs text-amber-300">
            This shift is unusually long ({formatDurationLabel(hours!)}) — double check the end date.
          </p>
          <label className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-300/80">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => onConfirmedChange(e.target.checked)}
              className="size-4 rounded border-amber-500/40 bg-dark accent-gold focus:outline-none focus:ring-2 focus:ring-gold-ring"
            />
            I confirm this is correct
          </label>
        </div>
      )}
    </>
  );
}

function statusTone(status: string): string {
  if (status === "Published") return "border-emerald-500/40 text-emerald-400";
  if (status === "Cancelled") return "border-red-500/40 text-red-400";
  return "border-dark-300 text-dark-600"; // Draft
}

function consentTone(consent: string): string {
  if (consent === "Accepted") return "border-emerald-500/40 text-emerald-400";
  if (consent === "Declined") return "border-red-500/40 text-red-400";
  return "border-amber-500/40 text-amber-400"; // Requested
}

export function ShiftsManager() {
  const hasPermission = useHasPermission();
  const canManage = hasPermission("roster:manage");
  const canPublish = hasPermission("roster:publish");
  const { locations, selectedLocationId } = useLocation();
  const orgId = locations.find((l) => l.storeLocationId === selectedLocationId)?.organisationId ?? null;

  const { shifts, isLoading, error, refresh, create, update, cancel, assign, removeAssignment } =
    useShifts(selectedLocationId);
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
  const [durationConfirmed, setDurationConfirmed] = useState(false);

  function roleName(id: string): string {
    return roles.find((r) => r.rosterRoleId === id)?.roleName ?? "—";
  }

  const createNeedsConfirm = shiftNeedsConfirm(startDatetime, endDatetime);

  async function handleCreate() {
    setFormError(null);
    if (!rosterRoleId || !startDatetime || !endDatetime || !selectedLocationId) {
      setFormError("Role, start, and end are all required");
      return;
    }
    if (createNeedsConfirm && !durationConfirmed) {
      setFormError("Please confirm the shift duration before creating it");
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
      setDurationConfirmed(false);
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
          <div className="mt-3">
            <ShiftTimeFields
              startDatetime={startDatetime}
              endDatetime={endDatetime}
              onStartChange={setStartDatetime}
              onEndChange={setEndDatetime}
              confirmed={durationConfirmed}
              onConfirmedChange={setDurationConfirmed}
            />
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
              disabled={saving || (createNeedsConfirm && !durationConfirmed)}
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
              onUpdate={(data) => update(s.shiftId, data)}
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
  onUpdate,
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
  onUpdate: (data: { startDatetime?: string; endDatetime?: string }) => Promise<void>;
  onAssign: (userId: number) => Promise<void>;
  onRemoveAssignment: (assignmentId: string) => Promise<void>;
}) {
  const [assignments, setAssignments] = useState<ShiftAssignmentRow[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [requestingConsentFor, setRequestingConsentFor] = useState<string | null>(null);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editConfirmed, setEditConfirmed] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function toDatetimeLocal(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function startEditing() {
    setEditStart(toDatetimeLocal(shift.startDatetime));
    setEditEnd(toDatetimeLocal(shift.endDatetime));
    setEditConfirmed(false);
    setEditError(null);
    setIsEditing(true);
  }

  const editNeedsConfirm = shiftNeedsConfirm(editStart, editEnd);

  async function handleSaveEdit() {
    setEditError(null);
    if (editNeedsConfirm && !editConfirmed) {
      setEditError("Please confirm the shift duration before saving");
      return;
    }
    setEditSaving(true);
    try {
      await onUpdate({
        startDatetime: new Date(editStart).toISOString(),
        endDatetime: new Date(editEnd).toISOString(),
      });
      setIsEditing(false);
    } catch (err) {
      // Relayed verbatim — the server's own Draft-only/end>start refusal text.
      setEditError(err instanceof Error ? err.message : "Failed to update shift");
    } finally {
      setEditSaving(false);
    }
  }

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

  async function handleRequestConsent(assignmentId: string) {
    setConsentError(null);
    setRequestingConsentFor(assignmentId);
    try {
      await requestConsent(assignmentId);
      setAssignments(await fetchShiftAssignments(shift.shiftId));
    } catch (err) {
      // e.g. "This shift is not on a loaded public holiday date." — relayed verbatim.
      setConsentError(err instanceof Error ? err.message : "Failed to request consent");
    } finally {
      setRequestingConsentFor(null);
    }
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
          <span className="text-dark-600 text-xs truncate">{formatShiftRange(shift.startDatetime, shift.endDatetime)}</span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(shift.status)}`}>
            {shift.status}
          </span>
          {canManage && shift.status === "Draft" && (
            <button
              type="button"
              onClick={startEditing}
              className="p-1.5 rounded-lg hover:bg-dark-200 text-dark-500 hover:text-white transition-all"
              aria-label="Edit shift time"
            >
              <Pencil className="size-3.5" />
            </button>
          )}
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
      {isEditing && (
        <div className="border-t border-gold/20 bg-dark/50 px-4 py-3 animate-fade-in">
          <ShiftTimeFields
            startDatetime={editStart}
            endDatetime={editEnd}
            onStartChange={setEditStart}
            onEndChange={setEditEnd}
            confirmed={editConfirmed}
            onConfirmedChange={setEditConfirmed}
          />
          {editError && <p className="mt-2 text-sm text-red-400">{editError}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="rounded-lg px-4 py-2 text-sm text-dark-600 hover:text-white transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={editSaving || (editNeedsConfirm && !editConfirmed)}
              className="flex items-center gap-1.5 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-dark transition-all hover:bg-gold-hover disabled:opacity-50"
            >
              {editSaving && <Loader2 className="size-3.5 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      )}
      {isExpanded && (
        <div className="border-t border-gold/20 bg-dark/50 px-4 py-3 space-y-2 animate-fade-in">
          <p className="text-xs text-dark-500 uppercase tracking-wider">Assigned staff</p>
          {loadingAssignments ? (
            <Loader2 className="size-4 text-gold animate-spin" />
          ) : assignments.length === 0 ? (
            <p className="text-xs text-dark-600">Nobody assigned yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {assignments.map((a) => (
                <li key={a.assignmentId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-white truncate">
                    {a.staffName} <span className="text-dark-600 text-xs">({a.status})</span>
                    {a.publicHolidayConsent && (
                      <span
                        className={`ml-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${consentTone(a.publicHolidayConsent)}`}
                      >
                        <CalendarHeart className="size-3" aria-hidden="true" />
                        Holiday: {a.publicHolidayConsent}
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {canManage && shift.status === "Draft" && a.publicHolidayConsent !== "Accepted" && (
                      <button
                        type="button"
                        onClick={() => handleRequestConsent(a.assignmentId)}
                        disabled={requestingConsentFor === a.assignmentId}
                        className="rounded-lg border border-dark-200 px-2 py-1 text-[11px] text-dark-600 hover:text-white hover:border-gold/40 transition-all disabled:opacity-50"
                      >
                        {requestingConsentFor === a.assignmentId ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : a.publicHolidayConsent ? (
                          "Re-request holiday consent"
                        ) : (
                          "Request holiday consent"
                        )}
                      </button>
                    )}
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
                  </div>
                </li>
              ))}
            </ul>
          )}
          {consentError && (
            <p className="text-xs text-red-400 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 mt-1">
              {consentError}
            </p>
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
