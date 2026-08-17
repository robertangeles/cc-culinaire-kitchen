/**
 * @module services/staffingCoverageService
 *
 * Phase 3, Slice 2: a day x role coverage heat map for one venue, plus
 * "skill coverage" — is everyone actually rostered onto a role eligible to
 * work it, per that role's own configured document requirements.
 *
 * Skill coverage reuses `roster_role_document` + `canAssign` generically —
 * no hardcoded "RSA"/"Food Safety Supervisor" strings, no "alcohol shift"
 * flag. "Is an FSS on shift" falls out for free once an operator has
 * configured that requirement on a role in Roster Core's Roles UI; a config
 * gap on their side isn't a code gap on ours, same disclosure posture as
 * the Award engine's `AwardCoverage`. Type named `StaffingCoverage*`
 * throughout, never bare `Coverage` — `awardRuleService.ts` already owns
 * that name for an unrelated concept (which Award rule categories were
 * disclosed as checked).
 *
 * This is a dashboard, opened every time someone loads the Coverage tab —
 * unlike publishRoster()'s one-shot per-assignment canAssign re-check (fine
 * there since it runs once per publish action), N+1 here is the wrong
 * default from day one. Everything is fetched in a fixed, small number of
 * batched queries; `canAssign` then runs purely in memory per assignment.
 */

import { and, eq, gte, lte, ne, inArray, or, isNull, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { rosterRole, shift, shiftAssignment, rosterRoleDocument, complianceDocument, documentExpiryRule, user } from "../db/schema.js";
import { assertLocationInOrg, refusalMessage, RosterError } from "./rosterService.js";
import { canAssign, type HeldDocument, type AssignmentRequirement, type AssignmentBlockReason } from "./rosterAssignmentRules.js";

export type CoverageCellStatus = "ok" | "unstaffed" | AssignmentBlockReason;

export interface CoverageCell {
  date: string;
  roleId: string;
  status: CoverageCellStatus;
  rosteredHours: number;
  detail: string | null;
}

export interface CoverageRole {
  roleId: string;
  roleName: string;
}

export interface StaffingCoverageResult {
  storeLocationId: string;
  from: string;
  to: string;
  roles: CoverageRole[];
  cells: CoverageCell[];
  summary: { covered: number; atRisk: number; unstaffed: number };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const STATUS_SEVERITY: Record<CoverageCellStatus, number> = {
  unstaffed: 5,
  expired: 4,
  rejected: 4,
  missing: 3,
  unverified: 2,
  ok: 1,
};

function worseStatus(a: CoverageCellStatus, b: CoverageCellStatus): CoverageCellStatus {
  return STATUS_SEVERITY[b] > STATUS_SEVERITY[a] ? b : a;
}

/**
 * Coverage heat map for one venue over [from, to]: for every (day, role)
 * that has at least one shift, the worst compliance status among its
 * Pending/Confirmed assignees (or "unstaffed" if nobody's assigned at all).
 * A (day, role) with no shift simply has no cell — the client renders that
 * grid square as empty, distinct from a shift nobody's covering.
 */
export async function getStaffingCoverage(
  orgId: number,
  storeLocationId: string,
  from: string,
  to: string,
): Promise<StaffingCoverageResult> {
  await assertLocationInOrg(storeLocationId, orgId);
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new RosterError("from/to must be valid dates", 400);
  }
  const today = todayIso();

  // Query 1: every shift in range at this venue, its role, and every
  // Pending/Confirmed assignee (LEFT JOIN so an unstaffed shift still
  // produces one row, with null assignment fields).
  const shiftRows = await db
    .select({
      shiftId: shift.shiftId,
      roleId: shift.rosterRoleId,
      roleName: rosterRole.roleName,
      startDatetime: shift.startDatetime,
      endDatetime: shift.endDatetime,
      assignmentUserId: shiftAssignment.userId,
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
        lte(shift.startDatetime, toDate),
      ),
    );

  const roleIds = [...new Set(shiftRows.map((r) => r.roleId))];
  const userIds = [...new Set(shiftRows.map((r) => r.assignmentUserId).filter((id): id is number => id !== null))];

  // Query 2: every document type each of those roles requires.
  const roleDocRows = roleIds.length
    ? await db
        .select({ roleId: rosterRoleDocument.rosterRoleId, documentType: rosterRoleDocument.documentType })
        .from(rosterRoleDocument)
        .where(inArray(rosterRoleDocument.rosterRoleId, roleIds))
    : [];
  const docTypes = [...new Set(roleDocRows.map((r) => r.documentType))];

  // Query 3: the active expiry rule for each of those document types —
  // exact-jurisdiction match preferred, national (null) rule as fallback,
  // resolved in memory rather than one query per type.
  // No jurisdiction filter here on purpose: the coverage grid spans one
  // venue's own shifts only, so its own state's rules are what apply — but
  // this service doesn't resolve a per-venue jurisdiction (unlike
  // publishRoster/consentService), so exact-jurisdiction rules never match
  // and every role only ever falls back to the national (null) rule. A venue
  // whose state has its OWN blockOnExpiry override would silently miss it
  // here. Acceptable for a heat map (advisory, not a publish gate) but
  // worth fixing if that gap turns out to matter in practice.
  const ruleRows = docTypes.length
    ? await db
        .select()
        .from(documentExpiryRule)
        .where(
          and(
            inArray(documentExpiryRule.documentType, docTypes),
            lte(documentExpiryRule.effectiveFrom, today),
            or(isNull(documentExpiryRule.effectiveTo), gte(documentExpiryRule.effectiveTo, today)),
          ),
        )
    : [];
  const nationalRuleByType = new Map<string, boolean>();
  for (const r of ruleRows) {
    if (r.jurisdiction === null) nationalRuleByType.set(r.documentType, r.blockRosterOnExpiry);
  }

  const requirementsByRole = new Map<string, AssignmentRequirement[]>();
  for (const roleId of roleIds) {
    const types = roleDocRows.filter((r) => r.roleId === roleId).map((r) => r.documentType);
    requirementsByRole.set(
      roleId,
      types.map((documentType) => ({ documentType, blockOnExpiry: nationalRuleByType.get(documentType) ?? false })),
    );
  }

  // Query 4: held documents for every distinct assignee in range, batched
  // (not one query per user).
  const heldRows = userIds.length
    ? await db
        .select({
          userId: complianceDocument.userId,
          documentType: complianceDocument.documentType,
          verificationStatus: complianceDocument.verificationStatus,
          expiryDate: complianceDocument.expiryDate,
          uploadedAt: complianceDocument.uploadedAt,
        })
        .from(complianceDocument)
        .where(and(eq(complianceDocument.organisationId, orgId), inArray(complianceDocument.userId, userIds)))
        .orderBy(desc(complianceDocument.uploadedAt))
    : [];
  const heldByUser = new Map<number, HeldDocument[]>();
  for (const row of heldRows) {
    const list = heldByUser.get(row.userId!) ?? [];
    // Rows are already ordered desc by uploadedAt — first-seen per type wins.
    if (!list.some((d) => d.documentType === row.documentType)) {
      list.push({ documentType: row.documentType, verificationStatus: row.verificationStatus, expiryDate: row.expiryDate });
    }
    heldByUser.set(row.userId!, list);
  }

  // Group shift rows by (date, roleId) — everything else is now in-memory.
  const cellMap = new Map<string, CoverageCell>();
  const roleNames = new Map<string, string>();
  // A shift with 2+ assignees produces one row per assignee (LEFT JOIN) —
  // track which (cell, shiftId) pairs already contributed their hours so a
  // multi-assignee shift's duration isn't counted once per assignee.
  const seenShifts = new Set<string>();
  for (const row of shiftRows) {
    roleNames.set(row.roleId, row.roleName);
    const date = row.startDatetime.toISOString().slice(0, 10);
    const key = `${date}::${row.roleId}`;
    const hours = (row.endDatetime.getTime() - row.startDatetime.getTime()) / (1000 * 60 * 60);

    let cell = cellMap.get(key);
    if (!cell) {
      // Seed at "ok" (the BEST status, lowest severity), not "unstaffed" —
      // worseStatus() only ever moves a cell UP in severity, so seeding at
      // the worst possible value would make every subsequent comparison a
      // no-op (nothing outranks the worst) and every cell would read
      // "unstaffed" regardless of what its rows actually say.
      cell = { date, roleId: row.roleId, status: "ok", rosteredHours: 0, detail: null };
      cellMap.set(key, cell);
    }
    // Each shift row is counted once per assignee join; dedupe hours per
    // distinct shift by only adding them the first time this shiftId is
    // seen for this cell (a shift with 2 assignees would otherwise double
    // its hours).
    const shiftKey = `${key}::${row.shiftId}`;
    if (!seenShifts.has(shiftKey)) {
      seenShifts.add(shiftKey);
      cell.rosteredHours += hours;
    }

    if (row.assignmentUserId === null) {
      cell.status = worseStatus(cell.status, "unstaffed");
      continue;
    }
    const requirements = requirementsByRole.get(row.roleId) ?? [];
    const heldDocs = heldByUser.get(row.assignmentUserId) ?? [];
    const decision = canAssign(heldDocs, requirements, today);
    if (decision.allowed) {
      cell.status = worseStatus(cell.status, "ok");
    } else {
      cell.status = worseStatus(cell.status, decision.reason);
      cell.detail = refusalMessage(row.staffName ?? "This staff member", decision.documentType, decision.reason, decision.expiryDate);
    }
  }

  const cells = [...cellMap.values()];
  const summary = { covered: 0, atRisk: 0, unstaffed: 0 };
  for (const cell of cells) {
    if (cell.status === "ok") summary.covered++;
    else if (cell.status === "unstaffed") summary.unstaffed++;
    else summary.atRisk++;
  }

  const roles: CoverageRole[] = roleIds.map((roleId) => ({ roleId, roleName: roleNames.get(roleId)! }));

  return { storeLocationId, from, to, roles, cells, summary };
}
