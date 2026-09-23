import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import type { Request, Response } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { organisation, user, userOrganisation, userRole, role } from "../db/schema.js";
import { createOrganisation, joinOrganisation, leaveOrganisation } from "./organisationService.js";
import { getUserWithRolesAndPermissions, type TokenPayload } from "./authService.js";
import {
  handleUpdateOrganisation,
  handleUpdateMemberRole,
  handleRemoveMember,
  handleOrganisationLogoUpload,
} from "../controllers/organisationController.js";

/**
 * Real-database tenant-isolation canary for the Operations Admin role.
 *
 * org:manage-organisation is a GLOBAL permission (user_role has no
 * organisationId column — see the plan's disclosed limitation), so the
 * thing that actually needs proving here isn't "does Operations Admin get
 * the permission" (that's organisationService.test.ts's job, hermetic and
 * fast) — it's "does holding that global permission ever let someone act on
 * an org they don't belong to." It must not, and getMembership()'s
 * unconditional first check (isOrgManager in organisationController.ts) is
 * what's supposed to prevent it.
 *
 * Calls the real controller handlers directly (not through Express) against
 * the real DB, since the authorization decision lives inline in those
 * handlers, not in route middleware — rosterPermissions.test.ts's
 * middleware-stack-walking technique doesn't apply here.
 *
 * Gated on TENANT_IT=1. Self-cleaning in reverse dependency order.
 */
const RUN = process.env.TENANT_IT === "1";

function makeRes() {
  let statusCode: number | null = null;
  let body: unknown = null;
  const res = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: unknown) {
      body = data;
      return res;
    },
  };
  return { res: res as unknown as Response, getStatus: () => statusCode, getBody: () => body };
}

function makeReq(userPayload: TokenPayload, params: Record<string, string>, bodyData: Record<string, unknown> = {}) {
  return { user: userPayload, params, body: bodyData } as unknown as Request;
}

const noopNext = () => {};

describe.skipIf(!RUN)("Operations Admin — tenant isolation (real DB)", () => {
  const tag = `oait_${Date.now().toString(36)}`;
  let userA: number;
  let userB: number;
  let userC: number;
  let userD: number;
  let orgA: number;
  let orgB: number;
  let orgD: number;
  let secondOrgForUserA: number;
  let opsAdminRoleId: number;

  beforeAll(async () => {
    [{ id: userA }] = await db.insert(user).values({ userName: "OAIT A", userEmail: `${tag}-a@it.test` }).returning({ id: user.userId });
    [{ id: userB }] = await db.insert(user).values({ userName: "OAIT B", userEmail: `${tag}-b@it.test` }).returning({ id: user.userId });
    [{ id: userC }] = await db.insert(user).values({ userName: "OAIT C", userEmail: `${tag}-c@it.test` }).returning({ id: user.userId });
    [{ id: userD }] = await db.insert(user).values({ userName: "OAIT D", userEmail: `${tag}-d@it.test` }).returning({ id: user.userId });

    const [opsAdmin] = await db.select().from(role).where(eq(role.roleName, "Operations Admin"));
    if (!opsAdmin) throw new Error("Operations Admin role not seeded — run db/seed.ts before this suite.");
    opsAdminRoleId = opsAdmin.roleId;

    const orgAResult = await createOrganisation(userA, { name: `${tag}-orgA` });
    orgA = orgAResult.organisationId;
    const orgBResult = await createOrganisation(userB, { name: `${tag}-orgB` });
    orgB = orgBResult.organisationId;
    const orgDResult = await createOrganisation(userD, { name: `${tag}-orgD` });
    orgD = orgDResult.organisationId;

    // userC joins orgB as a plain member — not an org admin, not Operations Admin.
    await joinOrganisation(userC, orgBResult.joinKey);
    // userD is Operations Admin of their OWN org (orgD), then separately joins
    // orgB as a plain member — the exact shape the cross-org escalation needs:
    // a real global org:manage-organisation holder who is genuinely a member
    // (not admin) of a DIFFERENT org.
    await joinOrganisation(userD, orgBResult.joinKey);
  });

  afterAll(async () => {
    const orgIds = [orgA, orgB, orgD, secondOrgForUserA].filter(Boolean);
    if (orgIds.length) {
      await db.delete(userRole).where(and(inArray(userRole.userId, [userA, userB, userC, userD]), eq(userRole.roleId, opsAdminRoleId)));
      await db.delete(userOrganisation).where(inArray(userOrganisation.organisationId, orgIds));
      await db.delete(organisation).where(inArray(organisation.organisationId, orgIds));
    }
    await db.delete(user).where(inArray(user.userId, [userA, userB, userC, userD]));
  });

  it("createOrganisation grants the creator exactly one Operations Admin user_role row", async () => {
    const rows = await db
      .select()
      .from(userRole)
      .where(and(eq(userRole.userId, userA), eq(userRole.roleId, opsAdminRoleId)));
    expect(rows).toHaveLength(1);
  });

  it("creating a second organisation for the same user never duplicates the grant", async () => {
    const secondOrg = await createOrganisation(userA, { name: `${tag}-orgA-second` });
    secondOrgForUserA = secondOrg.organisationId;

    const rows = await db
      .select()
      .from(userRole)
      .where(and(eq(userRole.userId, userA), eq(userRole.roleId, opsAdminRoleId)));
    expect(rows).toHaveLength(1);
  });

  it("Operations Admin of org A cannot manage org B's members, despite holding the same global permission org B's own admin holds", async () => {
    const authUserA = await getUserWithRolesAndPermissions(userA);
    expect(authUserA.permissions).toContain("org:manage-organisation");

    const reqPayload: TokenPayload = { sub: userA, roles: authUserA.roles, permissions: authUserA.permissions };

    const { res: patchRes, getStatus: patchStatus } = makeRes();
    await handleUpdateMemberRole(
      makeReq(reqPayload, { id: String(orgB), userId: String(userC) }, { role: "admin" }),
      patchRes,
      noopNext,
    );
    expect(patchStatus()).toBe(403);

    const { res: deleteRes, getStatus: deleteStatus } = makeRes();
    await handleRemoveMember(makeReq(reqPayload, { id: String(orgB), userId: String(userC) }), deleteRes, noopNext);
    expect(deleteStatus()).toBe(403);

    const { res: updateRes, getStatus: updateStatus } = makeRes();
    await handleUpdateOrganisation(makeReq(reqPayload, { id: String(orgB) }, { name: "Hijacked name" }), updateRes, noopNext);
    expect(updateStatus()).toBe(403);

    // Same isOrgManager gate, same handler family — handleOrganisationLogoUpload
    // checks it before looking at req.file, so the 403 fires without a file.
    const { res: logoRes, getStatus: logoStatus } = makeRes();
    await handleOrganisationLogoUpload(makeReq(reqPayload, { id: String(orgB) }), logoRes, noopNext);
    expect(logoStatus()).toBe(403);
  });

  it("Operations Admin of org A CAN update org A's own details — the positive case the negative case above is contrasted against", async () => {
    const authUserA = await getUserWithRolesAndPermissions(userA);
    const reqPayload: TokenPayload = { sub: userA, roles: authUserA.roles, permissions: authUserA.permissions };

    const { res, getStatus, getBody } = makeRes();
    await handleUpdateOrganisation(makeReq(reqPayload, { id: String(orgA) }, { name: `${tag}-orgA-renamed` }), res, noopNext);
    expect(getStatus()).toBeNull(); // no error status set — handler responded via res.json without calling status()
    expect((getBody() as { organisation?: { organisationName?: string } })?.organisation?.organisationName).toBe(
      `${tag}-orgA-renamed`,
    );
  });

  it("a global org:manage-organisation holder who is merely a MEMBER of org B (not org B's admin) cannot self-promote, promote others, remove members, or edit org B's details — closes the cross-org escalation isOrgManager's old OR-fallback allowed", async () => {
    const authUserD = await getUserWithRolesAndPermissions(userD);
    expect(authUserD.permissions).toContain("org:manage-organisation");

    const reqPayload: TokenPayload = { sub: userD, roles: authUserD.roles, permissions: authUserD.permissions };

    // Self-promotion to admin in a foreign org — the persistent-privilege
    // escalation: a global permission must never let someone write a NEW
    // standing per-org admin flag into an org they don't already administer.
    const { res: selfPromoteRes, getStatus: selfPromoteStatus } = makeRes();
    await handleUpdateMemberRole(
      makeReq(reqPayload, { id: String(orgB), userId: String(userD) }, { role: "admin" }),
      selfPromoteRes,
      noopNext,
    );
    expect(selfPromoteStatus()).toBe(403);

    // Promoting someone ELSE to admin in a foreign org.
    const { res: promoteRes, getStatus: promoteStatus } = makeRes();
    await handleUpdateMemberRole(
      makeReq(reqPayload, { id: String(orgB), userId: String(userC) }, { role: "admin" }),
      promoteRes,
      noopNext,
    );
    expect(promoteStatus()).toBe(403);

    const { res: removeRes, getStatus: removeStatus } = makeRes();
    await handleRemoveMember(makeReq(reqPayload, { id: String(orgB), userId: String(userC) }), removeRes, noopNext);
    expect(removeStatus()).toBe(403);

    const { res: updateRes, getStatus: updateStatus } = makeRes();
    await handleUpdateOrganisation(makeReq(reqPayload, { id: String(orgB) }, { name: "Hijacked by a mere member" }), updateRes, noopNext);
    expect(updateStatus()).toBe(403);

    // Sanity: userD's OWN org (orgD, where they're the real creator/admin)
    // is unaffected by tightening isOrgManager.
    const { res: ownOrgRes, getStatus: ownOrgStatus, getBody: ownOrgBody } = makeRes();
    await handleUpdateOrganisation(makeReq(reqPayload, { id: String(orgD) }, { name: `${tag}-orgD-renamed` }), ownOrgRes, noopNext);
    expect(ownOrgStatus()).toBeNull();
    expect((ownOrgBody() as { organisation?: { organisationName?: string } })?.organisation?.organisationName).toBe(
      `${tag}-orgD-renamed`,
    );
  });

  it("branding fields survive a submit from the org-details form (which never sends them), but an explicit empty string clears them", async () => {
    const authUserA = await getUserWithRolesAndPermissions(userA);
    const reqPayload: TokenPayload = { sub: userA, roles: authUserA.roles, permissions: authUserA.permissions };

    // Organisation Settings form sets a colour.
    const { res: setRes, getBody: setBody } = makeRes();
    await handleUpdateOrganisation(makeReq(reqPayload, { id: String(orgA) }, { name: `${tag}-orgA`, colorAccent: "#FF6B35" }), setRes, noopNext);
    expect((setBody() as { organisation: { organisationColorAccent: string | null } }).organisation.organisationColorAccent).toBe("#FF6B35");

    // Org-details form submits name-only — colorAccent is absent from the body, not "".
    const { res: preserveRes, getBody: preserveBody } = makeRes();
    await handleUpdateOrganisation(makeReq(reqPayload, { id: String(orgA) }, { name: `${tag}-orgA-v2` }), preserveRes, noopNext);
    expect((preserveBody() as { organisation: { organisationColorAccent: string | null } }).organisation.organisationColorAccent).toBe(
      "#FF6B35",
    );

    // Organisation Settings form explicitly clears it.
    const { res: clearRes, getBody: clearBody } = makeRes();
    await handleUpdateOrganisation(makeReq(reqPayload, { id: String(orgA) }, { name: `${tag}-orgA-v2`, colorAccent: "" }), clearRes, noopNext);
    expect((clearBody() as { organisation: { organisationColorAccent: string | null } }).organisation.organisationColorAccent).toBeNull();
  });

  it("updating own org with an invalid colorAccent is rejected 400 by the Zod schema, not silently coerced or persisted", async () => {
    const authUserA = await getUserWithRolesAndPermissions(userA);
    const reqPayload: TokenPayload = { sub: userA, roles: authUserA.roles, permissions: authUserA.permissions };

    const { res, getStatus, getBody } = makeRes();
    await handleUpdateOrganisation(
      makeReq(reqPayload, { id: String(orgA) }, { name: `${tag}-orgA`, colorAccent: "not-a-hex-color" }),
      res,
      noopNext,
    );
    expect(getStatus()).toBe(400);
    expect(getBody()).toHaveProperty("error");
  });

  it("uploading a logo with no file attached is rejected 400 after the (passing) admin gate — the not-file-missing branch, not the auth branch", async () => {
    const authUserA = await getUserWithRolesAndPermissions(userA);
    const reqPayload: TokenPayload = { sub: userA, roles: authUserA.roles, permissions: authUserA.permissions };

    const { res, getStatus, getBody } = makeRes();
    await handleOrganisationLogoUpload(makeReq(reqPayload, { id: String(orgA) }), res, noopNext);
    expect(getStatus()).toBe(400);
    expect(getBody()).toEqual({ error: "No file provided" });
  });

  it("a plain member of org B (not an org admin, not Operations Admin) cannot manage org B's members", async () => {
    const authUserC = await getUserWithRolesAndPermissions(userC);
    expect(authUserC.permissions).not.toContain("org:manage-organisation");

    const reqPayload: TokenPayload = { sub: userC, roles: authUserC.roles, permissions: authUserC.permissions };
    const { res, getStatus } = makeRes();
    await handleRemoveMember(makeReq(reqPayload, { id: String(orgB), userId: String(userB) }), res, noopNext);
    expect(getStatus()).toBe(403);
  });
});

/**
 * Adversarial review (real gap, confirmed by direct code read): the deleted
 * ORG_ADMIN_PERMISSIONS bridge was recomputed live on every token mint, off
 * current userOrganisation rows — it dropped the instant a user stopped
 * admining anywhere. The role-based Operations Admin grant is a static
 * user_role row; nothing revoked it. Worst case: compliance:manage-rules
 * gates document_expiry_rule, which carries no organisationId at all — a
 * stale grant meant global, platform-wide compliance-rule authorship for a
 * user with zero organisations. Fixed by revokeOperationsAdminRoleIfNoLongerAdmin,
 * called from leaveOrganisation / removeMember / updateMemberRole (demotion).
 */
describe.skipIf(!RUN)("Operations Admin — grant is revoked, not just orphaned (real DB)", () => {
  const tag = `oarv_${Date.now().toString(36)}`;
  let userE: number;
  let userF: number;
  let userG: number;
  let orgE: number;
  let orgESecond: number;
  let orgF: number;
  let orgG: number;
  let coAdminForG: number;
  let opsAdminRoleId: number;

  async function holdsOperationsAdmin(userId: number): Promise<boolean> {
    const rows = await db.select().from(userRole).where(and(eq(userRole.userId, userId), eq(userRole.roleId, opsAdminRoleId)));
    return rows.length > 0;
  }

  beforeAll(async () => {
    [{ id: userE }] = await db.insert(user).values({ userName: "OARV E", userEmail: `${tag}-e@it.test` }).returning({ id: user.userId });
    [{ id: userF }] = await db.insert(user).values({ userName: "OARV F", userEmail: `${tag}-f@it.test` }).returning({ id: user.userId });
    [{ id: userG }] = await db.insert(user).values({ userName: "OARV G", userEmail: `${tag}-g@it.test` }).returning({ id: user.userId });

    const [opsAdmin] = await db.select().from(role).where(eq(role.roleName, "Operations Admin"));
    if (!opsAdmin) throw new Error("Operations Admin role not seeded — run db/seed.ts before this suite.");
    opsAdminRoleId = opsAdmin.roleId;
  });

  afterAll(async () => {
    const orgIds = [orgE, orgESecond, orgF, orgG].filter(Boolean);
    const userIds = [userE, userF, userG, coAdminForG].filter(Boolean);
    if (orgIds.length) {
      await db.delete(userRole).where(and(inArray(userRole.userId, userIds), eq(userRole.roleId, opsAdminRoleId)));
      await db.delete(userOrganisation).where(inArray(userOrganisation.organisationId, orgIds));
      await db.delete(organisation).where(inArray(organisation.organisationId, orgIds));
    }
    await db.delete(user).where(inArray(user.userId, userIds));
  });

  it("leaving your only admin org revokes the Operations Admin grant", async () => {
    const org = await createOrganisation(userE, { name: `${tag}-orgE` });
    orgE = org.organisationId;
    expect(await holdsOperationsAdmin(userE)).toBe(true);

    await leaveOrganisation(userE, orgE);

    expect(await holdsOperationsAdmin(userE)).toBe(false);
  });

  it("leaving one org keeps the grant while still admining another", async () => {
    const first = await createOrganisation(userF, { name: `${tag}-orgF` });
    orgF = first.organisationId;
    const second = await createOrganisation(userF, { name: `${tag}-orgE-second` });
    orgESecond = second.organisationId;
    expect(await holdsOperationsAdmin(userF)).toBe(true);

    await leaveOrganisation(userF, orgF);

    expect(await holdsOperationsAdmin(userF)).toBe(true);
  });

  it("being demoted (Make Member) out of your only admin org revokes the grant", async () => {
    const org = await createOrganisation(userG, { name: `${tag}-orgG` });
    orgG = org.organisationId;
    expect(await holdsOperationsAdmin(userG)).toBe(true);

    const authUserG = await getUserWithRolesAndPermissions(userG);
    const reqPayload: TokenPayload = { sub: userG, roles: authUserG.roles, permissions: authUserG.permissions };
    // updateMemberRole's "last admin" guard blocks demoting the ONLY admin
    // — seed a second admin first via a direct membership row so userG's
    // own demotion is the case under test, not the guard.
    [{ id: coAdminForG }] = await db.insert(user).values({ userName: "OARV G co-admin", userEmail: `${tag}-g2@it.test` }).returning({ id: user.userId });
    await db.insert(userOrganisation).values({ userId: coAdminForG, organisationId: orgG, role: "admin" });

    const { res, getStatus } = makeRes();
    await handleUpdateMemberRole(makeReq(reqPayload, { id: String(orgG), userId: String(userG) }, { role: "member" }), res, noopNext);
    expect(getStatus()).toBeNull();

    expect(await holdsOperationsAdmin(userG)).toBe(false);
  });
});
