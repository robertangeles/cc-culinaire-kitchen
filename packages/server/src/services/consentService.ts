/**
 * @module services/consentService
 *
 * Fair Work s.114 consent workflow (Phase 2, Slice 7): a staff member must
 * consent before being rostered onto a public-holiday shift. Two steps,
 * both explicit — nothing here is inferred from `shift.isPublicHoliday`,
 * because that column is only reliably set once a shift is Published
 * (publishRoster() sets it); a manager requesting consent on a still-Draft
 * shift needs its own, fresh public-holiday check.
 *
 * request  — manager asks (roster:manage). Notifies the staff member directly.
 * respond  — staff accepts or declines (roster:read-own, own assignment only).
 *            A decline notifies every roster:manage holder so someone
 *            reassigns the shift — declines are recorded, never overridden.
 *
 * publishRoster() (rosterService.ts) reads `publicHolidayConsent` directly
 * off each assignment and holds (not blocks) any public-holiday shift whose
 * assignees haven't all accepted — same "held, not blocked" shape as a
 * canAssign refusal.
 */

import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { shift, shiftAssignment, user } from "../db/schema.js";
import { RosterError, resolveJurisdiction, getVenueTimezone, toVenueLocalDate } from "./rosterService.js";
import { isPublicHoliday as checkIsPublicHoliday } from "./publicHolidayService.js";
import { createInApp, notifyHQAdmins, hasRecentNotification } from "./notificationService.js";
import * as auditService from "./auditService.js";
import { formatAuDate } from "@culinaire/shared";

async function getAssignmentWithShift(orgId: number, assignmentId: string) {
  const [row] = await db
    .select({
      assignmentId: shiftAssignment.assignmentId,
      shiftId: shiftAssignment.shiftId,
      userId: shiftAssignment.userId,
      publicHolidayConsent: shiftAssignment.publicHolidayConsent,
      storeLocationId: shift.storeLocationId,
      startDatetime: shift.startDatetime,
    })
    .from(shiftAssignment)
    .innerJoin(shift, eq(shift.shiftId, shiftAssignment.shiftId))
    .where(and(eq(shiftAssignment.assignmentId, assignmentId), eq(shift.organisationId, orgId)));
  if (!row) throw new RosterError("Assignment not found", 404);
  return row;
}

async function staffName(userId: number): Promise<string> {
  const [row] = await db.select({ userName: user.userName }).from(user).where(eq(user.userId, userId));
  return row?.userName ?? "This staff member";
}

async function assertShiftIsPublicHoliday(storeLocationId: string, startDatetime: Date): Promise<void> {
  const jurisdiction = await resolveJurisdiction(storeLocationId);
  if (!jurisdiction) throw new RosterError("This venue has no jurisdiction set — cannot check public holidays.", 400);
  const timezone = await getVenueTimezone(storeLocationId);
  const localDate = toVenueLocalDate(startDatetime, timezone);
  // Throws PublicHolidayError (409) itself if the year isn't loaded — same
  // fail-loud behaviour as publishRoster()'s own holiday check.
  const isHoliday = await checkIsPublicHoliday(localDate, jurisdiction);
  if (!isHoliday) throw new RosterError("This shift is not on a loaded public holiday date.", 400);
}

/** Manager asks a staff member to consent to a public-holiday shift they're assigned to. */
export async function requestConsent(orgId: number, assignmentId: string, actorUserId: number) {
  const row = await getAssignmentWithShift(orgId, assignmentId);
  if (row.publicHolidayConsent === "Accepted") {
    throw new RosterError("This staff member has already accepted this public holiday shift.", 409);
  }
  await assertShiftIsPublicHoliday(row.storeLocationId, row.startDatetime);

  const [updated] = await db
    .update(shiftAssignment)
    .set({ publicHolidayConsent: "Requested", consentRequestedAt: new Date(), updatedDttm: new Date() })
    .where(eq(shiftAssignment.assignmentId, assignmentId))
    .returning();

  // Dedup within a day — a manager double-clicking "Request" shouldn't spam
  // the same notification, mirroring complianceExpiryJob's alert-day dedup.
  const alreadyNotified = await hasRecentNotification(
    "shift_assignment",
    assignmentId,
    "HOLIDAY_CONSENT_REQUESTED",
    24,
  );
  if (!alreadyNotified) {
    await createInApp({
      organisationId: orgId,
      recipientUserId: row.userId,
      type: "HOLIDAY_CONSENT_REQUESTED",
      payload: { assignmentId, shiftId: row.shiftId, shiftDate: formatAuDate(row.startDatetime) },
      relatedEntityType: "shift_assignment",
      relatedEntityId: assignmentId,
    });
  }

  await auditService.log({
    entityType: "shift_assignment",
    entityId: assignmentId,
    action: "update",
    actorUserId,
    organisationId: orgId,
    metadata: { action: "consent_request" },
  });

  return updated;
}

/** Staff member accepts or declines a requested public-holiday shift — own assignment only. */
export async function respondToConsent(
  orgId: number,
  assignmentId: string,
  callerUserId: number,
  response: "Accepted" | "Declined",
) {
  const row = await getAssignmentWithShift(orgId, assignmentId);
  if (row.userId !== callerUserId) throw new RosterError("Assignment not found", 404);
  if (row.publicHolidayConsent !== "Requested") {
    throw new RosterError("There is no pending public holiday consent request for this shift.", 409);
  }

  const [updated] = await db
    .update(shiftAssignment)
    .set({ publicHolidayConsent: response, consentRespondedAt: new Date(), updatedDttm: new Date() })
    .where(eq(shiftAssignment.assignmentId, assignmentId))
    .returning();

  await auditService.log({
    entityType: "shift_assignment",
    entityId: assignmentId,
    action: "update",
    actorUserId: callerUserId,
    organisationId: orgId,
    metadata: { action: response === "Declined" ? "consent_decline" : "consent_accept" },
  });

  if (response === "Declined") {
    const name = await staffName(callerUserId);
    const shiftDate = formatAuDate(row.startDatetime);
    await notifyHQAdmins(
      orgId,
      "HOLIDAY_CONSENT_DECLINED",
      { assignmentId, shiftId: row.shiftId, userId: callerUserId, shiftDate },
      "shift_assignment",
      assignmentId,
      `${name} declined a public holiday shift`,
      `<p>${name} declined to work the public holiday shift on ${shiftDate}. It will be held out of the roster until reassigned.</p>`,
      "roster:manage",
    );
  }

  return updated;
}

