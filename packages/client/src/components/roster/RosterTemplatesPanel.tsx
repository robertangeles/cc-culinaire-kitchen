/**
 * @module components/roster/RosterTemplatesPanel
 *
 * UI for Roster Scheduling Templates (docs/designs/roster-scheduling-templates.md):
 * a saved weekly pattern per venue, turned into real Draft shifts via
 * "Generate this week". Placed inline on the Calendar tab per that design's
 * UI Placement decision (2026-09-07) — a second toolbar row with three
 * actions, each opening a centered MODAL, never a popover anchored to the
 * toolbar. Modals are used specifically so RosterCalendarView.tsx's own
 * hand-rolled drag-gesture/pointer-events code (see that file's module doc)
 * never has to coexist with this feature's own state or z-index handling.
 */

import { useState } from "react";
import { Layers, Sparkles, Undo2, X, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import {
  useRosterTemplates,
  type RosterShiftTemplate,
  type TemplateRowInput,
  type GenerateWeekResult,
} from "../../hooks/useRoster.js";
import type { RosterRole } from "../../hooks/useRoster.js";
import { EmptyState } from "../ui/EmptyState.js";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// Display/grouping order is Monday-first, matching the calendar grid's own
// column order — the stored dayOfWeek value itself is 0=Sunday..6=Saturday
// (staff_availability's convention, per the design doc).
const ORDERED_DOW: Array<{ value: number; label: string }> = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
];

function ModalShell({ title, onClose, children, maxWidth = "max-w-lg" }: { title: string; onClose: () => void; children: React.ReactNode; maxWidth?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className={`w-full ${maxWidth} max-h-[85vh] overflow-hidden rounded-2xl border border-dark-200 bg-dark-50 shadow-xl flex flex-col animate-scale-in`}>
        <div className="flex items-center justify-between border-b border-dark-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-[#FAFAFA]">{title}</h3>
          <button type="button" onClick={onClose} className="p-1 text-dark-600 hover:text-[#FAFAFA] transition-colors" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

interface TemplateFormState {
  storeLocationId: string;
  rosterRoleId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

function emptyForm(storeLocationId: string, venueRoles: RosterRole[]): TemplateFormState {
  return {
    storeLocationId,
    rosterRoleId: venueRoles[0]?.rosterRoleId ?? "",
    dayOfWeek: 1,
    startTime: "09:00",
    endTime: "17:00",
  };
}

function TemplateRowFormFields({ form, setForm, venueRoles }: { form: TemplateFormState; setForm: (f: TemplateFormState) => void; venueRoles: RosterRole[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="col-span-2 text-xs text-dark-600">
        Role
        <select
          value={form.rosterRoleId}
          onChange={(e) => setForm({ ...form, rosterRoleId: e.target.value })}
          className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
        >
          {venueRoles.map((r) => (
            <option key={r.rosterRoleId} value={r.rosterRoleId}>
              {r.roleName}
            </option>
          ))}
        </select>
      </label>
      <label className="col-span-2 text-xs text-dark-600">
        Day
        <select
          value={form.dayOfWeek}
          onChange={(e) => setForm({ ...form, dayOfWeek: Number(e.target.value) })}
          className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
        >
          {ORDERED_DOW.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-dark-600">
        Start time
        <input
          type="time"
          value={form.startTime}
          onChange={(e) => setForm({ ...form, startTime: e.target.value })}
          className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
        />
      </label>
      <label className="text-xs text-dark-600">
        End time
        <input
          type="time"
          value={form.endTime}
          onChange={(e) => setForm({ ...form, endTime: e.target.value })}
          className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
        />
      </label>
    </div>
  );
}

function ManageTemplatesModal({
  storeLocationId,
  venueRoles,
  onClose,
}: {
  storeLocationId: string;
  venueRoles: RosterRole[];
  onClose: () => void;
}) {
  const { templates, isLoading, error, create, update, remove } = useRosterTemplates(storeLocationId);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<TemplateFormState>(() => emptyForm(storeLocationId, venueRoles));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const roleName = (id: string) => venueRoles.find((r) => r.rosterRoleId === id)?.roleName ?? "Unknown role";

  function startAdd() {
    setForm(emptyForm(storeLocationId, venueRoles));
    setFormError(null);
    setEditingId("new");
  }

  function startEdit(row: RosterShiftTemplate) {
    setForm({
      storeLocationId: row.storeLocationId,
      rosterRoleId: row.rosterRoleId,
      dayOfWeek: row.dayOfWeek,
      startTime: row.startTime,
      endTime: row.endTime,
    });
    setFormError(null);
    setEditingId(row.rosterShiftTemplateId);
  }

  async function handleSave() {
    setFormError(null);
    if (!form.rosterRoleId) {
      setFormError("Select a role");
      return;
    }
    if (!TIME_RE.test(form.startTime) || !TIME_RE.test(form.endTime)) {
      setFormError("Enter valid start and end times");
      return;
    }
    if (form.startTime === form.endTime) {
      setFormError("Start and end time cannot be the same");
      return;
    }
    const input: TemplateRowInput = { ...form };
    setSaving(true);
    try {
      if (editingId === "new") await create(input);
      else if (editingId) await update(editingId, input);
      setEditingId(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save template row");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await remove(id);
    } catch {
      // remove() failures are rare (404 on a row just deleted elsewhere) —
      // a silent refresh-on-next-render is enough, no blocking error UI needed.
    }
  }

  const grouped = ORDERED_DOW.map((d) => ({
    ...d,
    rows: templates
      .filter((t) => t.dayOfWeek === d.value)
      .sort((a, b) => a.startTime.localeCompare(b.startTime)),
  }));

  return (
    <ModalShell title="Weekly Templates" onClose={onClose} maxWidth="max-w-2xl">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-dark-600">One row per role, per day. Split shifts (e.g. lunch + dinner) are separate rows.</p>
        {editingId === null && (
          <button
            type="button"
            onClick={startAdd}
            disabled={venueRoles.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-gold to-gold-hover px-3 py-1.5 text-xs font-semibold text-dark transition-all hover:shadow-[0_0_12px_rgba(212,165,116,0.2)] active:scale-[0.98] disabled:opacity-50"
          >
            <Plus className="size-3.5" /> Add Template Row
          </button>
        )}
      </div>

      {error && <p className="mb-2 text-sm text-red-400">{error}</p>}

      {editingId !== null && (
        <div className="mb-4 rounded-xl border border-gold/20 bg-dark-100/50 p-4 animate-scale-in">
          <TemplateRowFormFields form={form} setForm={setForm} venueRoles={venueRoles} />
          {formError && <p className="mt-2 text-sm text-red-400">{formError}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setEditingId(null)} className="rounded-lg px-4 py-2 text-sm text-dark-600 hover:text-white transition-all">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-dark transition-all hover:bg-gold-hover disabled:opacity-50"
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="size-5 text-gold animate-spin" />
        </div>
      ) : templates.length === 0 && editingId === null ? (
        <EmptyState
          icon={Layers}
          title="No templates yet"
          body={
            venueRoles.length === 0
              ? "No roles exist for this venue yet — add one from the Roles tab."
              : "Build a weekly pattern once, then generate any week in one click."
          }
          action={venueRoles.length > 0 ? { label: "Create your first template row", onClick: startAdd } : undefined}
        />
      ) : (
        <div className="space-y-3">
          {grouped
            .filter((g) => g.rows.length > 0)
            .map((g) => (
              <div key={g.value}>
                <p className="mb-1.5 text-xs font-semibold text-gold">
                  {g.label} <span className="font-normal text-dark-600">· {g.rows.length} row{g.rows.length === 1 ? "" : "s"}</span>
                </p>
                <div className="space-y-1.5">
                  {g.rows.map((row) => (
                    <div
                      key={row.rosterShiftTemplateId}
                      className="flex items-center justify-between rounded-lg border border-dark-200 bg-dark-100/30 px-3 py-2 transition-colors hover:border-dark-300"
                    >
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-[#FAFAFA]">{roleName(row.rosterRoleId)}</span>
                        <span className="text-dark-600">
                          {row.startTime} – {row.endTime}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          className="p-1.5 text-dark-600 hover:text-gold transition-colors"
                          aria-label={`Edit ${roleName(row.rosterRoleId)} on ${g.label}`}
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(row.rosterShiftTemplateId)}
                          className="p-1.5 text-dark-600 hover:text-red-400 transition-colors"
                          aria-label={`Delete ${roleName(row.rosterRoleId)} on ${g.label}`}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </ModalShell>
  );
}

function GenerateWeekModal({
  storeLocationId,
  defaultWeekStart,
  onClose,
  onGenerated,
}: {
  storeLocationId: string;
  defaultWeekStart: string;
  onClose: () => void;
  onGenerated: () => void;
}) {
  const { generateWeek } = useRosterTemplates(storeLocationId);
  const [weekStart, setWeekStart] = useState(defaultWeekStart);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<GenerateWeekResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleGenerate() {
    setFormError(null);
    setRunning(true);
    try {
      const outcome = await generateWeek(weekStart);
      setResult(outcome);
      onGenerated();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to generate shifts");
    } finally {
      setRunning(false);
    }
  }

  return (
    <ModalShell title="Generate This Week" onClose={onClose}>
      <p className="mb-3 text-xs text-dark-600">
        Creates a Draft shift for every template row that doesn't already have one this week. Existing shifts are never duplicated or overwritten.
      </p>
      <label className="text-xs text-dark-600">
        Week starting (Monday)
        <input
          type="date"
          value={weekStart}
          onChange={(e) => setWeekStart(e.target.value)}
          className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
        />
      </label>

      {formError && <p className="mt-3 text-sm text-red-400">{formError}</p>}

      {result && (
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
            result.failed > 0
              ? "border-red-500/20 bg-red-500/10 text-red-400"
              : "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
          }`}
        >
          Created {result.created}, skipped {result.skipped}
          {result.failed > 0 ? `, ${result.failed} failed` : ""}.
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-dark-600 hover:text-white transition-all">
          {result ? "Close" : "Cancel"}
        </button>
        {!result && (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={running}
            className="flex items-center gap-1.5 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-dark transition-all hover:bg-gold-hover disabled:opacity-50"
          >
            {running && <Loader2 className="size-3.5 animate-spin" />}
            Generate
          </button>
        )}
      </div>
    </ModalShell>
  );
}

function UndoGenerationModal({
  storeLocationId,
  defaultWeekStart,
  onClose,
  onGenerated,
}: {
  storeLocationId: string;
  defaultWeekStart: string;
  onClose: () => void;
  onGenerated: () => void;
}) {
  const { undoGeneration } = useRosterTemplates(storeLocationId);
  const [weekStart, setWeekStart] = useState(defaultWeekStart);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleUndo() {
    setFormError(null);
    setRunning(true);
    try {
      const outcome = await undoGeneration(weekStart);
      setResult(outcome.cancelled);
      onGenerated();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to undo generation");
    } finally {
      setRunning(false);
    }
  }

  return (
    <ModalShell title="Undo Last Generation" onClose={onClose}>
      <p className="mb-3 text-xs text-dark-600">
        Cancels every shift generated for the chosen venue and week. Manually created shifts and shifts from other weeks are never touched. This can't be undone.
      </p>
      <label className="text-xs text-dark-600">
        Week starting (Monday)
        <input
          type="date"
          value={weekStart}
          onChange={(e) => setWeekStart(e.target.value)}
          className="mt-1 w-full rounded-lg bg-dark-100 border border-dark-200 px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
        />
      </label>

      {formError && <p className="mt-3 text-sm text-red-400">{formError}</p>}

      {result !== null ? (
        <div className="mt-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
          Cancelled {result} shift{result === 1 ? "" : "s"}.
        </div>
      ) : (
        !confirming && (
          <p className="mt-3 text-xs text-dark-600">This cancels real shifts — you'll be asked to confirm on the next step.</p>
        )
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-dark-600 hover:text-white transition-all">
          {result !== null ? "Close" : "Cancel"}
        </button>
        {result === null && !confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex items-center gap-1.5 rounded-lg border border-red-500/40 px-4 py-2 text-sm font-semibold text-red-400 transition-all hover:bg-red-500/10"
          >
            <Undo2 className="size-3.5" /> Undo Generation
          </button>
        )}
        {result === null && confirming && (
          <button
            type="button"
            onClick={handleUndo}
            disabled={running}
            className="flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-red-600 disabled:opacity-50"
          >
            {running && <Loader2 className="size-3.5 animate-spin" />}
            Confirm — cancel these shifts
          </button>
        )}
      </div>
    </ModalShell>
  );
}

export function RosterTemplatesToolbar({
  storeLocationId,
  venueRoles,
  weekStart,
  onGenerated,
}: {
  storeLocationId: string;
  venueRoles: RosterRole[];
  weekStart: string;
  onGenerated: () => void;
}) {
  const [openModal, setOpenModal] = useState<"manage" | "generate" | "undo" | null>(null);

  return (
    <>
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-dark-200 bg-dark-50/50 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-dark-600">
          <Layers className="size-3.5" /> Templates
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpenModal("manage")}
            className="rounded-lg border border-dark-200 px-2.5 py-1 text-xs text-dark-600 hover:text-[#FAFAFA] hover:bg-dark-100 transition-colors"
          >
            Manage Templates
          </button>
          <button
            type="button"
            onClick={() => setOpenModal("generate")}
            className="flex items-center gap-1 rounded-lg border border-gold/30 px-2.5 py-1 text-xs font-medium text-gold hover:bg-gold-dim transition-colors"
          >
            <Sparkles className="size-3.5" /> Generate This Week
          </button>
          <button
            type="button"
            onClick={() => setOpenModal("undo")}
            className="rounded-lg border border-dark-200 px-2.5 py-1 text-xs text-dark-600 hover:text-[#FAFAFA] hover:bg-dark-100 transition-colors"
          >
            Undo Last Generation
          </button>
        </div>
      </div>

      {openModal === "manage" && (
        <ManageTemplatesModal storeLocationId={storeLocationId} venueRoles={venueRoles} onClose={() => setOpenModal(null)} />
      )}
      {openModal === "generate" && (
        <GenerateWeekModal
          storeLocationId={storeLocationId}
          defaultWeekStart={weekStart}
          onClose={() => setOpenModal(null)}
          onGenerated={onGenerated}
        />
      )}
      {openModal === "undo" && (
        <UndoGenerationModal
          storeLocationId={storeLocationId}
          defaultWeekStart={weekStart}
          onClose={() => setOpenModal(null)}
          onGenerated={onGenerated}
        />
      )}
    </>
  );
}
