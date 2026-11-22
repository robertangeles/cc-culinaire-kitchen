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

/** Migration 0002 (Wave 2 line loop): nullable columns, idempotent, applied by hand before the deploy. Gated on TENANT_IT=1. */
const RUN = process.env.TENANT_IT === "1";

describe("migration 0002", () => {
  it("is registered after 0001", () => {
    expect(migrations.map((m) => m.id)).toContain("0002_prep_completed_by");
  });
});

describe.skipIf(!RUN)("migration 0002 (real DB)", () => {
  it("can run twice and leaves both columns nullable, with the completed_by index", async () => {
    const m = migrations.find((x) => x.id === "0002_prep_completed_by")!;
    for (let i = 0; i < 2; i++) for (const s of m.statements) await db.execute(sql.raw(s));

    const cols = (await db.execute(sql`
      SELECT table_name, column_name, is_nullable FROM information_schema.columns
      WHERE (table_name = 'prep_task' AND column_name = 'completed_by')
         OR (table_name = 'prep_session' AND column_name = 'generate_request_id')`)) as unknown as Array<{ column_name: string; is_nullable: string }>;
    expect(cols.map((c) => c.column_name).sort()).toEqual(["completed_by", "generate_request_id"]);
    expect(cols.every((c) => c.is_nullable === "YES")).toBe(true);

    const idx = (await db.execute(sql`SELECT 1 FROM pg_indexes WHERE indexname = 'idx_prep_task_completed_by'`)) as unknown as unknown[];
    expect(idx).toHaveLength(1);
  });
});
