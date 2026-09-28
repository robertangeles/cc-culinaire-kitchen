/**
 * @module hooks/useRosterCalendar
 *
 * Shifts, shift templates, calendar view, publish, my shifts, and availability.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { parseError } from "./useRosterRoles.js";

const API = import.meta.env.VITE_API_URL ?? "";
const BASE = `${API}/api/roster`;
const opts = { credentials: "include" as const };
const jsonOpts = { ...opts, headers: { "Content-Type": "application/json" } };

// ─── Types ────────────────────────────────────────────────────────

export type PublicHolidayConsent = "Requested" | "Accepted" | "Declined" | null;

export interface Shift {
  shiftId: string;
  organisationId: number;
  storeLocationId: string;
  rosterRoleId: string;
  startDatetime: string;
  endDatetime: string;
  isPublicHoliday: boolean;
  status: "Draft" | "Published" | "Cancelled";
  createdBy: number;
  createdDttm: string;
  updatedDttm: string;
}

export interface MyShift {
  shiftId: string;
  storeLocationId: string;
  rosterRoleId: string;
  roleName: string;
  startDatetime: string;
  endDatetime: string;
  status: string;
  assignmentId: string;
  assignmentStatus: "Pending" | "Confirmed" | "Declined" | "Removed";
  publicHolidayConsent: PublicHolidayConsent;
}

export interface Availability {
  staffAvailabilityId: string;
  userId: number;
  organisationId: number;
  storeLocationId: string | null;
  dayOfWeek: number;
  availableFrom: string;
  availableUntil: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
}

export interface AwardWarning {
  shiftId: string;
  severity: "advisory";
  message: string;
  ruleVersion: string;
  sourceCitation: string | null;
}

export interface AwardCoverage {
  checked: string[];
  notChecked: string[];
  ruleVersionsInScope: string[];
  jurisdiction: string | null;
}

export interface PublishResult {
  publishedShiftIds: string[];
  heldShifts: Array<{ shiftId: string; reason: string }>;
  awardWarnings: AwardWarning[];
  awardCoverage: AwardCoverage;
}

// ─── Shifts ───────────────────────────────────────────────────────

export function useShifts(storeLocationId: string | null) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Only the very first load shows the full-page spinner. A later refresh
  // (e.g. after publish) must not flip isLoading — ShiftsManager early-returns
  // a spinner while isLoading is true, which would unmount an open
  // PublishPanel and wipe its just-shown result out from under the user.
  const hasLoadedOnce = useRef(false);

  const refresh = useCallback(async () => {
    if (!storeLocationId) {
      setShifts([]);
      setIsLoading(false);
      return;
    }
    if (!hasLoadedOnce.current) setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/shifts?storeLocationId=${storeLocationId}`, opts);
      if (res.ok) setShifts(await res.json());
      else setError((await parseError(res, "Failed to load shifts")).message);
    } finally {
      setIsLoading(false);
      hasLoadedOnce.current = true;
    }
  }, [storeLocationId]);

  const create = useCallback(
    async (data: {
      storeLocationId: string;
      rosterRoleId: string;
      startDatetime: string;
      endDatetime: string;
      isPublicHoliday?: boolean;
    }) => {
      const res = await fetch(`${BASE}/shifts`, { ...jsonOpts, method: "POST", body: JSON.stringify(data) });
      if (!res.ok) throw await parseError(res, "Failed to create shift");
      const created = (await res.json()) as Shift;
      await refresh();
      return created;
    },
    [refresh],
  );

  const update = useCallback(
    async (id: string, data: { startDatetime?: string; endDatetime?: string }) => {
      const res = await fetch(`${BASE}/shifts/${id}`, { ...jsonOpts, method: "PUT", body: JSON.stringify(data) });
      if (!res.ok) throw await parseError(res, "Failed to update shift");
      await refresh();
    },
    [refresh],
  );

  const cancel = useCallback(
    async (id: string) => {
      const res = await fetch(`${BASE}/shifts/${id}/cancel`, { ...opts, method: "POST" });
      if (!res.ok) throw await parseError(res, "Failed to cancel shift");
      await refresh();
    },
    [refresh],
  );

  const assign = useCallback(
    async (shiftId: string, userId: number) => {
      const res = await fetch(`${BASE}/shifts/${shiftId}/assignments`, {
        ...jsonOpts,
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw await parseError(res, "Failed to assign staff");
      await refresh();
    },
    [refresh],
  );

  const removeAssignment = useCallback(
    async (assignmentId: string) => {
      const res = await fetch(`${BASE}/assignments/${assignmentId}`, { ...opts, method: "DELETE" });
      if (!res.ok) throw await parseError(res, "Failed to remove assignment");
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    // A genuine venue switch should still show the spinner, unlike a
    // same-location background refresh (e.g. after publish).
    hasLoadedOnce.current = false;
    refresh();
  }, [refresh]);

  return { shifts, isLoading, error, refresh, create, update, cancel, assign, removeAssignment };
}

// ─── Roster Shift Templates ───────────────────────────────────────

export interface RosterShiftTemplate {
  rosterShiftTemplateId: string;
  organisationId: number;
  storeLocationId: string;
  rosterRoleId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  createdDttm: string;
  updatedDttm: string;
}

export interface TemplateRowInput {
  storeLocationId: string;
  rosterRoleId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface GenerateWeekResult {
  created: number;
  skipped: number;
  failed: number;
}

export interface UndoGenerationResult {
  cancelled: number;
}

/** Same stale-closure-safe shape as useShifts above — storeLocationId drives refresh's own deps, hasLoadedOnce resets on venue switch. */
export function useRosterTemplates(storeLocationId: string | null) {
  const [templates, setTemplates] = useState<RosterShiftTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);

  const refresh = useCallback(async () => {
    if (!storeLocationId) {
      setTemplates([]);
      setIsLoading(false);
      return;
    }
    if (!hasLoadedOnce.current) setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/templates?storeLocationId=${storeLocationId}`, opts);
      if (res.ok) setTemplates(await res.json());
      else setError((await parseError(res, "Failed to load templates")).message);
    } finally {
      setIsLoading(false);
      hasLoadedOnce.current = true;
    }
  }, [storeLocationId]);

  const create = useCallback(
    async (data: TemplateRowInput) => {
      const res = await fetch(`${BASE}/templates`, { ...jsonOpts, method: "POST", body: JSON.stringify(data) });
      if (!res.ok) throw await parseError(res, "Failed to create template row");
      const created = (await res.json()) as RosterShiftTemplate;
      await refresh();
      return created;
    },
    [refresh],
  );

  const update = useCallback(
    async (id: string, data: TemplateRowInput) => {
      const res = await fetch(`${BASE}/templates/${id}`, { ...jsonOpts, method: "PATCH", body: JSON.stringify(data) });
      if (!res.ok) throw await parseError(res, "Failed to update template row");
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const res = await fetch(`${BASE}/templates/${id}`, { ...opts, method: "DELETE" });
      if (!res.ok) throw await parseError(res, "Failed to delete template row");
      await refresh();
    },
    [refresh],
  );

  const generateWeek = useCallback(
    async (weekStart: string): Promise<GenerateWeekResult> => {
      if (!storeLocationId) throw new Error("No venue selected");
      const res = await fetch(`${BASE}/templates/generate`, {
        ...jsonOpts,
        method: "POST",
        body: JSON.stringify({ storeLocationId, weekStart }),
      });
      if (!res.ok) throw await parseError(res, "Failed to generate week");
      return res.json();
    },
    [storeLocationId],
  );

  const undoGeneration = useCallback(
    async (weekStart: string): Promise<UndoGenerationResult> => {
      if (!storeLocationId) throw new Error("No venue selected");
      const res = await fetch(`${BASE}/templates/undo-generation`, {
        ...jsonOpts,
        method: "POST",
        body: JSON.stringify({ storeLocationId, weekStart }),
      });
      if (!res.ok) throw await parseError(res, "Failed to undo generation");
      return res.json();
    },
    [storeLocationId],
  );

  useEffect(() => {
    hasLoadedOnce.current = false;
    refresh();
  }, [refresh]);

  return { templates, isLoading, error, refresh, create, update, remove, generateWeek, undoGeneration };
}

export interface CalendarShiftAssignment {
  assignmentId: string;
  userId: number;
  staffName: string;
  status: string;
}

export interface CalendarShift {
  shiftId: string;
  rosterRoleId: string;
  roleName: string;
  startDatetime: string;
  endDatetime: string;
  status: "Draft" | "Published" | "Cancelled";
  isPublicHoliday: boolean;
  assignments: CalendarShiftAssignment[];
}

/**
 * Backs the RosterCalendarView "Calendar" tab — one row per shift with role
 * name and assignees inline (GET /shifts/calendar), unlike useShifts'
 * GET /shifts which returns bare shift rows only. Mutators hit the SAME
 * routes useShifts already calls; refresh is the only thing pointed at the
 * new route. Kept separate from useShifts rather than shared — the two
 * hooks refresh from different endpoints, and there's no second consumer to
 * justify genericizing that yet.
 */
export function useRosterCalendar(storeLocationId: string | null, from: string, to: string) {
  const [calendarShifts, setCalendarShifts] = useState<CalendarShift[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);

  const refresh = useCallback(async () => {
    if (!storeLocationId) {
      setCalendarShifts([]);
      setIsLoading(false);
      return;
    }
    if (!hasLoadedOnce.current) setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/shifts/calendar?storeLocationId=${storeLocationId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, opts);
      if (res.ok) setCalendarShifts(await res.json());
      else setError((await parseError(res, "Failed to load the roster calendar")).message);
    } finally {
      setIsLoading(false);
      hasLoadedOnce.current = true;
    }
  }, [storeLocationId, from, to]);

  const create = useCallback(
    async (data: { storeLocationId: string; rosterRoleId: string; startDatetime: string; endDatetime: string }) => {
      const res = await fetch(`${BASE}/shifts`, { ...jsonOpts, method: "POST", body: JSON.stringify(data) });
      if (!res.ok) throw await parseError(res, "Failed to create shift");
      const created = (await res.json()) as Shift;
      await refresh();
      return created;
    },
    [refresh],
  );

  /** Reschedule/resize a Draft shift — the PUT /shifts/:id route existed server-side with no client caller until now. */
  const updateTime = useCallback(
    async (shiftId: string, data: { startDatetime?: string; endDatetime?: string }) => {
      const res = await fetch(`${BASE}/shifts/${shiftId}`, { ...jsonOpts, method: "PUT", body: JSON.stringify(data) });
      if (!res.ok) throw await parseError(res, "Failed to reschedule shift");
      await refresh();
    },
    [refresh],
  );

  const assign = useCallback(
    async (shiftId: string, userId: number) => {
      const res = await fetch(`${BASE}/shifts/${shiftId}/assignments`, {
        ...jsonOpts,
        method: "POST",
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw await parseError(res, "Failed to assign staff");
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    hasLoadedOnce.current = false;
    refresh();
  }, [refresh]);

  return { calendarShifts, isLoading, error, refresh, create, updateTime, assign };
}

export interface ShiftAssignmentRow {
  assignmentId: string;
  userId: number;
  status: string;
  staffName: string;
  publicHolidayConsent: PublicHolidayConsent;
}

/** Fetched on demand (e.g. when a shift row is expanded), not part of useShifts's list payload. */
export async function fetchShiftAssignments(shiftId: string): Promise<ShiftAssignmentRow[]> {
  const res = await fetch(`${BASE}/shifts/${shiftId}/assignments`, opts);
  if (!res.ok) throw await parseError(res, "Failed to load shift assignments");
  return res.json();
}

/** Manager asks a staff member to consent to a public-holiday shift (roster:manage). Caller re-fetches assignments to see the new status. */
export async function requestConsent(assignmentId: string): Promise<void> {
  const res = await fetch(`${BASE}/assignments/${assignmentId}/consent/request`, { ...opts, method: "POST" });
  if (!res.ok) throw await parseError(res, "Failed to request consent");
}

export function usePublish() {
  const [isPublishing, setIsPublishing] = useState(false);

  const publish = useCallback(async (storeLocationId: string, from: string, to: string) => {
    setIsPublishing(true);
    try {
      const res = await fetch(`${BASE}/publish`, {
        ...jsonOpts,
        method: "POST",
        body: JSON.stringify({ storeLocationId, from, to }),
      });
      if (!res.ok) throw await parseError(res, "Failed to publish roster");
      return (await res.json()) as PublishResult;
    } finally {
      setIsPublishing(false);
    }
  }, []);

  return { publish, isPublishing };
}

// ─── My shifts + availability (staff self-service) ───────────────

export function useMyShifts() {
  const [shifts, setShifts] = useState<MyShift[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/shifts/mine`, opts);
      if (res.ok) setShifts(await res.json());
      else setError((await parseError(res, "Failed to load your shifts")).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const respond = useCallback(
    async (assignmentId: string, response: "Confirmed" | "Declined") => {
      const res = await fetch(`${BASE}/assignments/${assignmentId}/respond`, {
        ...jsonOpts,
        method: "POST",
        body: JSON.stringify({ response }),
      });
      if (!res.ok) throw await parseError(res, "Failed to respond to shift");
      await refresh();
    },
    [refresh],
  );

  /** s.114: accept or decline a requested public-holiday shift — distinct from `respond`, which answers "will you work this shift" rather than "do you consent to it being a public holiday". */
  const respondToConsentRequest = useCallback(
    async (assignmentId: string, response: "Accepted" | "Declined") => {
      const res = await fetch(`${BASE}/assignments/${assignmentId}/consent/respond`, {
        ...jsonOpts,
        method: "POST",
        body: JSON.stringify({ response }),
      });
      if (!res.ok) throw await parseError(res, "Failed to respond to the consent request");
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { shifts, isLoading, error, refresh, respond, respondToConsentRequest };
}

export function useMyAvailability() {
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/availability/mine`, opts);
      if (res.ok) setAvailability(await res.json());
      else setError((await parseError(res, "Failed to load your availability")).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const create = useCallback(
    async (data: {
      storeLocationId?: string | null;
      dayOfWeek: number;
      availableFrom: string;
      availableUntil: string;
      effectiveFrom: string;
      effectiveUntil?: string | null;
    }) => {
      const res = await fetch(`${BASE}/availability`, { ...jsonOpts, method: "POST", body: JSON.stringify(data) });
      if (!res.ok) throw await parseError(res, "Failed to add availability");
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const res = await fetch(`${BASE}/availability/${id}`, { ...opts, method: "DELETE" });
      if (!res.ok) throw await parseError(res, "Failed to remove availability");
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { availability, isLoading, error, refresh, create, remove };
}
