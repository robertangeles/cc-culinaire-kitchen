/**
 * @module services/shiftSwapService
 *
 * Phase 3, Slice 3: peer-to-peer shift swapping. A staff member offers a
 * Confirmed assignment they hold; any other org staff member can claim it,
 * gated only by canAssign against the shift's role requirements — no
 * manager-approval step (Decision 5).
 *
 * assignStaff()'s Draft-only guard does NOT apply to a claim, and claiming
 * never checks the shift's own status either — a Confirmed assignment on a
 * still-Draft shift is a reachable state (respondToAssignment doesn't check
 * shift status), and swapping it is no different from a manager manually
 * reassigning it before publish. Safety doesn't come from a status check
 * here: publishRoster() independently recomputes isPublicHoliday and holds
 * any shift whose assignee hasn't consented, however that assignment came
 * to exist, so it's the one place s.114 is actually enforced.
 *
 * Claiming into a public-holiday shift reuses consentService.requestConsent()
 * directly, so the new assignee gets the exact same Accept/Decline prompt
 * MyShiftsView.tsx already renders for any "Requested" consent — never
 * inherited from the person who offered the swap.
 */

import { eq, and, asc, gte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { shift, shiftAssignment, shiftSwapRequest, rosterRole, storeLocation, user, auditLog } from "../db/schema.js";
import {
  RosterError,
  AssignmentBlockedError,
  isOwnAssignment,
  resolveJurisdiction,
  refusalMessage,
  getRequirementsForRole,
  getHeldDocuments,
  insertOrReactivateAssignment,
} from "./rosterService.js";
import { canAssign } from "./rosterAssignmentRules.js";
import { requestConsent } from "./consentService.js";
import { createInApp } from "./notificationService.js";
import * as auditService from "./auditService.js";
import pino from "pino";

const logger = pino({ name: "shiftSwapService" });

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
      toUserId: shiftSwapRequest.toUserId,
      rosterRoleId: shift.rosterRoleId,
      storeLocationId: shift.storeLocationId,
      isPublicHoliday: shift.isPublicHoliday,
    })
    .from(shiftSwapRequest)
    .innerJoin(shift, eq(shift.shiftId, shiftSwapRequest.shiftId))
    .where(and(eq(shiftSwapRequest.swapRequestId, swapRequestId), eq(shift.organisationId, orgId)));
  if (!row) throw new RosterError("Swap request not found", 404, "NOT_FOUND");
  return row;
}

const CLAIM_REPLAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A claim deletes the offerer's assignment, and the swap row goes with it (ON DELETE CASCADE), so a
 * claimed swap cannot be read back. The claim's audit rows name the swap and the claimer: that is how a
 * replay, or the loser of a race, learns what happened.
 * shortcut: a metadata scan over one organisation's last 7 days of audit rows (idx_audit_log_org_created), only on this rare path; give the swap a durable Claimed row if replays older than a week matter.
 */
async function swapGone(orgId: number, swapRequestId: string, callerUserId: number): Promise<RosterError> {
  const [row] = await db
    .select({ claimer: auditLog.actorUserId })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.organisationId, orgId),
        gte(auditLog.createdDttm, new Date(Date.now() - CLAIM_REPLAY_WINDOW_MS)),
        sql`${auditLog.metadata} @> ${JSON.stringify({ action: "swap_claimed", swapRequestId })}::jsonb`,
      ),
    )
    .limit(1);
  return row ? swapUnavailable("Claimed", row.claimer, callerUserId) : new RosterError("Swap request not found", 404, "NOT_FOUND");
}

/** Why a swap that is not Open cannot be claimed. A replayed claim (the caller won it already) is told apart from losing it. */
function swapUnavailable(status: string, toUserId: number | null, callerUserId: number): RosterError {
  if (status !== "Claimed") return new RosterError("The person who offered this swap cancelled it.", 409, "SWAP_CANCELLED");
  return toUserId === callerUserId
    ? new RosterError("You already claimed this swap.", 409, "SWAP_CLAIMED_BY_YOU")
    : new RosterError("This swap was claimed by someone else.", 409, "SWAP_CLAIMED_BY_OTHER");
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

/**
 * Every open swap at the org, across every venue — the browse/claim list. Swaps of Draft and Cancelled shifts
 * are listed too; `shiftStatus` lets a client hide them, `ianaTimezone` and `locationName` let it show venue time.
 */
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
      shiftStatus: shift.status,
      locationName: storeLocation.locationName,
      ianaTimezone: storeLocation.ianaTimezone,
    })
    .from(shiftSwapRequest)
    .innerJoin(shift, eq(shift.shiftId, shiftSwapRequest.shiftId))
    .innerJoin(rosterRole, eq(rosterRole.rosterRoleId, shift.rosterRoleId))
    .innerJoin(storeLocation, eq(storeLocation.storeLocationId, shift.storeLocationId))
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
  let swapRow;
  try {
    swapRow = await getSwapWithShift(orgId, swapRequestId);
  } catch (err) {
    throw err instanceof RosterError && err.statusCode === 404 ? await swapGone(orgId, swapRequestId, callerUserId) : err;
  }
  if (swapRow.status !== "Open") throw swapUnavailable(swapRow.status, swapRow.toUserId, callerUserId);
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
    if (!claimed) {
      const [now] = await tx
        .select({ status: shiftSwapRequest.status, toUserId: shiftSwapRequest.toUserId })
        .from(shiftSwapRequest)
        .where(eq(shiftSwapRequest.swapRequestId, swapRequestId));
      throw now ? swapUnavailable(now.status, now.toUserId, callerUserId) : await swapGone(orgId, swapRequestId, callerUserId);
    }

    await tx.delete(shiftAssignment).where(eq(shiftAssignment.assignmentId, swapRow.fromAssignmentId));
    // Reactivates the claimer's own Declined row on this shift, if they have
    // one, instead of a raw insert hitting UNIQUE(shiftId, userId) and
    // misreporting a stale decline as "already assigned" — same shared
    // helper assignStaff() uses, so both give the same answer.
    const inserted = await insertOrReactivateAssignment(swapRow.shiftId, callerUserId, "Confirmed", tx);
    if (!inserted) {
      throw new RosterError("You're already assigned to this shift.", 409, "SHIFT_ALREADY_ASSIGNED");
    }
    // Same createdDttm/updatedDttm comparison assignStaff() uses to tell a
    // genuine insert from a Declined-row reactivation, for an accurate audit
    // action label either way.
    const wasReactivation = inserted.updatedDttm.getTime() > inserted.createdDttm.getTime();

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
        action: wasReactivation ? "update" : "create",
        actorUserId: callerUserId,
        organisationId: orgId,
        beforeValue: wasReactivation ? { status: "Declined" } : undefined,
        afterValue: { shiftId: swapRow.shiftId, userId: callerUserId, status: "Confirmed" },
        metadata: { action: "swap_claimed", swapRequestId },
      },
      tx,
    );
    return inserted;
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
  //
  // The transfer above already committed, so a failure here (e.g. the
  // public-holiday calendar row was edited/removed between publish and this
  // claim) must not turn a successful claim into a reported failure. Log and
  // fall through to the transferred assignment instead: publishRoster()'s
  // own hold-if-unconsented gate is the actual s.114 safety net regardless
  // of whether this auto-request fired, and a manager can still re-trigger
  // consent manually via the existing request-consent route.
  if (swapRow.isPublicHoliday) {
    try {
      return await requestConsent(orgId, newAssignment.assignmentId, callerUserId);
    } catch (err) {
      logger.error({ err, assignmentId: newAssignment.assignmentId }, "requestConsent failed after a successful swap claim");
    }
  }

  return newAssignment;
}

/**
 * Offerer cancels their own still-open request. The status flip is a
 * conditional UPDATE (WHERE status='Open'), same reason as claimSwap's —
 * without it, a cancel racing a concurrent claim could blindly overwrite an
 * already-"Claimed" row back to "Cancelled" after the assignment had already
 * transferred.
 */
export async function cancelSwap(orgId: number, swapRequestId: string, callerUserId: number) {
  const swapRow = await getSwapWithShift(orgId, swapRequestId);
  if (swapRow.fromUserId !== callerUserId) throw new RosterError("Swap request not found", 404);

  const [updated] = await db
    .update(shiftSwapRequest)
    .set({ status: "Cancelled", updatedDttm: new Date() })
    .where(and(eq(shiftSwapRequest.swapRequestId, swapRequestId), eq(shiftSwapRequest.status, "Open")))
    .returning();
  if (!updated) throw new RosterError("This swap can no longer be cancelled.", 409);
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
