/**
 * @module services/rosterAvailabilityService
 *
 * Staff availability windows, timezone conversion utilities, and the
 * compliance/canAssign gate helpers. Extracted from rosterService.ts;
 * import from rosterService.js for backward compatibility.
 */

import { eq, and, or, gte, lte, isNull, inArray, asc, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  staffAvailability,
  storeLocation,
  rosterRoleDocument,
  complianceDocument,
  documentExpiryRule,
  shiftAssignment,
} from "../db/schema.js";
import { canAssign, type HeldDocument, type AssignmentRequirement } from "./rosterAssignmentRules.js";
import { normalizeJurisdiction } from "./jurisdiction.js";
import { formatAuDate } from "@culinaire/shared";
import {
  RosterError,
  type AssignmentBlockedInfo,
  type RoleVenueConflict,
} from "./rosterErrors.js";
import type { DbOrTx } from "./auditService.js";

export { RosterError, AssignmentBlockedError, RoleVenueConflictError } from "./rosterErrors.js";
export type { AssignmentBlockedInfo, RoleVenueConflict } from "./rosterErrors.js";

// ── Org-scoping helpers ──────────────────────────────────────────────

/** Throws if the given location does not belong to the org. */
export async function assertLocationInOrg(locationId: string, orgId: number): Promise<void> {
  const [loc] = await db
    .select({ id: storeLocation.storeLocationId })
    .from(storeLocation)
    .where(and(eq(storeLocation.storeLocationId, locationId), eq(storeLocation.organisationId, orgId)));
  if (!loc) throw new RosterError("Location not found", 404);
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

/** Returns all availability windows for the given user. */
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

/** Creates an availability window for a user. */
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

/** Updates a user's availability window. */
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

/** Deletes a user's availability window. */
export async function deleteAvailability(orgId: number, availabilityId: string, callerUserId: number): Promise<void> {
  const row = await getAvailabilityRow(orgId, availabilityId);
  if (!isOwnAvailability(row, callerUserId)) throw new RosterError("Availability window not found", 404);
  await db.delete(staffAvailability).where(eq(staffAvailability.staffAvailabilityId, availabilityId));
}

// ── Timezone + public-holiday helpers ─────────────────────────────────

/**
 * The venue's state drives rule lookup — a document's own issuingJurisdiction
 * is informational only. Exported — consentService.ts needs the same
 * resolution to decide whether a shift's date is a public holiday before
 * requesting consent for it.
 */
export async function resolveJurisdiction(storeLocationId: string): Promise<string | null> {
  const [loc] = await db
    .select({ state: storeLocation.state })
    .from(storeLocation)
    .where(eq(storeLocation.storeLocationId, storeLocationId));
  return normalizeJurisdiction(loc?.state);
}

/** Returns the IANA timezone for the given store location. */
export async function getVenueTimezone(storeLocationId: string): Promise<string> {
  const [loc] = await db
    .select({ ianaTimezone: storeLocation.ianaTimezone })
    .from(storeLocation)
    .where(eq(storeLocation.storeLocationId, storeLocationId));
  return loc?.ianaTimezone ?? "Australia/Melbourne";
}

/**
 * A shift's `startDatetime` is a UTC instant. `.toISOString().slice(0, 10)`
 * would silently answer with the wrong calendar day for any shift whose
 * local start time crosses midnight UTC once converted — e.g. a 9am AEST
 * shift is 11pm UTC the day before. Public holidays are dates in the
 * venue's local calendar, so the instant must be read back in the venue's
 * own zone, not UTC.
 */
export function toVenueLocalDate(instant: Date, ianaTimezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ianaTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** "HH:MM" venue-local time-of-day, same instant->timezone conversion as toVenueLocalDate above. */
export function toVenueLocalTime(instant: Date, ianaTimezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: ianaTimezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

/**
 * The venue-local time-of-day a shift's END reaches on its START day —
 * "24:00" if the shift crosses into a later local day (an overnight shift),
 * so a partial-day public holiday's threshold on the start day can always
 * be compared against a single "HH:MM" value.
 */
export function shiftEndTimeOnStartDate(startDatetime: Date, endDatetime: Date, ianaTimezone: string): string {
  const startDate = toVenueLocalDate(startDatetime, ianaTimezone);
  const endDate = toVenueLocalDate(endDatetime, ianaTimezone);
  return startDate === endDate ? toVenueLocalTime(endDatetime, ianaTimezone) : "24:00";
}

/** The venue's UTC offset, in milliseconds, at the given instant — positive means ahead of UTC. */
function venueOffsetMillis(instant: number, ianaTimezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ianaTimezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const localAsUtcMillis = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return localAsUtcMillis - instant;
}

/**
 * Inverse of toVenueLocalDate/toVenueLocalTime: resolves a venue-local
 * wall-clock date+time into the UTC instant it represents. Two-pass for
 * DST transitions — the offset is re-read at the corrected instant and
 * re-applied if it changed.
 */
export function resolveVenueLocalToUtc(dateIso: string, hhmm: string, ianaTimezone: string): Date {
  const [year, month, day] = dateIso.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  const wallClockAsUtcMillis = Date.UTC(year, month - 1, day, hour, minute, 0);

  const offset = venueOffsetMillis(wallClockAsUtcMillis, ianaTimezone);
  const utcMillis = wallClockAsUtcMillis - offset;
  const offset2 = venueOffsetMillis(utcMillis, ianaTimezone);
  return new Date(offset2 === offset ? utcMillis : wallClockAsUtcMillis - offset2);
}

// ── canAssign gate helpers ─────────────────────────────────────────────

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

// Exported — reused by shiftSwapService.ts to re-run the exact same
// canAssign gate against a swap-claim candidate.
/** Returns compliance document requirements for a role. */
export async function getRequirementsForRole(
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

// Exported for the same reason as getRequirementsForRole above.
/** Returns compliance documents held by a user, optionally filtered by type. */
export async function getHeldDocuments(orgId: number, userId: number, documentTypes: string[]): Promise<HeldDocument[]> {
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

  // Keep only the most recently uploaded per type — rows are already ordered desc.
  const byType = new Map<string, HeldDocument>();
  for (const row of rows) {
    if (!byType.has(row.documentType)) byType.set(row.documentType, row);
  }
  return [...byType.values()];
}

const REASON_TEXT: Record<string, string> = {
  missing: "has not uploaded a",
  unverified: "has an unverified",
  rejected: "has a rejected",
};

// Exported — reused by staffingCoverageService.ts to describe an existing
// assignment's compliance gap in the same wording assignStaff uses.
/** Returns a human-readable refusal message for a blocked shift assignment. */
export function refusalMessage(
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

/**
 * Insert a new shiftAssignment, or reactivate an existing Declined one, as a
 * single atomic statement. UNIQUE(shiftId, userId) is a hard constraint —
 * a Declined row is kept for audit. Shared by assignStaff() and claimSwap().
 * Returns null when an ACTIVE assignment already exists.
 *
 * Lives here (not rosterShiftService) so shiftSwapService.ts can import it
 * without creating a circular dependency through the shift module.
 */
export async function insertOrReactivateAssignment(
  shiftId: string,
  userId: number,
  status: "Pending" | "Confirmed",
  tx: DbOrTx = db,
): Promise<typeof shiftAssignment.$inferSelect | null> {
  const [row] = await tx
    .insert(shiftAssignment)
    .values({ shiftId, userId, status })
    .onConflictDoUpdate({
      target: [shiftAssignment.shiftId, shiftAssignment.userId],
      set: {
        status,
        publicHolidayConsent: null,
        consentRequestedAt: null,
        consentRespondedAt: null,
        updatedDttm: new Date(),
      },
      setWhere: eq(shiftAssignment.status, "Declined"),
    })
    .returning();
  return row ?? null;
}

