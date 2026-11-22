import { describe, it, expect, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { assertOrdered, pendingMigrations, runMigrations, appliedMigrationIds, type Migration } from "./runner.js";
import { migrations } from "./index.js";

/**
 * The migration runner against a real database, using its own scratch table and test ids (9xxx sort after
 * every real migration), all removed afterwards. The ordering checks need no database.
 * The real-DB part is gated on TENANT_IT=1.
 */
const RUN = process.env.TENANT_IT === "1";

const make = (n: number, statements: string[]): Migration => ({
  id: `9${String(n).padStart(3, "0")}_runner_test_${n}`,
  description: `test ${n}`,
  statements,
});

describe("assertOrdered", () => {
  it("accepts the real migration list", () => {
    expect(() => assertOrdered(migrations)).not.toThrow();
  });

  it("rejects a malformed id, a duplicate and a list out of order", () => {
    expect(() => assertOrdered([{ id: "1_x", description: "", statements: [] }])).toThrow(/0001_snake_case/);
    expect(() => assertOrdered([make(1, []), make(1, [])])).toThrow(/Duplicate/);
    expect(() => assertOrdered([make(2, []), make(1, [])])).toThrow(/ascending/);
  });
});

describe("reading the ledger", () => {
  it("does not create it: a database that was never migrated reports nothing applied", async () => {
    const statements: string[] = [];
    const neverMigrated = {
      execute: async (query: { queryChunks: Array<{ value?: string[] }> }) => {
        statements.push(query.queryChunks.flatMap((c) => c.value ?? []).join(""));
        return [{ present: false }];
      },
    };
    expect(await appliedMigrationIds(neverMigrated as never)).toEqual([]);
    expect(statements).toHaveLength(1);
    expect(statements[0]).not.toMatch(/CREATE/i);
  });
});

describe.skipIf(!RUN)("runMigrations (real DB)", () => {
  const scratch = `migration_runner_scratch_${Date.now().toString(36)}`;
  const first = make(1, [`CREATE TABLE IF NOT EXISTS ${scratch} (id int)`, `INSERT INTO ${scratch} VALUES (1)`]);
  const second = make(2, [`ALTER TABLE ${scratch} ADD COLUMN IF NOT EXISTS note text`]);

  afterAll(async () => {
    await db.execute(sql.raw(`DROP TABLE IF EXISTS ${scratch}`));
    await db.execute(sql`DELETE FROM schema_migrations WHERE migration_id LIKE '9___\\_runner\\_test\\_%'`);
  });

  it("applies pending migrations in order and records them", async () => {
    const applied = await runMigrations(db, [first, second]);

    expect(applied).toEqual([first.id, second.id]);
    expect(await appliedMigrationIds(db)).toEqual(expect.arrayContaining([first.id, second.id]));
  });

  it("applies nothing the second time", async () => {
    expect(await runMigrations(db, [first, second])).toEqual([]);
    const rows = (await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${scratch}`))) as unknown as Array<{ n: number }>;
    expect(rows[0].n).toBe(1);
  });

  it("a dry run reports what is pending and changes nothing", async () => {
    const third = make(3, [`INSERT INTO ${scratch} VALUES (3)`]);
    expect((await pendingMigrations(db, [first, second, third])).map((m) => m.id)).toEqual([third.id]);
    expect(await runMigrations(db, [first, second, third], { dryRun: true })).toEqual([third.id]);
    expect(await appliedMigrationIds(db)).not.toContain(third.id);
  });

  it("rolls a failing migration back and does not record it", async () => {
    const bad = make(3, [`INSERT INTO ${scratch} VALUES (3)`, `SELECT * FROM table_that_does_not_exist`]);

    await expect(runMigrations(db, [first, second, bad])).rejects.toThrow();

    expect(await appliedMigrationIds(db)).not.toContain(bad.id);
    const rows = (await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${scratch} WHERE id = 3`))) as unknown as Array<{ n: number }>;
    expect(rows[0].n).toBe(0);
  });
});
