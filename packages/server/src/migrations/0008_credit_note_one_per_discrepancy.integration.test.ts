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

/** Migration 0008 (one credit note per discrepancy): idempotent, applied by hand before the deploy. Gated on TENANT_IT=1. */
const RUN = process.env.TENANT_IT === "1";
const m = () => migrations.find((x) => x.id === "0008_credit_note_one_per_discrepancy")!;

describe("migration 0008", () => {
  it("is registered, in order", () => {
    expect(m()).toBeDefined();
    expect(migrations.map((x) => x.id)).toEqual([...migrations.map((x) => x.id)].sort());
  });
});

describe.skipIf(!RUN)("migration 0008 (real DB)", () => {
  const indexes = async () =>
    ((await db.execute(sql`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'credit_note' AND indexname IN ('uq_credit_note_discrepancy', 'idx_credit_discrepancy')`)) as unknown as Array<{
      indexname: string;
      indexdef: string;
    }>);

  it("can run twice and leaves one unique index on discrepancy_id", async () => {
    for (let i = 0; i < 2; i++) for (const s of m().statements) await db.execute(sql.raw(s));
    const idx = await indexes();
    expect(idx.map((i) => i.indexname)).toEqual(["uq_credit_note_discrepancy"]);
    expect(idx[0].indexdef).toMatch(/UNIQUE/);
  });

  it("stops, changing nothing, when a discrepancy already has two notes", async () => {
    // A scratch copy of the table, so the real one is never touched: the guard reads credit_note by name.
    await db.transaction(async (tx) => {
      await tx.execute(sql`CREATE TEMP TABLE credit_note (discrepancy_id uuid) ON COMMIT DROP`);
      await tx.execute(sql`INSERT INTO credit_note VALUES ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000001')`);
      await expect(tx.execute(sql.raw(m().statements[0]))).rejects.toThrow(/more than one note/);
    }).catch((e: Error) => {
      // The failed statement aborts the transaction; only the expected refusal may surface here.
      if (!/more than one note|current transaction is aborted/.test(e.message)) throw e;
    });
    expect((await indexes()).map((i) => i.indexname)).toEqual(["uq_credit_note_discrepancy"]);
  });
});
