/**
 * @module services/shiftSwapService
 *
 * Phase 3, Slice 3: peer-to-peer shift swapping. A staff member offers a
 * Confirmed assignment they hold; any other org staff member can claim it,
 * gated only by canAssign against the shift's role requirements — no
 * manager-approval step (Decision 5).
 *
 * assignStaff()'s Draft-only guard does NOT apply to a claim: that guard
 * exists so publishRoster() stays the only place a FRESH assignment's s.114
 * consent gate runs. Swapping trades an already-Published shift (the
 * realistic case), so claiming is its own delete+insert path.
 *
 * Claiming into a public-holiday shift reuses consentService.requestConsent()
 * directly, so the new assignee gets the exact same Accept/Decline prompt
 * MyShiftsView.tsx already renders for any "Requested" consent — never
 * inherited from the person who offered the swap.
 */

import { eq, and, asc } from "drizzle-orm";
import { db } from "../db/index.js";
import { shift, shiftAssignment, shiftSwapRequest, rosterRole, user } from "../db/schema.js";
import {
  RosterError,
  AssignmentBlockedError,
  isOwnAssignment,
  resolveJurisdiction,
  refusalMessage,
  getRequirementsForRole,
  getHeldDocuments,
} from "./rosterService.js";
import { canAssign } from "./rosterAssignmentRules.js";
import { requestConsent } from "./consentService.js";
import { createInApp } from "./notificationService.js";
import * as auditService from "./auditService.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function staffName(userId: number): Promise<string> {
  const [row] = await db.select({ userName: user.userName }).from(user).where(eq(user.userId, userId));
  return row?.userName ?? "This staff member";
}

async function getOwnAssignmentRow(orgId: number, assignmentId: string, callerUserId: number) {
  const [row] = await db
    .select({
      assignmentId: shiftAssignment.assignmentId,
      shiftId: shiftAssignment.shiftId,
      userId: shiftAssignment.userId,
      status: shiftAssignment.status,
    })
    .from(shiftAssignment)
    .innerJoin(shift, eq(shift.shiftId, shiftAssignment.shiftId))
    .where(and(eq(shiftAssignment.assignmentId, assignmentId), eq(shift.organisationId, orgId)));
  if (!row || !isOwnAssignment(row, callerUserId)) throw new RosterError("Assignment not found", 404);
  return row;
}

async function getSwapWithShift(orgId: number, swapRequestId: string) {
  const [row] = await db
    .select({
      swapRequestId: shiftSwapRequest.swapRequestId,
      shiftId: shiftSwapRequest.shiftId,
      fromAssignmentId: shiftSwapRequest.fromAssignmentId,
      fromUserId: shiftSwapRequest.fromUserId,
      status: shiftSwapRequest.status,
      rosterRoleId: shift.rosterRoleId,
      storeLocationId: shift.storeLocationId,
      isPublicHoliday: shift.isPublicHoliday,
    })
    .from(shiftSwapRequest)
    .innerJoin(shift, eq(shift.shiftId, shiftSwapRequest.shiftId))
    .where(and(eq(shiftSwapRequest.swapRequestId, swapRequestId), eq(shift.organisationId, orgId)));
  if (!row) throw new RosterError("Swap request not found", 404);
  return row;
}

/** Own assignment only, must be Confirmed — mirrors assignStaff's own guards. */
export async function offerSwap(orgId: number, assignmentId: string, callerUserId: number) {
  const row = await getOwnAssignmentRow(orgId, assignmentId, callerUserId);
  if (row.status !== "Confirmed") throw new RosterError("Only a Confirmed assignment can be offered for swap", 409);

  try {
    const [created] = await db
      .insert(shiftSwapRequest)
      .values({ shiftId: row.shiftId, fromAssignmentId: row.assignmentId, fromUserId: callerUserId })
      .returning();
    await auditService.log({
      entityType: "shift_swap_request",
      entityId: created.swapRequestId,
      action: "create",
      actorUserId: callerUserId,
      organisationId: orgId,
      afterValue: { shiftId: row.shiftId, fromAssignmentId: row.assignmentId },
    });
    return created;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw new RosterError("This shift is already offered for swap.", 409);
    }
    throw err;
  }
}

/** Every open swap at the org, across every venue — the browse/claim list. */
export async function listOpenSwaps(orgId: number) {
  return db
    .select({
      swapRequestId: shiftSwapRequest.swapRequestId,
      shiftId: shiftSwapRequest.shiftId,
      fromAssignmentId: shiftSwapRequest.fromAssignmentId,
      fromUserId: shiftSwapRequest.fromUserId,
      fromUserName: user.userName,
      startDatetime: shift.startDatetime,
      endDatetime: shift.endDatetime,
      rosterRoleId: shift.rosterRoleId,
      roleName: rosterRole.roleName,
      storeLocationId: shift.storeLocationId,
    })
    .from(shiftSwapRequest)
    .innerJoin(shift, eq(shift.shiftId, shiftSwapRequest.shiftId))
    .innerJoin(rosterRole, eq(rosterRole.rosterRoleId, shift.rosterRoleId))
    .innerJoin(user, eq(user.userId, shiftSwapRequest.fromUserId))
    .where(and(eq(shift.organisationId, orgId), eq(shiftSwapRequest.status, "Open")))
    .orderBy(asc(shift.startDatetime));
}

/**
 * Claim an open swap. Race-safe: the status flip is a conditional UPDATE
 * inside the same transaction as the assignment transfer, so a losing
 * concurrent claim rolls back cleanly with nothing transferred.
 */
export async function claimSwap(orgId: number, swapRequestId: string, callerUserId: number) {
  const swapRow = await getSwapWithShift(orgId, swapRequestId);
  if (swapRow.status !== "Open") throw new RosterError("This swap is no longer available.", 409);
  if (swapRow.fromUserId === callerUserId) throw new RosterError("You can't claim your own swap offer.", 400);

  const jurisdiction = await resolveJurisdiction(swapRow.storeLocationId);
  const today = todayIso();
  const requirements = await getRequirementsForRole(swapRow.rosterRoleId, jurisdiction, today);
  const heldDocs = await getHeldDocuments(
    orgId,
    callerUserId,
    requirements.map((r) => r.documentType),
  );
  const decision = canAssign(heldDocs, requirements, today);
  if (!decision.allowed) {
    const name = await staffName(callerUserId);
    const message = refusalMessage(name, decision.documentType, decision.reason, decision.expiryDate);
    throw new AssignmentBlockedError(message, decision);
  }

  const newAssignment = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(shiftSwapRequest)
      .set({ status: "Claimed", toUserId: callerUserId, updatedDttm: new Date() })
      .where(and(eq(shiftSwapRequest.swapRequestId, swapRequestId), eq(shiftSwapRequest.status, "Open")))
      .returning();
    if (!claimed) throw new RosterError("This swap was just claimed by someone else.", 409);

    try {
      await tx.delete(shiftAssignment).where(eq(shiftAssignment.assignmentId, swapRow.fromAssignmentId));
      const [inserted] = await tx
        .insert(shiftAssignment)
        .values({ shiftId: swapRow.shiftId, userId: callerUserId, status: "Confirmed" })
        .returning();

      await auditService.log(
        {
          entityType: "shift_assignment",
          entityId: swapRow.fromAssignmentId,
          action: "cancel",
          actorUserId: callerUserId,
          organisationId: orgId,
          beforeValue: { shiftId: swapRow.shiftId, userId: swapRow.fromUserId },
          metadata: { action: "swap_claimed", swapRequestId },
        },
        tx,
      );
      await auditService.log(
        {
          entityType: "shift_assignment",
          entityId: inserted.assignmentId,
          action: "create",
          actorUserId: callerUserId,
          organisationId: orgId,
          afterValue: { shiftId: swapRow.shiftId, userId: callerUserId, status: "Confirmed" },
          metadata: { action: "swap_claimed", swapRequestId },
        },
        tx,
      );
      return inserted;
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new RosterError("You're already assigned to this shift.", 409);
      }
      throw err;
    }
  });

  await createInApp({
    organisationId: orgId,
    recipientUserId: swapRow.fromUserId,
    type: "SHIFT_SWAP_CLAIMED",
    payload: { swapRequestId, shiftId: swapRow.shiftId, claimedByUserId: callerUserId },
    relatedEntityType: "shift_assignment",
    relatedEntityId: newAssignment.assignmentId,
  });

  // requestConsent's own UPDATE sets publicHolidayConsent — return ITS row,
  // not the pre-consent one captured above, or the caller sees a stale null.
  if (swapRow.isPublicHoliday) {
    return requestConsent(orgId, newAssignment.assignmentId, callerUserId);
  }

  return newAssignment;
}

/** Offerer cancels their own still-open request. */
export async function cancelSwap(orgId: number, swapRequestId: string, callerUserId: number) {
  const swapRow = await getSwapWithShift(orgId, swapRequestId);
  if (swapRow.fromUserId !== callerUserId) throw new RosterError("Swap request not found", 404);
  if (swapRow.status !== "Open") throw new RosterError("This swap can no longer be cancelled.", 409);

  const [updated] = await db
    .update(shiftSwapRequest)
    .set({ status: "Cancelled", updatedDttm: new Date() })
    .where(eq(shiftSwapRequest.swapRequestId, swapRequestId))
    .returning();
  await auditService.log({
    entityType: "shift_swap_request",
    entityId: swapRequestId,
    action: "cancel",
    actorUserId: callerUserId,
    organisationId: orgId,
    beforeValue: { status: "Open" },
  });
  return updated;
}
