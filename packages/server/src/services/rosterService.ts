/**
 * @module services/rosterService
 *
 * Roster Core (Phase 2, Slice 3): roles, shifts, assignments, availability,
 * and the canAssign() gate wired to the Compliance Vault's documents.
 *
 * Every query is scoped by `organisationId` derived from the authenticated
 * user (never the client) — mirrors complianceService: a cross-org id reads
 * as 404, not 403, so a guessed id never confirms another tenant's data
 * exists.
 */

import { eq, and, or, gte, lte, inArray, isNull, desc, asc } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  rosterRole,
  rosterRoleDocument,
  shift,
  shiftAssignment,
  staffAvailability,
  storeLocation,
  userOrganisation,
  user,
  complianceDocument,
  documentExpiryRule,
} from "../db/schema.js";
import * as auditService from "./auditService.js";
import { canAssign, type HeldDocument, type AssignmentRequirement } from "./rosterAssignmentRules.js";
import { formatAuDate } from "@culinaire/shared";

export class RosterError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = "RosterError";
  }
}

export interface AssignmentBlockedInfo {
  documentType: string;
  reason: string;
  expiryDate: string | null;
}

export class AssignmentBlockedError extends RosterError {
  constructor(
    message: string,
    public info: AssignmentBlockedInfo,
  ) {
    super(message, 409);
    this.name = "AssignmentBlockedError";
  }
}

// ── Org-scoping helpers ──────────────────────────────────────────────

async function assertLocationInOrg(locationId: string, orgId: number): Promise<void> {
  const [loc] = await db
    .select({ id: storeLocation.storeLocationId })
    .from(storeLocation)
    .where(and(eq(storeLocation.storeLocationId, locationId), eq(storeLocation.organisationId, orgId)));
  if (!loc) throw new RosterError("Location not found", 404);
}

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

// ── Roles ──────────────────────────────────────────────────────────────

export interface CreateRoleInput {
  roleName: string;
  storeLocationId?: string | null;
}

export async function listRoles(orgId: number) {
  return db.select().from(rosterRole).where(eq(rosterRole.organisationId, orgId)).orderBy(asc(rosterRole.roleName));
}

export async function createRole(orgId: number, input: CreateRoleInput) {
  const roleName = input.roleName.trim();
  if (!roleName) throw new RosterError("Role name is required", 400);
  if (input.storeLocationId) await assertLocationInOrg(input.storeLocationId, orgId);

  const [created] = await db
    .insert(rosterRole)
    .values({ organisationId: orgId, storeLocationId: input.storeLocationId ?? null, roleName })
    .returning();
  return created;
}

export async function updateRole(orgId: number, roleId: string, input: CreateRoleInput) {
  await getRoleRow(orgId, roleId);
  const roleName = input.roleName.trim();
  if (!roleName) throw new RosterError("Role name is required", 400);
  if (input.storeLocationId) await assertLocationInOrg(input.storeLocationId, orgId);

  const [updated] = await db
    .update(rosterRole)
    .set({ roleName, storeLocationId: input.storeLocationId ?? null, updatedDttm: new Date() })
    .where(eq(rosterRole.rosterRoleId, roleId))
    .returning();
  return updated;
}

export async function deleteRole(orgId: number, roleId: string): Promise<void> {
  await getRoleRow(orgId, roleId);
  const [inUse] = await db.select({ id: shift.shiftId }).from(shift).where(eq(shift.rosterRoleId, roleId)).limit(1);
  if (inUse) throw new RosterError("Cannot delete a role with shifts scheduled against it", 409);
  await db.delete(rosterRole).where(eq(rosterRole.rosterRoleId, roleId));
}

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

function parseFilterDate(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new RosterError("from/to must be valid dates", 400);
  return parsed;
}

export async function listShifts(orgId: number, filters: ShiftFilters = {}) {
  const conditions = [eq(shift.organisationId, orgId)];
  if (filters.storeLocationId) conditions.push(eq(shift.storeLocationId, filters.storeLocationId));
  if (filters.from) conditions.push(gte(shift.startDatetime, parseFilterDate(filters.from)));
  if (filters.to) conditions.push(lte(shift.startDatetime, parseFilterDate(filters.to)));
  return db
    .select()
    .from(shift)
    .where(and(...conditions))
    .orderBy(asc(shift.startDatetime));
}

/** Shifts the caller is personally assigned to, across every venue in the org. */
export async function listMyShifts(orgId: number, userId: number) {
  return db
    .select({
      shiftId: shift.shiftId,
      storeLocationId: shift.storeLocationId,
      rosterRoleId: shift.rosterRoleId,
      startDatetime: shift.startDatetime,
      endDatetime: shift.endDatetime,
      status: shift.status,
      assignmentId: shiftAssignment.assignmentId,
      assignmentStatus: shiftAssignment.status,
    })
    .from(shiftAssignment)
    .innerJoin(shift, eq(shiftAssignment.shiftId, shift.shiftId))
    .where(and(eq(shift.organisationId, orgId), eq(shiftAssignment.userId, userId)))
    .orderBy(asc(shift.startDatetime));
}

export interface CreateShiftInput {
  storeLocationId: string;
  rosterRoleId: string;
  startDatetime: string;
  endDatetime: string;
  isPublicHoliday?: boolean;
}

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

export async function updateShift(orgId: number, shiftId: string, input: UpdateShiftInput) {
  const row = await getShiftRow(orgId, shiftId);
  if (row.status !== "Draft") throw new RosterError("Only a Draft shift can be edited", 409);

  const start = input.startDatetime ? new Date(input.startDatetime) : row.startDatetime;
  const end = input.endDatetime ? new Date(input.endDatetime) : row.endDatetime;
  if (end <= start) throw new RosterError("Shift must end after it starts", 400);

  const [updated] = await db
    .update(shift)
    .set({ startDatetime: start, endDatetime: end, updatedDttm: new Date() })
    .where(eq(shift.shiftId, shiftId))
    .returning();
  return updated;
}

export async function cancelShift(orgId: number, shiftId: string) {
  await getShiftRow(orgId, shiftId);
  const [updated] = await db
    .update(shift)
    .set({ status: "Cancelled", updatedDttm: new Date() })
    .where(eq(shift.shiftId, shiftId))
    .returning();
  return updated;
}

// ── Availability ───────────────────────────────────────────────────────

export interface AvailabilityInput {
  storeLocationId?: string | null;
  dayOfWeek: number;
  availableFrom: string;
  availableUntil: string;
  effectiveFrom: string;
  effectiveUntil?: string | null;
}

function validateAvailabilityInput(input: AvailabilityInput): void {
  if (input.availableUntil <= input.availableFrom) {
    throw new RosterError("availableUntil must be after availableFrom", 400);
  }
  if (input.effectiveUntil && input.effectiveUntil < input.effectiveFrom) {
    throw new RosterError("effectiveUntil must be on or after effectiveFrom", 400);
  }
}

export async function listAvailabilityForUser(orgId: number, userId: number) {
  return db
    .select()
    .from(staffAvailability)
    .where(and(eq(staffAvailability.organisationId, orgId), eq(staffAvailability.userId, userId)))
    .orderBy(asc(staffAvailability.dayOfWeek));
}

/** Org-wide, for building the roster — read-only here; write stays owner-only (see isOwnAvailability). */
export async function listAvailabilityForOrg(orgId: number) {
  return db
    .select()
    .from(staffAvailability)
    .where(eq(staffAvailability.organisationId, orgId))
    .orderBy(asc(staffAvailability.userId), asc(staffAvailability.dayOfWeek));
}

export async function createAvailability(orgId: number, userId: number, input: AvailabilityInput) {
  if (input.storeLocationId) await assertLocationInOrg(input.storeLocationId, orgId);
  validateAvailabilityInput(input);

  const [created] = await db
    .insert(staffAvailability)
    .values({
      userId,
      organisationId: orgId,
      storeLocationId: input.storeLocationId ?? null,
      dayOfWeek: input.dayOfWeek,
      availableFrom: input.availableFrom,
      availableUntil: input.availableUntil,
      effectiveFrom: input.effectiveFrom,
      effectiveUntil: input.effectiveUntil ?? null,
    })
    .returning();
  return created;
}

async function getAvailabilityRow(orgId: number, availabilityId: string) {
  const [row] = await db
    .select()
    .from(staffAvailability)
    .where(
      and(
        eq(staffAvailability.staffAvailabilityId, availabilityId),
        eq(staffAvailability.organisationId, orgId),
      ),
    );
  if (!row) throw new RosterError("Availability window not found", 404);
  return row;
}

/** Ownership guard, same shape as complianceService.isOwnDocument — the permission gate only proves "can edit MY OWN availability", not which id was typed. */
export function isOwnAvailability(row: { userId: number }, callerUserId: number): boolean {
  return row.userId === callerUserId;
}

export async function updateAvailability(
  orgId: number,
  availabilityId: string,
  callerUserId: number,
  input: AvailabilityInput,
) {
  const row = await getAvailabilityRow(orgId, availabilityId);
  if (!isOwnAvailability(row, callerUserId)) throw new RosterError("Availability window not found", 404);
  if (input.storeLocationId) await assertLocationInOrg(input.storeLocationId, orgId);
  validateAvailabilityInput(input);

  const [updated] = await db
    .update(staffAvailability)
    .set({
      storeLocationId: input.storeLocationId ?? null,
      dayOfWeek: input.dayOfWeek,
      availableFrom: input.availableFrom,
      availableUntil: input.availableUntil,
      effectiveFrom: input.effectiveFrom,
      effectiveUntil: input.effectiveUntil ?? null,
      updatedDttm: new Date(),
    })
    .where(eq(staffAvailability.staffAvailabilityId, availabilityId))
    .returning();
  return updated;
}

export async function deleteAvailability(orgId: number, availabilityId: string, callerUserId: number): Promise<void> {
  const row = await getAvailabilityRow(orgId, availabilityId);
  if (!isOwnAvailability(row, callerUserId)) throw new RosterError("Availability window not found", 404);
  await db.delete(staffAvailability).where(eq(staffAvailability.staffAvailabilityId, availabilityId));
}

// ── Assignment gate wiring ────────────────────────────────────────────

/** The venue's state drives rule lookup — a document's own issuingJurisdiction is informational only (plan's Phase 1 note). */
async function resolveJurisdiction(storeLocationId: string): Promise<string | null> {
  const [loc] = await db
    .select({ state: storeLocation.state })
    .from(storeLocation)
    .where(eq(storeLocation.storeLocationId, storeLocationId));
  return loc?.state?.trim().toUpperCase() || null;
}

/** The active document_expiry_rule for one type as of `today`, preferring an exact jurisdiction match over the national (NULL-jurisdiction) rule. */
async function getActiveRule(documentType: string, jurisdiction: string | null, today: string) {
  const rows = await db
    .select()
    .from(documentExpiryRule)
    .where(
      and(
        eq(documentExpiryRule.documentType, documentType),
        lte(documentExpiryRule.effectiveFrom, today),
        or(isNull(documentExpiryRule.effectiveTo), gte(documentExpiryRule.effectiveTo, today)),
      ),
    );
  const exact = jurisdiction ? rows.find((r) => r.jurisdiction === jurisdiction) : undefined;
  return exact ?? rows.find((r) => r.jurisdiction === null) ?? null;
}

async function getRequirementsForRole(
  roleId: string,
  jurisdiction: string | null,
  today: string,
): Promise<AssignmentRequirement[]> {
  const docTypes = await db
    .select({ documentType: rosterRoleDocument.documentType })
    .from(rosterRoleDocument)
    .where(eq(rosterRoleDocument.rosterRoleId, roleId));

  const requirements: AssignmentRequirement[] = [];
  for (const { documentType } of docTypes) {
    const rule = await getActiveRule(documentType, jurisdiction, today);
    requirements.push({ documentType, blockOnExpiry: rule?.blockRosterOnExpiry ?? false });
  }
  return requirements;
}

async function getHeldDocuments(orgId: number, userId: number, documentTypes: string[]): Promise<HeldDocument[]> {
  if (documentTypes.length === 0) return [];
  const rows = await db
    .select({
      documentType: complianceDocument.documentType,
      verificationStatus: complianceDocument.verificationStatus,
      expiryDate: complianceDocument.expiryDate,
    })
    .from(complianceDocument)
    .where(
      and(
        eq(complianceDocument.organisationId, orgId),
        eq(complianceDocument.userId, userId),
        inArray(complianceDocument.documentType, documentTypes),
      ),
    )
    .orderBy(desc(complianceDocument.uploadedAt));

  // A person may hold more than one row per type over time (renewals,
  // re-uploads without a document number). Keep only the most recently
  // uploaded per type — rows are already ordered desc, so first-seen wins.
  const byType = new Map<string, HeldDocument>();
  for (const row of rows) {
    if (!byType.has(row.documentType)) byType.set(row.documentType, row);
  }
  return [...byType.values()];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const REASON_TEXT: Record<string, string> = {
  missing: "has not uploaded a",
  unverified: "has an unverified",
  rejected: "has a rejected",
};

function refusalMessage(
  staffName: string,
  documentType: string,
  reason: string,
  expiryDate: string | null,
): string {
  if (reason === "expired" && expiryDate) {
    return `Cannot assign. ${staffName}'s ${documentType} expired on ${formatAuDate(expiryDate)}.`;
  }
  return `Cannot assign. ${staffName} ${REASON_TEXT[reason] ?? "does not have a valid"} ${documentType}.`;
}

async function staffName(userId: number): Promise<string> {
  const [row] = await db.select({ userName: user.userName }).from(user).where(eq(user.userId, userId));
  return row?.userName ?? "This staff member";
}

export async function assignStaff(orgId: number, shiftId: string, userId: number, actorUserId: number) {
  const shiftRow = await getShiftRow(orgId, shiftId);
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

  const [created] = await db.insert(shiftAssignment).values({ shiftId, userId }).returning();
  await auditService.log({
    entityType: "shift_assignment",
    entityId: created.assignmentId,
    action: "create",
    actorUserId,
    organisationId: orgId,
    afterValue: { shiftId, userId, status: created.status },
  });
  return created;
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

// ── Publish ───────────────────────────────────────────────────────────

export interface PublishResult {
  publishedShiftIds: string[];
  heldShifts: Array<{ shiftId: string; reason: string }>;
}

/**
 * Publish every Draft shift at a venue within [from, to]. Each shift's
 * assignments are re-checked against canAssign at THIS moment — a document
 * can expire between drafting and publishing. A shift whose assignment now
 * fails is held back (left in Draft) rather than blocking the whole batch —
 * same "held, not blocked" shape the s.114 consent workflow (Slice 7) uses.
 *
 * ponytail: re-checks one shift/assignment at a time (a DB round trip per
 * assignment), fine at a single venue's weekly-roster scale. Upgrade to a
 * batched documents-for-many-users query if a venue's shift count grows
 * large enough for this to matter.
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
  const today = todayIso();
  const fromDate = parseFilterDate(from);
  const toDate = parseFilterDate(to);

  const draftShifts = await db
    .select()
    .from(shift)
    .where(
      and(
        eq(shift.organisationId, orgId),
        eq(shift.storeLocationId, storeLocationId),
        eq(shift.status, "Draft"),
        gte(shift.startDatetime, fromDate),
        lte(shift.startDatetime, toDate),
      ),
    );

  const publishedShiftIds: string[] = [];
  const heldShifts: Array<{ shiftId: string; reason: string }> = [];

  for (const s of draftShifts) {
    const assignments = await db
      .select()
      .from(shiftAssignment)
      .where(
        and(eq(shiftAssignment.shiftId, s.shiftId), inArray(shiftAssignment.status, ["Pending", "Confirmed"])),
      );

    const requirements = await getRequirementsForRole(s.rosterRoleId, jurisdiction, today);
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
    }

    if (blockedReason) {
      heldShifts.push({ shiftId: s.shiftId, reason: blockedReason });
      continue;
    }

    await db.update(shift).set({ status: "Published", updatedDttm: new Date() }).where(eq(shift.shiftId, s.shiftId));
    publishedShiftIds.push(s.shiftId);
  }

  await auditService.log({
    entityType: "roster_publish",
    entityId: storeLocationId,
    action: "update",
    actorUserId,
    organisationId: orgId,
    metadata: { from, to, publishedShiftIds, heldShifts },
  });

  return { publishedShiftIds, heldShifts };
}
