import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

/**
 * Integration tests for the Brain pipeline against a REAL local Postgres
 * (docs/specs/brain-memory.md T10 + testing plan):
 *
 *  - capture → claim → embed → recall round-trip
 *  - USER-ISOLATION CANARY A∦B (the Phase-1 exit test)
 *  - upsert on the real unique constraint (NULL source_ref never collides)
 *  - worker double-claim safety (SKIP LOCKED)
 *  - poisoned row stops at attempt 3 (terminal 'failed')
 *  - zero-memory existence gate (no query embed spent)
 *  - zero-org user recalls user-scope memories (spec E4 Phase-1 posture)
 *
 * The embedding API is mocked (deterministic vectors, no cost); everything
 * else — SQL, constraints, SKIP LOCKED, `<=>` ordering — is real. The whole
 * suite SKIPS when no local database is reachable (e.g. CI), matching the
 * repo's hermetic-tests-in-CI convention; run locally per the spec's
 * "verify against a local DB" instruction.
 */

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

// Deterministic embeddings — index-of-1.0 marks the "topic".
function fakeVector(hotIndex: number): number[] {
  const v = new Array(1536).fill(0);
  v[hotIndex % 1536] = 1;
  return v;
}
let nextEmbedding: number[] | null = fakeVector(0);
const embedTextMock = vi.fn(async () => nextEmbedding);
vi.mock("./knowledgeService.js", () => ({
  embedText: embedTextMock,
}));

const { sql } = await import("drizzle-orm");
const { db } = await import("../db/index.js");

const dbAvailable = await (async () => {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
})();

const suite = describe.runIf(dbAvailable);
if (!dbAvailable) {
  console.warn("brainIntegration.test.ts: no local database reachable — suite skipped");
}

suite("Brain integration (real local DB)", () => {
  let userA = 0;
  let userB = 0;
  const flagBackup: Record<string, string> = {};

  beforeAll(async () => {
    const { getAllSettings, upsertSettings } = await import("./settingsService.js");

    // Snapshot + enable the Brain flags for the duration of the suite.
    const settings = await getAllSettings();
    for (const key of ["brain_enabled", "brain_capture_enabled", "brain_recall_enabled"]) {
      flagBackup[key] = settings[key] ?? "false";
    }
    await upsertSettings({
      brain_enabled: "true",
      brain_capture_enabled: "true",
      brain_recall_enabled: "true",
    });

    // Two fixture users. Deliberately NO user_organisation rows — user A is
    // the spec's "zero-org user" (recall must work user-scope only, E4).
    const rows = (await db.execute(sql`
      INSERT INTO "user" (user_name, user_email)
      VALUES ('Brain Canary A', ${`brain-canary-a-${randomUUID()}@test.local`}),
             ('Brain Canary B', ${`brain-canary-b-${randomUUID()}@test.local`})
      RETURNING user_id
    `)) as unknown as Array<{ user_id: number }>;
    userA = rows[0].user_id;
    userB = rows[1].user_id;
  });

  afterAll(async () => {
    const { upsertSettings } = await import("./settingsService.js");
    await upsertSettings(flagBackup);
    if (userA && userB) {
      await db.execute(sql`DELETE FROM brain_memory WHERE user_id IN (${userA}, ${userB})`);
      await db.execute(sql`DELETE FROM "user" WHERE user_id IN (${userA}, ${userB})`);
    }
  });

  it("existence gate: a zero-memory user never pays a query embed", async () => {
    const { recallMemories } = await import("./brainRecallService.js");
    embedTextMock.mockClear();

    const result = await recallMemories(userA, "anything at all");

    expect(result).toBeNull();
    expect(embedTextMock).not.toHaveBeenCalled();
  });

  it("captures → claims → embeds → recalls a chat turn (round-trip), user-scope for a zero-org user", async () => {
    const { recordMemory } = await import("./brainCaptureService.js");
    const { runBrainWorkerTick } = await import("./brainWorker.js");
    const { recallMemories } = await import("./brainRecallService.js");

    nextEmbedding = fakeVector(1);
    await recordMemory({
      userId: userA,
      sourceType: "chat",
      title: "Hollandaise rescue",
      rawContent: "Cook asked: my hollandaise split. CulinAIre answered: fresh yolk, warm water.",
    });

    const tick = await runBrainWorkerTick();
    expect(tick.claimed).toBeGreaterThanOrEqual(1);
    expect(tick.failed).toBe(0);

    const [row] = (await db.execute(sql`
      SELECT status, embedding IS NOT NULL AS has_embedding
      FROM brain_memory WHERE user_id = ${userA} AND source_type = 'chat'
    `)) as unknown as Array<{ status: string; has_embedding: boolean }>;
    expect(row.status).toBe("ready");
    expect(row.has_embedding).toBe(true);

    // Recall with the same topic vector — userA has ZERO org memberships,
    // so this also proves the zero-org / user-scope-only posture (E4).
    nextEmbedding = fakeVector(1);
    const recall = await recallMemories(userA, "how did I fix my hollandaise?");
    expect(recall).not.toBeNull();
    expect(recall!.block).toContain("## Brain Memory");
    expect(recall!.block).toContain("hollandaise");
    expect(recall!.memories[0].title).toBe("Hollandaise rescue");
  });

  it("USER-ISOLATION CANARY: A's recall NEVER returns B's memories (A∦B)", async () => {
    const { recordMemory } = await import("./brainCaptureService.js");
    const { runBrainWorkerTick } = await import("./brainWorker.js");
    const { recallMemories } = await import("./brainRecallService.js");

    // B records a memory with the IDENTICAL topic vector to A's — if the
    // tenant filter ever leaks, B's memory would out-rank everything.
    nextEmbedding = fakeVector(1);
    await recordMemory({
      userId: userB,
      sourceType: "chat",
      title: "B's secret supplier pricing",
      rawContent: "Cook asked: our secret negotiated supplier rates are 40 percent below market.",
    });
    await runBrainWorkerTick();

    nextEmbedding = fakeVector(1);
    const recallA = await recallMemories(userA, "hollandaise supplier rates");
    expect(recallA).not.toBeNull();
    const titlesA = recallA!.memories.map((m) => m.title ?? "");
    expect(titlesA).not.toContain("B's secret supplier pricing");
    expect(recallA!.block).not.toContain("secret");

    const recallB = await recallMemories(userB, "supplier rates");
    expect(recallB).not.toBeNull();
    const titlesB = recallB!.memories.map((m) => m.title ?? "");
    expect(titlesB).toContain("B's secret supplier pricing");
    expect(titlesB).not.toContain("Hollandaise rescue");
  });

  it("upsert: same (user, sourceType, sourceRef) updates in place; NULL sourceRef always inserts", async () => {
    const { recordMemory } = await import("./brainCaptureService.js");

    nextEmbedding = fakeVector(2);
    await recordMemory({ userId: userA, sourceType: "recipe", sourceRef: "r-1", rawContent: "v1 of the recipe note" });
    await recordMemory({ userId: userA, sourceType: "recipe", sourceRef: "r-1", rawContent: "v2 of the recipe note" });

    const recipeRows = (await db.execute(sql`
      SELECT body, status FROM brain_memory
      WHERE user_id = ${userA} AND source_type = 'recipe' AND source_ref = 'r-1'
    `)) as unknown as Array<{ body: string; status: string }>;
    expect(recipeRows).toHaveLength(1);
    expect(recipeRows[0].body).toContain("v2");
    expect(recipeRows[0].status).toBe("pending"); // re-entered the embed queue

    // Chat rows (NULL source_ref) never collide → both turns persist.
    await recordMemory({ userId: userA, sourceType: "chat", rawContent: "turn one" });
    await recordMemory({ userId: userA, sourceType: "chat", rawContent: "turn two" });
    const chatCount = (await db.execute(sql`
      SELECT count(*)::int AS n FROM brain_memory
      WHERE user_id = ${userA} AND source_type = 'chat' AND body IN ('turn one', 'turn two')
    `)) as unknown as Array<{ n: number }>;
    expect(chatCount[0].n).toBe(2);
  });

  it("SKIP LOCKED: two concurrent worker ticks never double-claim a row", async () => {
    const { runBrainWorkerTick } = await import("./brainWorker.js");

    // Queue exactly the pending rows created above (recipe v2 + two chat turns).
    const pendingBefore = (await db.execute(sql`
      SELECT count(*)::int AS n FROM brain_memory WHERE status = 'pending'
        AND user_id IN (${userA}, ${userB})
    `)) as unknown as Array<{ n: number }>;
    const queued = pendingBefore[0].n;
    expect(queued).toBeGreaterThan(0);

    nextEmbedding = fakeVector(3);
    const [tick1, tick2] = await Promise.all([runBrainWorkerTick(), runBrainWorkerTick()]);

    // Every queued row claimed exactly once across the two ticks.
    expect(tick1.claimed + tick2.claimed).toBe(queued);
    const leftover = (await db.execute(sql`
      SELECT count(*)::int AS n FROM brain_memory
      WHERE status IN ('pending', 'processing') AND user_id IN (${userA}, ${userB})
    `)) as unknown as Array<{ n: number }>;
    expect(leftover[0].n).toBe(0);
  });

  it("poisoned row: stops permanently at attempt 3 (terminal 'failed', never re-claimed)", async () => {
    const { recordMemory } = await import("./brainCaptureService.js");
    const { runBrainWorkerTick } = await import("./brainWorker.js");

    await recordMemory({ userId: userA, sourceType: "stock", sourceRef: "poison-1", rawContent: "unembeddable row" });
    nextEmbedding = null; // embed API "down"

    for (let attempt = 1; attempt <= 3; attempt++) {
      // Make the row due immediately (collapse the backoff window).
      await db.execute(sql`
        UPDATE brain_memory SET next_attempt_dttm = NULL
        WHERE user_id = ${userA} AND source_ref = 'poison-1'
      `);
      await runBrainWorkerTick();
    }

    const [poisoned] = (await db.execute(sql`
      SELECT status, attempt_count FROM brain_memory
      WHERE user_id = ${userA} AND source_ref = 'poison-1'
    `)) as unknown as Array<{ status: string; attempt_count: number }>;
    expect(poisoned.status).toBe("failed");
    expect(poisoned.attempt_count).toBe(3);

    // Terminal means terminal: another tick must not claim it.
    await db.execute(sql`
      UPDATE brain_memory SET next_attempt_dttm = NULL
      WHERE user_id = ${userA} AND source_ref = 'poison-1'
    `);
    const tick = await runBrainWorkerTick();
    expect(tick.claimed).toBe(0);

    nextEmbedding = fakeVector(0); // restore for any later suite
  });
});

/**
 * Org-tier isolation suite (docs/specs/brain-memory.md T11, Phase 2). Proves the
 * two-tier recall + management surface keeps orgs apart:
 *
 *  - ORG-ISOLATION CANARY X∦Y: an org-X member never recalls org-Y's shared rows
 *  - positive org recall: an org-Y member DOES recall org-Y's shared rows
 *  - EX-MEMBER CANARY: a removed member (stale selected_organisation_id) recalls
 *    nothing from the org they left — resolveActiveOrg refuses the stale value
 *  - resolveActiveOrg: all four deterministic rungs + stale-drops-to-fallback
 *  - management: listMemories tenant boundary + scope filter; deleteMemory
 *    org-admin authorisation matrix (owner-org admin only)
 *
 * Same harness as above: embeddings mocked, SQL/constraints/`<=>` real, whole
 * suite SKIPS with no local DB.
 */
suite("Brain org tier (real local DB)", () => {
  let orgX = 0;
  let orgY = 0;
  let locYId = "";
  let userX = 0; // member of orgX (+ a private memory)
  let adminX = 0; // admin of orgX (other-org admin for delete matrix)
  let userY = 0; // member of orgY (non-admin)
  let adminY = 0; // admin of orgY (authors org memories)
  let multiUser = 0; // member of BOTH orgs (lowest-membership fallback)
  let noOrgUser = 0; // no memberships (resolves to null)
  let exUser = 0; // member of orgY, then removed
  let locUser = 0; // member of both, active via selected location in orgY
  const flagBackup: Record<string, string> = {};

  const key = (p: string) => `${p}-${randomUUID().slice(0, 12)}`;

  beforeAll(async () => {
    const { getAllSettings, upsertSettings } = await import("./settingsService.js");
    const settings = await getAllSettings();
    for (const k of ["brain_enabled", "brain_capture_enabled", "brain_recall_enabled"]) {
      flagBackup[k] = settings[k] ?? "false";
    }
    await upsertSettings({
      brain_enabled: "true",
      brain_capture_enabled: "true",
      brain_recall_enabled: "true",
    });

    const users = (await db.execute(sql`
      INSERT INTO "user" (user_name, user_email) VALUES
        ('OrgTier userX',   ${`otx-${randomUUID()}@test.local`}),
        ('OrgTier adminX',  ${`ota-${randomUUID()}@test.local`}),
        ('OrgTier userY',   ${`oty-${randomUUID()}@test.local`}),
        ('OrgTier adminY',  ${`otay-${randomUUID()}@test.local`}),
        ('OrgTier multi',   ${`otm-${randomUUID()}@test.local`}),
        ('OrgTier noOrg',   ${`otn-${randomUUID()}@test.local`}),
        ('OrgTier exUser',  ${`ote-${randomUUID()}@test.local`}),
        ('OrgTier locUser', ${`otl-${randomUUID()}@test.local`})
      RETURNING user_id
    `)) as unknown as Array<{ user_id: number }>;
    [userX, adminX, userY, adminY, multiUser, noOrgUser, exUser, locUser] = users.map(
      (u) => u.user_id,
    );

    const orgs = (await db.execute(sql`
      INSERT INTO organisation (organisation_name, join_key, created_by) VALUES
        ('Kitchen X', ${key("jkx")}, ${adminX}),
        ('Kitchen Y', ${key("jky")}, ${adminY})
      RETURNING organisation_id
    `)) as unknown as Array<{ organisation_id: number }>;
    orgX = orgs[0].organisation_id;
    orgY = orgs[1].organisation_id;

    await db.execute(sql`
      INSERT INTO user_organisation (user_id, organisation_id, role) VALUES
        (${userX},   ${orgX}, 'member'),
        (${adminX},  ${orgX}, 'admin'),
        (${userY},   ${orgY}, 'member'),
        (${adminY},  ${orgY}, 'admin'),
        (${multiUser}, ${orgX}, 'member'),
        (${multiUser}, ${orgY}, 'member'),
        (${exUser},  ${orgY}, 'member'),
        (${locUser}, ${orgX}, 'member'),
        (${locUser}, ${orgY}, 'member')
    `);

    // A store location in orgY, so the locUser's selected-location rung resolves
    // to orgY even though orgX is the numerically-lower membership.
    const locs = (await db.execute(sql`
      INSERT INTO store_location (organisation_id, location_name, store_key, created_by)
      VALUES (${orgY}, 'Kitchen Y HQ', ${key("skY")}, ${adminY})
      RETURNING store_location_id
    `)) as unknown as Array<{ store_location_id: string }>;
    locYId = locs[0].store_location_id;
    await db.execute(sql`
      UPDATE "user" SET selected_location_id = ${locYId} WHERE user_id = ${locUser}
    `);
  });

  afterAll(async () => {
    const { upsertSettings } = await import("./settingsService.js");
    await upsertSettings(flagBackup);
    const ids = [userX, adminX, userY, adminY, multiUser, noOrgUser, exUser, locUser].filter(
      Boolean,
    );
    if (ids.length) {
      // ids are DB-issued integers — safe to inline as a raw IN list.
      const idList = sql.raw(ids.join(","));
      await db.execute(sql`DELETE FROM brain_memory WHERE user_id IN (${idList})`);
      if (locYId) await db.execute(sql`UPDATE "user" SET selected_location_id = NULL WHERE user_id = ${locUser}`);
      if (locYId) await db.execute(sql`DELETE FROM store_location WHERE store_location_id = ${locYId}`);
      await db.execute(sql`DELETE FROM user_organisation WHERE user_id IN (${idList})`);
      await db.execute(sql`DELETE FROM "user" WHERE user_id IN (${idList})`);
      await db.execute(sql`DELETE FROM organisation WHERE organisation_id IN (${orgX}, ${orgY})`);
    }
  });

  it("seeds a ready org-shared memory in orgY and a private memory for userX", async () => {
    const { recordMemory } = await import("./brainCaptureService.js");
    const { runBrainWorkerTick } = await import("./brainWorker.js");

    // Org-Y shared memory (authored by adminY), identical hot vector to userX's
    // private memory — the leak trap for the X∦Y canary.
    nextEmbedding = fakeVector(7);
    await recordMemory({
      userId: adminY,
      organisationId: orgY,
      scope: "org",
      sourceType: "waste",
      sourceRef: "orgY-waste-1",
      title: "Kitchen Y waste rule",
      rawContent: "Cook logged: trim beef offcuts into stock, never the bin.",
    });
    // userX's OWN private memory, same topic vector.
    nextEmbedding = fakeVector(7);
    await recordMemory({
      userId: userX,
      sourceType: "chat",
      title: "X private note",
      rawContent: "Cook asked: how do I portion beef offcuts for my own station?",
    });
    await runBrainWorkerTick();

    const ready = (await db.execute(sql`
      SELECT count(*)::int AS n FROM brain_memory
      WHERE status = 'ready' AND user_id IN (${adminY}, ${userX})
    `)) as unknown as Array<{ n: number }>;
    expect(ready[0].n).toBe(2);
  });

  it("ORG-ISOLATION CANARY: an org-X member NEVER recalls org-Y's shared memory (X∦Y)", async () => {
    const { recallMemories } = await import("./brainRecallService.js");
    const { resolveActiveOrg } = await import("./activeOrgService.js");

    const activeX = await resolveActiveOrg(userX);
    expect(activeX).toBe(orgX);

    nextEmbedding = fakeVector(7); // identical topic vector to org-Y's memory
    const recallX = await recallMemories(userX, "portioning beef offcuts", activeX);
    expect(recallX).not.toBeNull();
    const titlesX = recallX!.memories.map((m) => m.title ?? "");
    expect(titlesX).toContain("X private note");
    expect(titlesX).not.toContain("Kitchen Y waste rule");
    expect(recallX!.block).not.toContain("never the bin");
  });

  it("positive org recall: an org-Y member DOES recall org-Y's shared memory", async () => {
    const { recallMemories } = await import("./brainRecallService.js");
    const { resolveActiveOrg } = await import("./activeOrgService.js");

    const activeY = await resolveActiveOrg(userY);
    expect(activeY).toBe(orgY);

    nextEmbedding = fakeVector(7);
    const recallY = await recallMemories(userY, "what to do with beef offcuts", activeY);
    expect(recallY).not.toBeNull();
    const titlesY = recallY!.memories.map((m) => m.title ?? "");
    expect(titlesY).toContain("Kitchen Y waste rule");
    expect(recallY!.block).toContain("beef offcuts");
  });

  it("EX-MEMBER CANARY: a removed member with a stale selection recalls nothing from the org they left", async () => {
    const { recallMemories } = await import("./brainRecallService.js");
    const { resolveActiveOrg } = await import("./activeOrgService.js");

    // exUser was a member of orgY and explicitly selected it — then leaves.
    await db.execute(sql`
      UPDATE "user" SET selected_organisation_id = ${orgY} WHERE user_id = ${exUser}
    `);
    await db.execute(sql`
      DELETE FROM user_organisation WHERE user_id = ${exUser} AND organisation_id = ${orgY}
    `);

    // The stored selection is refused: no live membership → null.
    const activeEx = await resolveActiveOrg(exUser);
    expect(activeEx).toBeNull();

    // Even if a stale org id were somehow passed, recall must surface nothing —
    // exUser has no private memories, so the existence gate returns null.
    nextEmbedding = fakeVector(7);
    const recallEx = await recallMemories(exUser, "beef offcuts", activeEx);
    expect(recallEx).toBeNull();
  });

  it("resolveActiveOrg: explicit live selection wins", async () => {
    const { resolveActiveOrg } = await import("./activeOrgService.js");
    // multiUser belongs to both orgs; explicitly select orgY (a live membership).
    await db.execute(sql`
      UPDATE "user" SET selected_organisation_id = ${orgY} WHERE user_id = ${multiUser}
    `);
    expect(await resolveActiveOrg(multiUser)).toBe(orgY);
    // Reset for the fallback test below.
    await db.execute(sql`
      UPDATE "user" SET selected_organisation_id = NULL WHERE user_id = ${multiUser}
    `);
  });

  it("resolveActiveOrg: selected-location org wins over lowest-membership fallback", async () => {
    const { resolveActiveOrg } = await import("./activeOrgService.js");
    // locUser is in both orgs, no explicit org, selected location is in orgY.
    // Lowest membership would be orgX; the location rung must return orgY.
    expect(Math.min(orgX, orgY)).toBe(orgX);
    expect(await resolveActiveOrg(locUser)).toBe(orgY);
  });

  it("resolveActiveOrg: falls back to the numerically-lowest membership", async () => {
    const { resolveActiveOrg } = await import("./activeOrgService.js");
    // multiUser: both orgs, no selection, no location → lowest org id.
    expect(await resolveActiveOrg(multiUser)).toBe(Math.min(orgX, orgY));
  });

  it("resolveActiveOrg: stale selection (non-member org) drops to fallback", async () => {
    const { resolveActiveOrg } = await import("./activeOrgService.js");
    // adminX is a member of orgX only; point the selection at orgY.
    await db.execute(sql`
      UPDATE "user" SET selected_organisation_id = ${orgY} WHERE user_id = ${adminX}
    `);
    expect(await resolveActiveOrg(adminX)).toBe(orgX);
    await db.execute(sql`
      UPDATE "user" SET selected_organisation_id = NULL WHERE user_id = ${adminX}
    `);
  });

  it("resolveActiveOrg: a user with no memberships resolves to null", async () => {
    const { resolveActiveOrg } = await import("./activeOrgService.js");
    expect(await resolveActiveOrg(noOrgUser)).toBeNull();
  });

  it("listMemories: tenant boundary + scope filter", async () => {
    const { listMemories } = await import("./brainService.js");

    // userY sees the org-Y shared memory.
    const yAll = await listMemories(userY);
    expect(yAll.memories.some((m) => m.title === "Kitchen Y waste rule")).toBe(true);

    // userX (org-X) never sees org-Y's shared memory.
    const xAll = await listMemories(userX);
    expect(xAll.memories.some((m) => m.title === "Kitchen Y waste rule")).toBe(false);

    // scope='user' filter hides the org row from userY.
    const yUserOnly = await listMemories(userY, { scope: "user" });
    expect(yUserOnly.memories.some((m) => m.title === "Kitchen Y waste rule")).toBe(false);
  });

  it("deleteMemory: only an admin of the OWNING org can delete a shared memory", async () => {
    const { recordMemory } = await import("./brainCaptureService.js");
    const { deleteMemory } = await import("./brainService.js");

    nextEmbedding = fakeVector(8);
    await recordMemory({
      userId: adminY,
      organisationId: orgY,
      scope: "org",
      sourceType: "menu",
      sourceRef: "orgY-del-1",
      title: "Deletable org memo",
      rawContent: "Cook logged: swap the winter garnish next week.",
    });
    const [seed] = (await db.execute(sql`
      SELECT memory_id FROM brain_memory
      WHERE organisation_id = ${orgY} AND source_ref = 'orgY-del-1'
    `)) as unknown as Array<{ memory_id: string }>;
    const memId = seed.memory_id;

    // Non-admin member of the owning org → refused.
    expect(await deleteMemory(userY, memId)).toBe(false);
    // Admin of a DIFFERENT org → refused.
    expect(await deleteMemory(adminX, memId)).toBe(false);
    // Admin of the owning org → allowed.
    expect(await deleteMemory(adminY, memId)).toBe(true);

    const [gone] = (await db.execute(sql`
      SELECT count(*)::int AS n FROM brain_memory WHERE memory_id = ${memId}
    `)) as unknown as Array<{ n: number }>;
    expect(gone.n).toBe(0);

    nextEmbedding = fakeVector(0);
  });

  it("correctMemory: an admin corrects a colleague's shared memory → re-queued; a member is refused (T14c)", async () => {
    const { recordMemory } = await import("./brainCaptureService.js");
    const { correctMemory } = await import("./brainService.js");

    nextEmbedding = fakeVector(9);
    await recordMemory({
      userId: adminY,
      organisationId: orgY,
      scope: "org",
      sourceType: "menu",
      sourceRef: "orgY-correct-1",
      title: "Correctable org memo",
      rawContent: "Cook logged: plate the terrine colder.",
    });
    const [seed] = (await db.execute(sql`
      SELECT memory_id FROM brain_memory
      WHERE organisation_id = ${orgY} AND source_ref = 'orgY-correct-1'
    `)) as unknown as Array<{ memory_id: string }>;
    const memId = seed.memory_id;

    // A non-admin member of the owning org cannot correct a colleague's memory.
    expect(await correctMemory(userY, memId, "member tries to rewrite")).toBe(false);
    // An admin of a DIFFERENT org cannot either.
    expect(await correctMemory(adminX, memId, "cross-org admin tries")).toBe(false);
    // The owning org's admin can — and the row re-enters the embed queue.
    expect(await correctMemory(adminY, memId, "Admin correction: plate at 4C.")).toBe(true);

    const [row] = (await db.execute(sql`
      SELECT body, status, (embedding IS NULL) AS embed_cleared
      FROM brain_memory WHERE memory_id = ${memId}
    `)) as unknown as Array<{ body: string; status: string; embed_cleared: boolean }>;
    expect(row.body).toContain("plate at 4C");
    expect(row.status).toBe("pending");
    expect(row.embed_cleared).toBe(true);

    nextEmbedding = fakeVector(0);
  });

  it("listMemories: canManage + authorName reflect role and live authorship (T14c)", async () => {
    const { recordMemory } = await import("./brainCaptureService.js");
    const { listMemories } = await import("./brainService.js");

    // Make exUser a non-member of orgY, then author a shared memory as them:
    // attribution must read "Former team member" (self-contained, order-independent).
    await db.execute(
      sql`DELETE FROM user_organisation WHERE user_id = ${exUser} AND organisation_id = ${orgY}`,
    );
    nextEmbedding = fakeVector(10);
    await recordMemory({
      userId: exUser,
      organisationId: orgY,
      scope: "org",
      sourceType: "menu",
      sourceRef: "orgY-attrib-1",
      title: "Departed author memo",
      rawContent: "Cook logged: the old winter menu note.",
    });

    // adminY (owning-org admin) can manage org rows; the memo shows the departed author.
    const asAdmin = await listMemories(adminY, { scope: "org" });
    const memo = asAdmin.memories.find((m) => m.title === "Departed author memo");
    expect(memo).toBeDefined();
    expect(memo!.canManage).toBe(true);
    expect(memo!.authorName).toBe("Former team member");

    // userY (member, not admin) sees the same shared row but cannot manage it.
    const asMember = await listMemories(userY, { scope: "org" });
    const memoAsMember = asMember.memories.find((m) => m.title === "Departed author memo");
    expect(memoAsMember).toBeDefined();
    expect(memoAsMember!.canManage).toBe(false);

    // A user's own private rows carry no author attribution.
    const xPrivate = await listMemories(userX, { scope: "user" });
    expect(xPrivate.memories.every((m) => m.authorName === null)).toBe(true);

    nextEmbedding = fakeVector(0);
  });

  it("T12 OPS CAPTURE canary: adminY logs waste (org) → embedded → colleague userY recalls it; userX (org X) does not", async () => {
    const { recordOpsEvent } = await import("./brainCaptureService.js");
    const { runBrainWorkerTick } = await import("./brainWorker.js");
    const { recallMemories } = await import("./brainRecallService.js");

    // adminY logs a waste ops event for org Y — the first true "kitchen memory".
    nextEmbedding = fakeVector(50);
    await recordOpsEvent({
      userId: adminY,
      sourceType: "waste",
      scope: "org",
      organisationId: orgY,
      sourceRef: `waste-t12-${randomUUID()}`,
      title: "Waste: duck confit",
      ingredientName: "duck confit",
      quantity: "2.5",
      unit: "kg",
      estimatedCost: "38.00",
      reason: "over-prep",
    });
    const tick = await runBrainWorkerTick();
    expect(tick.claimed).toBeGreaterThanOrEqual(1);

    // Colleague userY (same org, active org = Y) recalls what adminY did.
    nextEmbedding = fakeVector(50);
    const recallY = await recallMemories(userY, "how much duck confit did we waste?", orgY);
    expect(recallY).not.toBeNull();
    expect(recallY!.block).toContain("duck confit");
    expect(recallY!.block).toContain("Waste logged");

    // Isolation: userX (org X) never sees org Y's waste memory, even with the
    // identical topic vector.
    nextEmbedding = fakeVector(50);
    const recallX = await recallMemories(userX, "duck confit waste", orgX);
    if (recallX !== null) {
      expect(recallX.block).not.toContain("duck confit");
    }

    nextEmbedding = fakeVector(0);
  });

  it("T14b pin: owner pins own memory (sorts first); a non-owner cannot", async () => {
    const { recordMemory } = await import("./brainCaptureService.js");
    const { runBrainWorkerTick } = await import("./brainWorker.js");
    const { pinMemory, listMemories } = await import("./brainService.js");

    nextEmbedding = fakeVector(60);
    await recordMemory({ userId: userX, sourceType: "chat", title: "X pin target", rawContent: "a memory to pin" });
    await runBrainWorkerTick();
    const [row] = (await db.execute(sql`
      SELECT memory_id FROM brain_memory WHERE user_id = ${userX} AND title = 'X pin target'
    `)) as unknown as Array<{ memory_id: string }>;

    expect(await pinMemory(userY, row.memory_id, true)).toBe(false); // non-owner denied
    expect(await pinMemory(userX, row.memory_id, true)).toBe(true); // owner allowed

    const listed = await listMemories(userX);
    expect(listed.memories[0].memoryId).toBe(row.memory_id); // pinned sorts first
    expect(listed.memories[0].isPinned).toBe(true);
  });

  it("T14b correct: editing the body clears the embedding and re-embeds (pending → ready)", async () => {
    const { recordMemory } = await import("./brainCaptureService.js");
    const { runBrainWorkerTick } = await import("./brainWorker.js");
    const { correctMemory } = await import("./brainService.js");

    nextEmbedding = fakeVector(61);
    await recordMemory({ userId: userX, sourceType: "chat", title: "X correct target", rawContent: "original body" });
    await runBrainWorkerTick();
    const [row] = (await db.execute(sql`
      SELECT memory_id FROM brain_memory WHERE user_id = ${userX} AND title = 'X correct target'
    `)) as unknown as Array<{ memory_id: string }>;

    expect(await correctMemory(userX, row.memory_id, "corrected body text")).toBe(true);
    const [after] = (await db.execute(sql`
      SELECT body, status, (embedding IS NULL) AS cleared FROM brain_memory WHERE memory_id = ${row.memory_id}
    `)) as unknown as Array<{ body: string; status: string; cleared: boolean }>;
    expect(after.body).toContain("corrected body");
    expect(after.status).toBe("pending");
    expect(after.cleared).toBe(true);

    nextEmbedding = fakeVector(61);
    await runBrainWorkerTick();
    const [ready] = (await db.execute(sql`
      SELECT status, (embedding IS NOT NULL) AS embedded FROM brain_memory WHERE memory_id = ${row.memory_id}
    `)) as unknown as Array<{ status: string; embedded: boolean }>;
    expect(ready.status).toBe("ready");
    expect(ready.embedded).toBe(true);
  });

  it("T14b scope: sharing a private memory makes a colleague see it; only an org-admin un-shares", async () => {
    const { recordMemory } = await import("./brainCaptureService.js");
    const { runBrainWorkerTick } = await import("./brainWorker.js");
    const { toggleScope, listMemories } = await import("./brainService.js");

    nextEmbedding = fakeVector(62);
    await recordMemory({ userId: userY, sourceType: "chat", title: "Y private tip", rawContent: "prefer gluten-free on Tuesdays" });
    await runBrainWorkerTick();
    const [row] = (await db.execute(sql`
      SELECT memory_id FROM brain_memory WHERE user_id = ${userY} AND title = 'Y private tip'
    `)) as unknown as Array<{ memory_id: string }>;

    // Share (user → org): userY's active org resolves to orgY.
    expect(await toggleScope(userY, row.memory_id, "org")).toBe(true);
    const [shared] = (await db.execute(sql`
      SELECT scope, organisation_id FROM brain_memory WHERE memory_id = ${row.memory_id}
    `)) as unknown as Array<{ scope: string; organisation_id: number }>;
    expect(shared.scope).toBe("org");
    expect(shared.organisation_id).toBe(orgY);
    // A colleague (adminY) now sees it in their list.
    const adminList = await listMemories(adminY);
    expect(adminList.memories.some((m) => m.memoryId === row.memory_id)).toBe(true);

    // Un-share (org → user): the owner is only a MEMBER of orgY, so cannot; the org-admin can.
    expect(await toggleScope(userY, row.memory_id, "user")).toBe(false);
    expect(await toggleScope(adminY, row.memory_id, "user")).toBe(true);
    const [unshared] = (await db.execute(sql`
      SELECT scope, organisation_id FROM brain_memory WHERE memory_id = ${row.memory_id}
    `)) as unknown as Array<{ scope: string; organisation_id: number | null }>;
    expect(unshared.scope).toBe("user");
    expect(unshared.organisation_id).toBeNull();
  });
});
