/**
 * @module hooks/useRoster
 *
 * Custom hooks for Roster Core: roles, shifts, staff availability,
 * assignments, and publish.
 */

import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta.env.VITE_API_URL ?? "";
const BASE = `${API}/api/roster`;
const opts = { credentials: "include" as const };
const jsonOpts = { ...opts, headers: { "Content-Type": "application/json" } };

// ─── Types ────────────────────────────────────────────────────────

export interface RosterRole {
  rosterRoleId: string;
  organisationId: number;
  storeLocationId: string | null;
  roleName: string;
  createdDttm: string;
  updatedDttm: string;
}

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
  startDatetime: string;
  endDatetime: string;
  status: string;
  assignmentId: string;
  assignmentStatus: "Pending" | "Confirmed" | "Declined" | "Removed";
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

export interface AssignmentBlocked {
  documentType: string;
  reason: string;
  expiryDate: string | null;
}

async function parseError(res: Response, fallback: string): Promise<Error & { blocked?: AssignmentBlocked }> {
  const body = await res.json().catch(() => ({}));
  const err = new Error(body.error || fallback) as Error & { blocked?: AssignmentBlocked };
  if (body.blocked) err.blocked = body.blocked;
  return err;
}

// ─── Roles ────────────────────────────────────────────────────────

export function useRosterRoles() {
  const [roles, setRoles] = useState<RosterRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Same fix as useShifts: RolesManager early-returns a full-page spinner
  // while isLoading is true, which would unmount an expanded RoleRow (and
  // its in-progress document-requirement edit) on every create/remove.
  // Only the true first load should show that spinner.
  const hasLoadedOnce = useRef(false);

  const refresh = useCallback(async () => {
    if (!hasLoadedOnce.current) setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/roles`, opts);
      if (res.ok) setRoles(await res.json());
      else setError((await parseError(res, "Failed to load roles")).message);
    } finally {
      setIsLoading(false);
      hasLoadedOnce.current = true;
    }
  }, []);

  const create = useCallback(
    async (data: { roleName: string; storeLocationId?: string | null }) => {
      const res = await fetch(`${BASE}/roles`, { ...jsonOpts, method: "POST", body: JSON.stringify(data) });
      if (!res.ok) throw await parseError(res, "Failed to create role");
      await refresh();
      return (await res.json()) as RosterRole;
    },
    [refresh],
  );

  const update = useCallback(
    async (id: string, data: { roleName: string; storeLocationId?: string | null }) => {
      const res = await fetch(`${BASE}/roles/${id}`, { ...jsonOpts, method: "PUT", body: JSON.stringify(data) });
      if (!res.ok) throw await parseError(res, "Failed to update role");
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      const res = await fetch(`${BASE}/roles/${id}`, { ...opts, method: "DELETE" });
      if (!res.ok) throw await parseError(res, "Failed to delete role");
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { roles, isLoading, error, refresh, create, update, remove };
}

/**
 * Standalone (not part of useRosterRoles's state) — a row-level component
 * managing its own role's document requirements must not call the full
 * useRosterRoles() hook just to reach these, or every rendered row would
 * trigger its own redundant GET /roles list refetch on mount.
 */
export async function getRoleDocuments(id: string): Promise<string[]> {
  const res = await fetch(`${BASE}/roles/${id}/documents`, opts);
  if (!res.ok) throw await parseError(res, "Failed to load document requirements");
  return res.json();
}

export async function setRoleDocuments(id: string, documentTypes: string[]): Promise<string[]> {
  const res = await fetch(`${BASE}/roles/${id}/documents`, {
    ...jsonOpts,
    method: "PUT",
    body: JSON.stringify({ documentTypes }),
  });
  if (!res.ok) throw await parseError(res, "Failed to update document requirements");
  return res.json();
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
      await refresh();
      return (await res.json()) as Shift;
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

  return { shifts, isLoading, error, refresh, create, cancel, assign, removeAssignment };
}

export interface ShiftAssignmentRow {
  assignmentId: string;
  userId: number;
  status: string;
  staffName: string;
}

/** Fetched on demand (e.g. when a shift row is expanded), not part of useShifts's list payload. */
export async function fetchShiftAssignments(shiftId: string): Promise<ShiftAssignmentRow[]> {
  const res = await fetch(`${BASE}/shifts/${shiftId}/assignments`, opts);
  if (!res.ok) throw await parseError(res, "Failed to load shift assignments");
  return res.json();
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

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { shifts, isLoading, error, refresh, respond };
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

// ─── Org members (staff picker for assignment) ────────────────────

export interface OrgMember {
  userId: number;
  displayName: string;
  photoPath: string | null;
}

export function useOrgMembers(orgId: number | null) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setMembers([]);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    fetch(`${API}/api/organisations/${orgId}/members`, opts)
      .then((res) => (res.ok ? res.json() : { members: [] }))
      .then((data) => {
        if (cancelled) return;
        setMembers(
          (data.members ?? []).map((m: { userId: number; displayName: string; photoPath: string | null }) => ({
            userId: m.userId,
            displayName: m.displayName,
            photoPath: m.photoPath,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return { members, isLoading };
}
