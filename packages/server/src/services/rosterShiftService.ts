/**
 * @module services/rosterShiftService
 *
 * Roster roles, shifts, shift templates, assignments, and the publish
 * workflow. Extracted from rosterService.ts; import from rosterService.js
 * for backward compatibility.
 */

import { eq, and, ne, gte, lt, inArray, isNotNull, asc, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  rosterRole,
  rosterRoleDocument,
  rosterShiftTemplate,
  shift,
  shiftAssignment,
  storeLocation,
  userOrganisation,
  user,
} from "../db/schema.js";
import * as auditService from "./auditService.js";
import { isYearLoaded, isPublicHoliday as checkIsPublicHoliday } from "./publicHolidayService.js";
import {
  getActiveAwardRules,
  evaluateAwardRules,
  buildAwardCoverage,
  type AwardWarning,
  type AwardCoverage,
} from "./awardRuleService.js";
import { canAssign } from "./rosterAssignmentRules.js";
import {
  RosterError,
  RoleVenueConflictError,
  AssignmentBlockedError,
  assertLocationInOrg,
  resolveJurisdiction,
  getVenueTimezone,
  toVenueLocalDate,
  shiftEndTimeOnStartDate,
  resolveVenueLocalToUtc,
  getRequirementsForRole,
  getHeldDocuments,
  refusalMessage,
  insertOrReactivateAssignment,
} from "./rosterAvailabilityService.js";
import type { RoleVenueConflict } from "./rosterErrors.js";

// ── Private helpers ──────────────────────────────────────────────────

async function assertUserInOrg(userId: number, orgId: number): Promise<void> {
  const [row] = await db
    .select({ id: userOrganisation.userId })
    .from(userOrganisation)
    .where(and(eq(userOrganisation.userId, userId), eq(userOrganisation.organisationId, orgId)));
  if (!row) throw new RosterError("Staff member not found", 404);
}

async function getRoleRow(orgId: number, roleId: string) {
  const [row] = await db
    .select()
    .from(rosterRole)
    .where(and(eq(rosterRole.rosterRoleId, roleId), eq(rosterRole.organisationId, orgId)));
  if (!row) throw new RosterError("Role not found", 404);
  return row;
}

async function getShiftRow(orgId: number, shiftId: string) {
  const [row] = await db
    .select()
    .from(shift)
    .where(and(eq(shift.shiftId, shiftId), eq(shift.organisationId, orgId)));
  if (!row) throw new RosterError("Shift not found", 404);
  return row;
}

function parseFilterDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new RosterError("from/to must be valid dates", 400);
  return parsed;
}

/**
 * Exclusive upper bound for a bare "to" calendar date. Uses lt() against
 * the next day's midnight so the "to" day is fully included regardless of
 * how far a shift's UTC instant sits from local midnight.
 */
function parseFilterDateEnd(value: string): Date {
  return new Date(parseFilterDate(value).getTime() + 24 * 60 * 60 * 1000);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Roles ──────────────────────────────────────────────────────────────

export interface CreateRoleInput {
  roleName: string;
  storeLocationId?: string | null;
}

/** Lists all roster roles for the org. */
export async function listRoles(orgId: number) {
  return db.select().from(rosterRole).where(eq(rosterRole.organisationId, orgId)).orderBy(asc(rosterRole.roleName));
}

/** Creates a new roster role for the org. */
export async function createRole(orgId: number, input: CreateRoleInput) {
  const roleName = input.roleName.trim();
  if (!roleName) throw new RosterError("Role name is required", 400);
  if (input.storeLocationId) await assertLocationInOrg(input.storeLocationId, orgId);

  try {
    const [created] = await db
      .insert(rosterRole)
      .values({ organisationId: orgId, storeLocationId: input.storeLocationId ?? null, roleName })
      .returning();
    return created;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw new RosterError(`A role named "${roleName}" already exists at this venue`, 409);
    }
    throw err;
  }
}

/**
 * Templates referencing this role at a venue other than the new target.
 * Widening to org-wide (newStoreLocationId === null) can never conflict.
 */
async function getRoleTemplateConflicts(
  orgId: number,
  roleId: string,
  newStoreLocationId: string | null,
): Promise<RoleVenueConflict[]> {
  if (newStoreLocationId === null) return [];

  const rows = await db
    .selectDistinct({
      storeLocationId: rosterShiftTemplate.storeLocationId,
      locationName: storeLocation.locationName,
    })
    .from(rosterShiftTemplate)
    .innerJoin(storeLocation, eq(storeLocation.storeLocationId, rosterShiftTemplate.storeLocationId))
    .where(
      and(
        eq(rosterShiftTemplate.organisationId, orgId),
        eq(rosterShiftTemplate.rosterRoleId, roleId),
        ne(rosterShiftTemplate.storeLocationId, newStoreLocationId),
      ),
    );
  return rows;
}

/** Updates an existing roster role. */
export async function updateRole(
  orgId: number,
  roleId: string,
  input: CreateRoleInput & { confirmed?: boolean },
) {
  await getRoleRow(orgId, roleId);
  const roleName = input.roleName.trim();
  if (!roleName) throw new RosterError("Role name is required", 400);
  const newStoreLocationId = input.storeLocationId ?? null;
  if (newStoreLocationId) await assertLocationInOrg(newStoreLocationId, orgId);

  if (!input.confirmed) {
    const conflicts = await getRoleTemplateConflicts(orgId, roleId, newStoreLocationId);
    if (conflicts.length > 0) {
      throw new RoleVenueConflictError("This role is used by templates at other venues", conflicts);
    }
  }

  const [updated] = await db
    .update(rosterRole)
    .set({ roleName, storeLocationId: newStoreLocationId, updatedDttm: new Date() })
    .where(eq(rosterRole.rosterRoleId, roleId))
    .returning();
  return updated;
}

/** Deletes a roster role, failing if staff are currently assigned to it. */
export async function deleteRole(orgId: number, roleId: string): Promise<void> {
  await getRoleRow(orgId, roleId);
  const [inUse] = await db.select({ id: shift.shiftId }).from(shift).where(eq(shift.rosterRoleId, roleId)).limit(1);
  if (inUse) throw new RosterError("Cannot delete a role with shifts scheduled against it", 409);
  const [inUseTemplate] = await db
    .select({ id: rosterShiftTemplate.rosterShiftTemplateId })
    .from(rosterShiftTemplate)
    .where(eq(rosterShiftTemplate.rosterRoleId, roleId))
    .limit(1);
  if (inUseTemplate) throw new RosterError("Cannot delete a role used in a saved weekly template", 409);
  await db.delete(rosterRole).where(eq(rosterRole.rosterRoleId, roleId));
}

/** Lists compliance documents required for a given role. */
export async function listRoleDocuments(orgId: number, roleId: string): Promise<string[]> {
  await getRoleRow(orgId, roleId);
  const rows = await db
    .select({ documentType: rosterRoleDocument.documentType })
    .from(rosterRoleDocument)
    .where(eq(rosterRoleDocument.rosterRoleId, roleId));
  return rows.map((r) => r.documentType);
}

/** Wholesale replace — same pattern as complianceService.setRequiredDocuments. */
export async function setRoleDocuments(orgId: number, roleId: string, documentTypes: string[]): Promise<string[]> {
  await getRoleRow(orgId, roleId);
  const cleaned = [...new Set(documentTypes.map((t) => t.trim()).filter(Boolean))];

  await db.transaction(async (tx) => {
    await tx.delete(rosterRoleDocument).where(eq(rosterRoleDocument.rosterRoleId, roleId));
    if (cleaned.length > 0) {
      await tx.insert(rosterRoleDocument).values(cleaned.map((documentType) => ({ rosterRoleId: roleId, documentType })));
    }
  });
  return cleaned;
}

// ── Shifts ─────────────────────────────────────────────────────────────

export interface ShiftFilters {
  storeLocationId?: string;
  from?: string;
  to?: string;
}

/** Returns shifts for the org, optionally filtered by date range, location, and role. */
export async function listShifts(orgId: number, filters: ShiftFilters = {}) {
  const conditions = [eq(shift.organisationId, orgId)];
  if (filters.storeLocationId) conditions.push(eq(shift.storeLocationId, filters.storeLocationId));
  if (filters.from) conditions.push(gte(shift.startDatetime, parseFilterDate(filters.from)));
  if (filters.to) conditions.push(lt(shift.startDatetime, parseFilterDateEnd(filters.to)));
  return db
    .select()
    .from(shift)
    .where(and(...conditions))
    .orderBy(asc(shift.startDatetime));
}

export interface CalendarShift {
  shiftId: string;
  rosterRoleId: string;
  roleName: string;
  startDatetime: Date;
  endDatetime: Date;
  status: string;
  isPublicHoliday: boolean;
  assignments: Array<{ assignmentId: string; userId: number; staffName: string; status: string }>;
}

/**
 * One row per shift with its role name and every Pending/Confirmed assignee
 * inline — the week calendar needs to render "who's on this shift" at a
 * glance for a whole week across every role at once.
 */
export async function getWeekCalendar(
  orgId: number,
  storeLocationId: string,
  from: string,
  to: string,
): Promise<CalendarShift[]> {
  await assertLocationInOrg(storeLocationId, orgId);
  const fromDate = parseFilterDate(from);
  const toDateExclusive = parseFilterDateEnd(to);

  const rows = await db
    .select({
      shiftId: shift.shiftId,
      rosterRoleId: shift.rosterRoleId,
      roleName: rosterRole.roleName,
      startDatetime: shift.startDatetime,
      endDatetime: shift.endDatetime,
      status: shift.status,
      isPublicHoliday: shift.isPublicHoliday,
      assignmentId: shiftAssignment.assignmentId,
      assignmentUserId: shiftAssignment.userId,
      assignmentStatus: shiftAssignment.status,
      staffName: user.userName,
    })
    .from(shift)
    .innerJoin(rosterRole, eq(rosterRole.rosterRoleId, shift.rosterRoleId))
    .leftJoin(
      shiftAssignment,
      and(eq(shiftAssignment.shiftId, shift.shiftId), inArray(shiftAssignment.status, ["Pending", "Confirmed"])),
    )
    .leftJoin(user, eq(user.userId, shiftAssignment.userId))
    .where(
      and(
        eq(shift.organisationId, orgId),
        eq(shift.storeLocationId, storeLocationId),
        ne(shift.status, "Cancelled"),
        gte(shift.startDatetime, fromDate),
        lt(shift.startDatetime, toDateExclusive),
      ),
    )
    .orderBy(asc(shift.startDatetime));

  const byShift = new Map<string, CalendarShift>();
  for (const row of rows) {
    let entry = byShift.get(row.shiftId);
    if (!entry) {
      entry = {
        shiftId: row.shiftId,
        rosterRoleId: row.rosterRoleId,
        roleName: row.roleName,
        startDatetime: row.startDatetime,
        endDatetime: row.endDatetime,
        status: row.status,
        isPublicHoliday: row.isPublicHoliday,
        assignments: [],
      };
      byShift.set(row.shiftId, entry);
    }
    if (row.assignmentId && row.assignmentUserId && row.staffName) {
      entry.assignments.push({
        assignmentId: row.assignmentId,
        userId: row.assignmentUserId,
        staffName: row.staffName,
        status: row.assignmentStatus!,
      });
    }
  }
  return [...byShift.values()];
}

/** Shifts the caller is personally assigned to, across every venue in the org. */
export async function listMyShifts(orgId: number, userId: number) {
  return db
    .select({
      shiftId: shift.shiftId,
      storeLocationId: shift.storeLocationId,
      rosterRoleId: shift.rosterRoleId,
      roleName: rosterRole.roleName,
      startDatetime: shift.startDatetime,
      endDatetime: shift.endDatetime,
      status: shift.status,
      assignmentId: shiftAssignment.assignmentId,
      assignmentStatus: shiftAssignment.status,
      publicHolidayConsent: shiftAssignment.publicHolidayConsent,
    })
    .from(shiftAssignment)
    .innerJoin(shift, eq(shiftAssignment.shiftId, shift.shiftId))
    .innerJoin(rosterRole, eq(rosterRole.rosterRoleId, shift.rosterRoleId))
    .where(
      and(
        eq(shift.organisationId, orgId),
        eq(shiftAssignment.userId, userId),
        ne(shift.status, "Cancelled"),
      ),
    )
    .orderBy(asc(shift.startDatetime));
}

export interface CreateShiftInput {
  storeLocationId: string;
  rosterRoleId: string;
  startDatetime: string;
  endDatetime: string;
  isPublicHoliday?: boolean;
}

/** Creates a new shift for the org. */
export async function createShift(orgId: number, input: CreateShiftInput, createdBy: number) {
  await assertLocationInOrg(input.storeLocationId, orgId);
  await getRoleRow(orgId, input.rosterRoleId);

  const start = new Date(input.startDatetime);
  const end = new Date(input.endDatetime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new RosterError("Invalid start or end time", 400);
  }
  if (end <= start) throw new RosterError("Shift must end after it starts", 400);

  const [created] = await db
    .insert(shift)
    .values({
      organisationId: orgId,
      storeLocationId: input.storeLocationId,
      rosterRoleId: input.rosterRoleId,
      startDatetime: start,
      endDatetime: end,
      isPublicHoliday: input.isPublicHoliday ?? false,
      createdBy,
    })
    .returning();
  return created;
}

export interface UpdateShiftInput {
  startDatetime?: string;
  endDatetime?: string;
}

/** Updates an existing shift. */
export async function updateShift(orgId: number, shiftId: string, input: UpdateShiftInput, actorUserId: number) {
  const row = await getShiftRow(orgId, shiftId);
  if (row.status !== "Draft") throw new RosterError("Only a Draft shift can be edited", 409);

  const start = input.startDatetime ? new Date(input.startDatetime) : row.startDatetime;
  const end = input.endDatetime ? new Date(input.endDatetime) : row.endDatetime;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new RosterError("Invalid start or end time", 400);
  }
  if (end <= start) throw new RosterError("Shift must end after it starts", 400);

  const [updated] = await db
    .update(shift)
    .set({ startDatetime: start, endDatetime: end, updatedDttm: new Date() })
    .where(eq(shift.shiftId, shiftId))
    .returning();
  await auditService.log({
    entityType: "shift",
    entityId: shiftId,
    action: "update",
    actorUserId,
    organisationId: orgId,
    beforeValue: { startDatetime: row.startDatetime, endDatetime: row.endDatetime },
    afterValue: { startDatetime: start, endDatetime: end },
  });
  return updated;
}

/** Cancels a shift, notifying any assigned staff. */
export async function cancelShift(orgId: number, shiftId: string) {
  await getShiftRow(orgId, shiftId);
  const [updated] = await db
    .update(shift)
    .set({ status: "Cancelled", updatedDttm: new Date() })
    .where(eq(shift.shiftId, shiftId))
    .returning();
  return updated;
}

// ── Roster Shift Templates ─────────────────────────────────────────────

export interface TemplateRowInput {
  storeLocationId: string;
  rosterRoleId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

async function getTemplateRow(orgId: number, templateRowId: string) {
  const [row] = await db
    .select()
    .from(rosterShiftTemplate)
    .where(
      and(
        eq(rosterShiftTemplate.rosterShiftTemplateId, templateRowId),
        eq(rosterShiftTemplate.organisationId, orgId),
      ),
    );
  if (!row) throw new RosterError("Template row not found", 404);
  return row;
}

/**
 * Two "HH:MM" ranges overlap. end <= start means the range crosses midnight;
 * normalized onto a minutes-from-midnight scale before comparing.
 */
function timeRangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const toMinutes = (t: string): number => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const normalize = (start: string, end: string): readonly [number, number] => {
    const s = toMinutes(start);
    const e = toMinutes(end);
    return e <= s ? [s, e + 24 * 60] : [s, e];
  };
  const [aS, aE] = normalize(aStart, aEnd);
  const [bS, bE] = normalize(bStart, bEnd);
  return aS < bE && bS < aE;
}

function validateTemplateInput(input: TemplateRowInput): void {
  if (input.startTime === input.endTime) {
    throw new RosterError("startTime and endTime cannot be equal", 400);
  }
}

async function assertRoleValidAtLocation(orgId: number, rosterRoleId: string, storeLocationId: string) {
  const role = await getRoleRow(orgId, rosterRoleId);
  if (role.storeLocationId && role.storeLocationId !== storeLocationId) {
    throw new RosterError("This role belongs to a different venue", 400);
  }
}

/** Rejects (400) a new/updated row whose time range overlaps an existing row for the same (role, day-of-week). */
async function assertNoTemplateOverlap(
  orgId: number,
  rosterRoleId: string,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
  excludeRowId?: string,
): Promise<void> {
  const rows = await db
    .select({
      id: rosterShiftTemplate.rosterShiftTemplateId,
      startTime: rosterShiftTemplate.startTime,
      endTime: rosterShiftTemplate.endTime,
    })
    .from(rosterShiftTemplate)
    .where(
      and(
        eq(rosterShiftTemplate.organisationId, orgId),
        eq(rosterShiftTemplate.rosterRoleId, rosterRoleId),
        eq(rosterShiftTemplate.dayOfWeek, dayOfWeek),
      ),
    );
  for (const row of rows) {
    if (excludeRowId && row.id === excludeRowId) continue;
    if (timeRangesOverlap(startTime, endTime, row.startTime, row.endTime)) {
      throw new RosterError("This role already has an overlapping template row on this day", 400);
    }
  }
}

/** Lists roster template rows for the org, optionally scoped to a location. */
export async function listTemplates(orgId: number, storeLocationId?: string) {
  const conditions = [eq(rosterShiftTemplate.organisationId, orgId)];
  if (storeLocationId) conditions.push(eq(rosterShiftTemplate.storeLocationId, storeLocationId));
  return db
    .select()
    .from(rosterShiftTemplate)
    .where(and(...conditions))
    .orderBy(asc(rosterShiftTemplate.dayOfWeek), asc(rosterShiftTemplate.startTime));
}

/** Creates a roster template row. */
export async function createTemplateRow(orgId: number, input: TemplateRowInput) {
  await assertLocationInOrg(input.storeLocationId, orgId);
  await assertRoleValidAtLocation(orgId, input.rosterRoleId, input.storeLocationId);
  validateTemplateInput(input);
  await assertNoTemplateOverlap(orgId, input.rosterRoleId, input.dayOfWeek, input.startTime, input.endTime);

  const [created] = await db
    .insert(rosterShiftTemplate)
    .values({
      organisationId: orgId,
      storeLocationId: input.storeLocationId,
      rosterRoleId: input.rosterRoleId,
      dayOfWeek: input.dayOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
    })
    .returning();
  return created;
}

/** Updates a roster template row. */
export async function updateTemplateRow(orgId: number, templateRowId: string, input: TemplateRowInput) {
  await getTemplateRow(orgId, templateRowId);
  await assertLocationInOrg(input.storeLocationId, orgId);
  await assertRoleValidAtLocation(orgId, input.rosterRoleId, input.storeLocationId);
  validateTemplateInput(input);
  await assertNoTemplateOverlap(
    orgId,
    input.rosterRoleId,
    input.dayOfWeek,
    input.startTime,
    input.endTime,
    templateRowId,
  );

  const [updated] = await db
    .update(rosterShiftTemplate)
    .set({
      storeLocationId: input.storeLocationId,
      rosterRoleId: input.rosterRoleId,
      dayOfWeek: input.dayOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
      updatedDttm: new Date(),
    })
    .where(eq(rosterShiftTemplate.rosterShiftTemplateId, templateRowId))
    .returning();
  return updated;
}

/** Deletes a roster template row. */
export async function deleteTemplateRow(orgId: number, templateRowId: string): Promise<void> {
  await getTemplateRow(orgId, templateRowId);
  await db.delete(rosterShiftTemplate).where(eq(rosterShiftTemplate.rosterShiftTemplateId, templateRowId));
}

/** Adds `days` to a plain "YYYY-MM-DD" calendar date in UTC arithmetic. */
function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export interface GenerateWeekResult {
  created: number;
  skipped: number;
  failed: number;
}

/**
 * Turns every template row for a venue into a real Draft shift for the
 * target week. Best-effort per-row — one bad row never blocks the others.
 */
export async function generateWeekFromTemplate(
  orgId: number,
  storeLocationId: string,
  weekStart: string,
  createdBy: number,
): Promise<GenerateWeekResult> {
  await assertLocationInOrg(storeLocationId, orgId);
  const weekStartDate = new Date(weekStart);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || Number.isNaN(weekStartDate.getTime())) {
    throw new RosterError("weekStart must be a valid YYYY-MM-DD date", 400);
  }

  const templateRows = await db
    .select()
    .from(rosterShiftTemplate)
    .where(
      and(eq(rosterShiftTemplate.organisationId, orgId), eq(rosterShiftTemplate.storeLocationId, storeLocationId)),
    );
  if (templateRows.length === 0) return { created: 0, skipped: 0, failed: 0 };

  const ianaTimezone = await getVenueTimezone(storeLocationId);

  const roleIds = [...new Set(templateRows.map((r) => r.rosterRoleId))];
  const roles = await db.select().from(rosterRole).where(inArray(rosterRole.rosterRoleId, roleIds));
  const roleById = new Map(roles.map((r) => [r.rosterRoleId, r]));

  const rangeStart = new Date(weekStartDate.getTime() - 24 * 60 * 60 * 1000);
  const rangeEnd = new Date(weekStartDate.getTime() + 8 * 24 * 60 * 60 * 1000);
  const existingShifts = await db
    .select({
      rosterRoleId: shift.rosterRoleId,
      startDatetime: shift.startDatetime,
      endDatetime: shift.endDatetime,
    })
    .from(shift)
    .where(
      and(
        eq(shift.storeLocationId, storeLocationId),
        gte(shift.startDatetime, rangeStart),
        lt(shift.startDatetime, rangeEnd),
        ne(shift.status, "Cancelled"),
      ),
    );

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of templateRows) {
    const role = roleById.get(row.rosterRoleId);
    if (!role || (role.storeLocationId && role.storeLocationId !== storeLocationId)) {
      failed++;
      continue;
    }

    const dayOffset = (row.dayOfWeek + 6) % 7;
    const startDateIso = addDaysIso(weekStart, dayOffset);
    const isOvernight = row.endTime <= row.startTime;
    const endDateIso = isOvernight ? addDaysIso(startDateIso, 1) : startDateIso;
    const startInstant = resolveVenueLocalToUtc(startDateIso, row.startTime, ianaTimezone);
    const endInstant = resolveVenueLocalToUtc(endDateIso, row.endTime, ianaTimezone);

    const conflict = existingShifts.some(
      (s) =>
        s.rosterRoleId === row.rosterRoleId &&
        startInstant.getTime() < s.endDatetime.getTime() &&
        s.startDatetime.getTime() < endInstant.getTime(),
    );
    if (conflict) {
      skipped++;
      continue;
    }

    try {
      const [insertedOrReactivated] = await db
        .insert(shift)
        .values({
          organisationId: orgId,
          storeLocationId,
          rosterRoleId: row.rosterRoleId,
          startDatetime: startInstant,
          endDatetime: endInstant,
          createdBy,
          sourceTemplateRowId: row.rosterShiftTemplateId,
          generatedForWeekStart: weekStart,
        })
        .onConflictDoUpdate({
          target: [shift.sourceTemplateRowId, shift.generatedForWeekStart],
          set: {
            rosterRoleId: row.rosterRoleId,
            startDatetime: startInstant,
            endDatetime: endInstant,
            status: "Draft",
            updatedDttm: new Date(),
          },
          setWhere: eq(shift.status, "Cancelled"),
        })
        .returning();
      if (insertedOrReactivated) {
        created++;
      } else {
        skipped++;
      }
    } catch {
      failed++;
    }
  }

  return { created, skipped, failed };
}

export interface UndoGenerationResult {
  cancelled: number;
}

/** Cancels every shift generated for a venue/week in one "Generate this week" call. Idempotent. */
export async function undoGeneration(
  orgId: number,
  storeLocationId: string,
  weekStart: string,
): Promise<UndoGenerationResult> {
  await assertLocationInOrg(storeLocationId, orgId);
  const rows = await db
    .update(shift)
    .set({ status: "Cancelled", updatedDttm: new Date() })
    .where(
      and(
        eq(shift.organisationId, orgId),
        eq(shift.storeLocationId, storeLocationId),
        isNotNull(shift.sourceTemplateRowId),
        eq(shift.generatedForWeekStart, weekStart),
        ne(shift.status, "Cancelled"),
      ),
    )
    .returning({ id: shift.shiftId });
  return { cancelled: rows.length };
}

// ── Assignments ────────────────────────────────────────────────────────

async function staffName(userId: number): Promise<string> {
  const [row] = await db.select({ userName: user.userName }).from(user).where(eq(user.userId, userId));
  return row?.userName ?? "This staff member";
}

/**
 * The held-shift reason for one assignee who hasn't accepted a
 * public-holiday shift, or null if they have.
 */
function consentHoldReason(consent: string | null, staffDisplayName: string): string | null {
  if (consent === "Accepted") return null;
  if (consent === "Declined") return `${staffDisplayName} declined to work this public holiday shift.`;
  if (consent === "Requested") return `${staffDisplayName} hasn't responded to the public holiday consent request yet.`;
  return `${staffDisplayName} hasn't been asked to consent to this public holiday shift yet.`;
}

/** Assigns a staff member to a shift, enforcing compliance and availability rules. */
export async function assignStaff(orgId: number, shiftId: string, userId: number, actorUserId: number) {
  const shiftRow = await getShiftRow(orgId, shiftId);
  if (shiftRow.status !== "Draft") throw new RosterError("Can only assign staff to a Draft shift", 409);
  await assertUserInOrg(userId, orgId);
  const roleRow = await getRoleRow(orgId, shiftRow.rosterRoleId);

  const jurisdiction = await resolveJurisdiction(shiftRow.storeLocationId);
  const today = todayIso();
  const requirements = await getRequirementsForRole(roleRow.rosterRoleId, jurisdiction, today);
  const heldDocs = await getHeldDocuments(
    orgId,
    userId,
    requirements.map((r) => r.documentType),
  );

  const decision = canAssign(heldDocs, requirements, today);
  if (!decision.allowed) {
    const name = await staffName(userId);
    const message = refusalMessage(name, decision.documentType, decision.reason, decision.expiryDate);
    throw new AssignmentBlockedError(message, decision);
  }

  const row = await insertOrReactivateAssignment(shiftId, userId, "Pending");
  if (!row) {
    const name = await staffName(userId);
    throw new RosterError(`${name} is already assigned to this shift.`, 409);
  }

  const wasReactivation = row.updatedDttm.getTime() > row.createdDttm.getTime();
  await auditService.log({
    entityType: "shift_assignment",
    entityId: row.assignmentId,
    action: wasReactivation ? "update" : "create",
    actorUserId,
    organisationId: orgId,
    beforeValue: wasReactivation ? { status: "Declined" } : undefined,
    afterValue: wasReactivation ? { status: row.status } : { shiftId, userId, status: row.status },
  });
  return row;
}

/** Every assignment on one shift, staff name joined in. */
export async function listShiftAssignments(orgId: number, shiftId: string) {
  await getShiftRow(orgId, shiftId);
  return db
    .select({
      assignmentId: shiftAssignment.assignmentId,
      userId: shiftAssignment.userId,
      status: shiftAssignment.status,
      staffName: user.userName,
      publicHolidayConsent: shiftAssignment.publicHolidayConsent,
    })
    .from(shiftAssignment)
    .innerJoin(user, eq(user.userId, shiftAssignment.userId))
    .where(eq(shiftAssignment.shiftId, shiftId))
    .orderBy(asc(user.userName));
}

async function getAssignmentRow(orgId: number, assignmentId: string) {
  const [row] = await db
    .select({
      assignmentId: shiftAssignment.assignmentId,
      shiftId: shiftAssignment.shiftId,
      userId: shiftAssignment.userId,
      status: shiftAssignment.status,
    })
    .from(shiftAssignment)
    .innerJoin(shift, eq(shiftAssignment.shiftId, shift.shiftId))
    .where(and(eq(shiftAssignment.assignmentId, assignmentId), eq(shift.organisationId, orgId)));
  if (!row) throw new RosterError("Assignment not found", 404);
  return row;
}

/** Ownership guard — the permission gate only proves "can respond to MY OWN assignments". */
export function isOwnAssignment(row: { userId: number }, callerUserId: number): boolean {
  return row.userId === callerUserId;
}

/** Records a staff member's acceptance or rejection of a shift assignment. */
export async function respondToAssignment(
  orgId: number,
  assignmentId: string,
  callerUserId: number,
  response: "Confirmed" | "Declined",
) {
  const row = await getAssignmentRow(orgId, assignmentId);
  if (!isOwnAssignment(row, callerUserId)) throw new RosterError("Assignment not found", 404);
  if (row.status !== "Pending") throw new RosterError("This assignment has already been responded to", 409);

  const [updated] = await db
    .update(shiftAssignment)
    .set({ status: response, updatedDttm: new Date() })
    .where(eq(shiftAssignment.assignmentId, assignmentId))
    .returning();
  await auditService.log({
    entityType: "shift_assignment",
    entityId: assignmentId,
    action: "update",
    actorUserId: callerUserId,
    organisationId: orgId,
    beforeValue: { status: row.status },
    afterValue: { status: response },
  });
  return updated;
}

/** Removes a staff assignment from a shift. */
export async function removeAssignment(orgId: number, assignmentId: string, actorUserId: number): Promise<void> {
  const row = await getAssignmentRow(orgId, assignmentId);
  await db.delete(shiftAssignment).where(eq(shiftAssignment.assignmentId, assignmentId));
  await auditService.log({
    entityType: "shift_assignment",
    entityId: assignmentId,
    action: "cancel",
    actorUserId,
    organisationId: orgId,
    beforeValue: { shiftId: row.shiftId, userId: row.userId, status: row.status },
  });
}

// ── Publish ────────────────────────────────────────────────────────────

export interface PublishResult {
  publishedShiftIds: string[];
  heldShifts: Array<{ shiftId: string; reason: string }>;
  /** Advisory-only — never blocks. Each warning is tagged with the shift it's about. */
  awardWarnings: Array<AwardWarning & { shiftId: string }>;
  /** ALWAYS present, warnings or not — an empty warnings[] must never read as "verified clean". */
  awardCoverage: AwardCoverage;
}

/**
 * Fail loud, whole-publish, before any shift is touched — a missing
 * holiday-calendar year is a data gap that could hide an s.114 obligation
 * on ANY shift in range.
 */
async function assertHolidayCalendarLoaded(
  jurisdiction: string | null,
  fromDate: Date,
  toDate: Date,
): Promise<void> {
  if (!jurisdiction) return;
  for (let year = fromDate.getUTCFullYear(); year <= toDate.getUTCFullYear(); year++) {
    if (!(await isYearLoaded(jurisdiction, year))) {
      throw new RosterError(`Public holidays for ${jurisdiction} ${year} are not loaded.`, 409);
    }
  }
}

/**
 * Publish every Draft shift at a venue within [from, to]. Each shift's
 * assignments are re-checked against canAssign at THIS moment. A shift whose
 * assignment now fails is held back rather than blocking the whole batch.
 * Public-holiday shifts also require consent from every assignee (s.114).
 *
 * ponytail: re-checks one shift/assignment at a time; upgrade to batched
 * documents-for-many-users query if venue shift counts grow large enough.
 */
export async function publishRoster(
  orgId: number,
  storeLocationId: string,
  from: string,
  to: string,
  actorUserId: number,
): Promise<PublishResult> {
  await assertLocationInOrg(storeLocationId, orgId);
  const jurisdiction = await resolveJurisdiction(storeLocationId);
  const venueTimezone = await getVenueTimezone(storeLocationId);
  const today = todayIso();
  const now = new Date().toISOString();
  const fromDate = parseFilterDate(from);
  const toDate = parseFilterDate(to);
  await assertHolidayCalendarLoaded(jurisdiction, fromDate, toDate);

  const draftShifts = await db
    .select()
    .from(shift)
    .where(
      and(
        eq(shift.organisationId, orgId),
        eq(shift.storeLocationId, storeLocationId),
        eq(shift.status, "Draft"),
        gte(shift.startDatetime, fromDate),
        lt(shift.startDatetime, parseFilterDateEnd(to)),
      ),
    );

  const activeAwardRules = await getActiveAwardRules(jurisdiction, today);

  const publishedShiftIds: string[] = [];
  const heldShifts: Array<{ shiftId: string; reason: string }> = [];
  const awardWarnings: Array<AwardWarning & { shiftId: string }> = [];

  for (const s of draftShifts) {
    const assignments = await db
      .select()
      .from(shiftAssignment)
      .where(
        and(eq(shiftAssignment.shiftId, s.shiftId), inArray(shiftAssignment.status, ["Pending", "Confirmed"])),
      );

    const requirements = await getRequirementsForRole(s.rosterRoleId, jurisdiction, today);

    const isPublicHolidayShift = jurisdiction
      ? await checkIsPublicHoliday(
          toVenueLocalDate(s.startDatetime, venueTimezone),
          jurisdiction,
          shiftEndTimeOnStartDate(s.startDatetime, s.endDatetime, venueTimezone),
        )
      : false;

    let blockedReason: string | null = null;
    for (const a of assignments) {
      const heldDocs = await getHeldDocuments(
        orgId,
        a.userId,
        requirements.map((r) => r.documentType),
      );
      const decision = canAssign(heldDocs, requirements, today);
      if (!decision.allowed) {
        const name = await staffName(a.userId);
        blockedReason = refusalMessage(name, decision.documentType, decision.reason, decision.expiryDate);
        break;
      }
      if (isPublicHolidayShift) {
        const name = await staffName(a.userId);
        const holdReason = consentHoldReason(a.publicHolidayConsent, name);
        if (holdReason) {
          blockedReason = holdReason;
          break;
        }
      }
    }

    if (blockedReason) {
      heldShifts.push({ shiftId: s.shiftId, reason: blockedReason });
      continue;
    }

    const evaluation = evaluateAwardRules(
      { startDatetime: s.startDatetime.toISOString(), endDatetime: s.endDatetime.toISOString() },
      activeAwardRules,
      now,
      jurisdiction,
    );
    for (const w of evaluation.warnings) awardWarnings.push({ ...w, shiftId: s.shiftId });

    await db
      .update(shift)
      .set({ status: "Published", isPublicHoliday: isPublicHolidayShift, updatedDttm: new Date() })
      .where(eq(shift.shiftId, s.shiftId));
    publishedShiftIds.push(s.shiftId);
  }

  const awardCoverage = buildAwardCoverage(activeAwardRules, jurisdiction);

  await auditService.log({
    entityType: "roster_publish",
    entityId: storeLocationId,
    action: "update",
    actorUserId,
    organisationId: orgId,
    metadata: { from, to, publishedShiftIds, heldShifts, awardWarnings, awardCoverage },
  });

  return { publishedShiftIds, heldShifts, awardWarnings, awardCoverage };
}

