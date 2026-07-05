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
