import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { organisation, userOrganisation, user } from "../db/schema.js";
import {
  createOrganisation,
  updateOrganisation,
  regenerateJoinKey,
  updateMemberRole,
} from "./organisationService.js";

/**
 * Real-database behaviour of organisation management, gated on TENANT_IT=1
 * same convention as roster.integration.test.ts. Covers the createdBy-vs-role
 * authorization bug found while investigating "Alex can't view the Org Admin
 * page": updateOrganisation/regenerateJoinKey originally checked
 * organisation.createdBy only, ignoring userOrganisation.role entirely — a
 * member PROMOTED to admin (via updateMemberRole, the exact mechanism the
 * Team Members UI uses) could never actually update org details or rotate
 * the join key, even though they're a real admin by every other measure in
 * the app (client UI gating, member-management endpoints).
 */
const RUN = process.env.TENANT_IT === "1";

const tag = `org_${Date.now().toString(36)}`;

describe.skipIf(!RUN)("organisationService (real DB)", () => {
  let creatorId: number;
  let promotedAdminId: number;
  let memberId: number;
  let orgId: number;

  beforeAll(async () => {
    [{ id: creatorId }] = await db
      .insert(user)
      .values({ userName: `${tag} Creator`, userEmail: `${tag}-creator@it.test` })
      .returning({ id: user.userId });
    [{ id: promotedAdminId }] = await db
      .insert(user)
      .values({ userName: `${tag} Promoted Admin`, userEmail: `${tag}-promoted@it.test` })
      .returning({ id: user.userId });
    [{ id: memberId }] = await db
      .insert(user)
      .values({ userName: `${tag} Member`, userEmail: `${tag}-member@it.test` })
      .returning({ id: user.userId });

    const created = await createOrganisation(creatorId, { name: `${tag} Org` });
    orgId = created.organisationId;

    await db.insert(userOrganisation).values([
      { userId: promotedAdminId, organisationId: orgId, role: "member" },
      { userId: memberId, organisationId: orgId, role: "member" },
    ]);
    // Promote via the same mechanism the Team Members UI uses — not a raw
    // insert with role "admin" directly, so this test exercises the exact
    // real-world path that produces the bug scenario.
    await updateMemberRole(orgId, promotedAdminId, "admin");
  });

  afterAll(async () => {
    if (orgId) {
      await db.delete(userOrganisation).where(eq(userOrganisation.organisationId, orgId));
      await db.delete(organisation).where(eq(organisation.organisationId, orgId));
    }
    await db.delete(user).where(inArray(user.userId, [creatorId, promotedAdminId, memberId]));
  });

  describe("updateOrganisation", () => {
    it("succeeds for a member PROMOTED to admin (not the creator) — the bug scenario", async () => {
      const updated = await updateOrganisation(promotedAdminId, orgId, { name: `${tag} Org (renamed by promoted admin)` });
      expect(updated.organisationName).toBe(`${tag} Org (renamed by promoted admin)`);
    });

    it("still succeeds for the creator — regression", async () => {
      const updated = await updateOrganisation(creatorId, orgId, { name: `${tag} Org (renamed by creator)` });
      expect(updated.organisationName).toBe(`${tag} Org (renamed by creator)`);
    });

    it("rejects a plain (non-admin) member", async () => {
      await expect(updateOrganisation(memberId, orgId, { name: "Should not save" })).rejects.toThrow(
        /admin/i,
      );
    });
  });

  describe("regenerateJoinKey", () => {
    it("succeeds for a member PROMOTED to admin (not the creator) — the bug scenario", async () => {
      const newKey = await regenerateJoinKey(promotedAdminId, orgId);
      expect(newKey).toMatch(/^CULINAIRE-/);
    });

    it("still succeeds for the creator — regression", async () => {
      const newKey = await regenerateJoinKey(creatorId, orgId);
      expect(newKey).toMatch(/^CULINAIRE-/);
    });

    it("rejects a plain (non-admin) member", async () => {
      await expect(regenerateJoinKey(memberId, orgId)).rejects.toThrow(/admin/i);
    });
  });
});
