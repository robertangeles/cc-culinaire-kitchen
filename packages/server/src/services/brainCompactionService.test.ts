import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

// Stub the LLM summariser — deterministic digest, no provider call.
vi.mock("./brainDistillService.js", () => ({
  summarizeMemories: vi.fn(async (bodies: string[]) =>
    bodies.length ? "Digest: merged older kitchen notes." : null,
  ),
}));

const { sql } = await import("drizzle-orm");
const { db } = await import("../db/index.js");
const { compactAll } = await import("./brainCompactionService.js");
const { listMemories } = await import("./brainService.js");

const dbAvailable = await (async () => {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
})();
if (!dbAvailable) {
  console.warn("brainCompactionService.test.ts: no local database reachable — suite skipped");
}

// cap=10 with a 12-memory test user: only THIS user is over-cap, so compactAll's
// global pass can't touch the tiny baseline dev tenants (all well under 10).
describe.runIf(dbAvailable)("brainCompactionService (T16, real DB)", () => {
  let userId = 0;
  const flagBackup: Record<string, string> = {};

  beforeAll(async () => {
    const { getAllSettings, upsertSettings } = await import("./settingsService.js");
    const s = await getAllSettings();
    for (const k of ["brain_enabled", "brain_compaction_enabled", "brain_compaction_cap"]) {
      flagBackup[k] = s[k] ?? "false";
    }

    const [u] = (await db.execute(sql`
      INSERT INTO "user" (user_name, user_email)
      VALUES ('Compact user', ${`cmp-${randomUUID()}@test.local`})
      RETURNING user_id
    `)) as unknown as Array<{ user_id: number }>;
    userId = u.user_id;

    // 12 ready user-scope events; g=1,2 are never-recalled (coldest), rest have a
    // recency stamp so ordering is deterministic.
    await db.execute(sql`
      INSERT INTO brain_memory (user_id, scope, source_type, body, status, last_recalled_dttm, created_dttm)
      SELECT ${userId}, 'user', 'chat', 'mem ' || g, 'ready',
        CASE WHEN g <= 2 THEN NULL ELSE now() - (g || ' days')::interval END,
        now() - (g || ' days')::interval
      FROM generate_series(1, 12) g
    `);
  });

  afterAll(async () => {
    const { upsertSettings } = await import("./settingsService.js");
    await upsertSettings(flagBackup);
    if (userId) {
      await db.execute(sql`DELETE FROM brain_memory WHERE user_id = ${userId}`);
      await db.execute(sql`DELETE FROM "user" WHERE user_id = ${userId}`);
    }
  });

  it("no-op when disabled or cap <= 0", async () => {
    const { upsertSettings } = await import("./settingsService.js");
    await upsertSettings({
      brain_enabled: "true",
      brain_compaction_enabled: "false",
      brain_compaction_cap: "10",
    });
    expect((await compactAll()).groups).toBe(0);

    await upsertSettings({ brain_compaction_enabled: "true", brain_compaction_cap: "0" });
    expect((await compactAll()).groups).toBe(0);
  });

  it("folds the coldest excess into a digest and soft-archives them (cap=10)", async () => {
    const { upsertSettings } = await import("./settingsService.js");
    await upsertSettings({
      brain_enabled: "true",
      brain_compaction_enabled: "true",
      brain_compaction_cap: "10",
    });

    // 12 memories, cap 10 → excess 2 → the 2 never-recalled (mem 1, mem 2) compact.
    const res = await compactAll();
    expect(res.digests).toBeGreaterThanOrEqual(1);
    expect(res.archived).toBeGreaterThanOrEqual(2);

    const [{ archived }] = (await db.execute(sql`
      SELECT count(*)::int AS archived FROM brain_memory WHERE user_id = ${userId} AND status = 'archived'
    `)) as unknown as Array<{ archived: number }>;
    expect(archived).toBe(2);

    const [{ digests }] = (await db.execute(sql`
      SELECT count(*)::int AS digests FROM brain_memory WHERE user_id = ${userId} AND memory_kind = 'digest'
    `)) as unknown as Array<{ digests: number }>;
    expect(digests).toBe(1);

    // The archived originals are the coldest (never-recalled) ones …
    const [{ n }] = (await db.execute(sql`
      SELECT count(*)::int AS n FROM brain_memory
      WHERE user_id = ${userId} AND status = 'archived' AND body IN ('mem 1', 'mem 2')
    `)) as unknown as Array<{ n: number }>;
    expect(n).toBe(2);

    // … and Your Brain hides archived originals (the digest shows instead).
    const list = await listMemories(userId, { scope: "user" });
    expect(list.memories.some((m) => m.body === "mem 1")).toBe(false);
    expect(list.memories.some((m) => m.body.startsWith("Digest:"))).toBe(true);
  });
});
