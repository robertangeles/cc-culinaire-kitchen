import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { migrations } from "./index.js";

/** Migration 0009 (Bench blocks, reports and moderation): new tables and a permission, idempotent, applied by hand before the deploy. Gated on TENANT_IT=1. */
const RUN = process.env.TENANT_IT === "1";

describe("migration 0009", () => {
  it("is registered", () => {
    expect(migrations.some((m) => m.id === "0009_bench_safety")).toBe(true);
  });
});

describe.skipIf(!RUN)("migration 0009 (real DB)", () => {
  it("can run twice and leaves an index on every foreign key, and the permission once", async () => {
    const m = migrations.find((x) => x.id === "0009_bench_safety")!;
    for (let i = 0; i < 2; i++) for (const s of m.statements) await db.execute(sql.raw(s));

    const idx = (await db.execute(
      sql`SELECT indexname FROM pg_indexes WHERE tablename IN ('bench_blocks', 'bench_reports', 'bench_report_actions') ORDER BY indexname`,
    )) as unknown as Array<{ indexname: string }>;
    expect(idx.map((i) => i.indexname)).toEqual(
      expect.arrayContaining([
        "idx_bench_blocks_pair",
        "idx_bench_blocks_blocked_user_id",
        "idx_bench_reports_user_id",
        "idx_bench_reports_reported_user_id",
        "idx_bench_reports_message_id",
        "idx_bench_reports_open",
        "idx_bench_report_actions_report_id",
        "idx_bench_report_actions_user_id",
      ]),
    );
    const perms = (await db.execute(sql`SELECT count(*)::int AS n FROM permission WHERE permission_key = 'bench:moderate'`)) as unknown as Array<{ n: number }>;
    expect(perms[0].n).toBe(1);
  });
});
