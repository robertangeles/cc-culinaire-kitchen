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

/** Migration 0010 (receiving extras): nullable columns, idempotent, applied by hand before the deploy. Gated on TENANT_IT=1. */
const RUN = process.env.TENANT_IT === "1";
const m = () => migrations.find((x) => x.id === "0010_receiving_extras")!;

describe("migration 0010", () => {
  it("is registered, in order", () => {
    expect(m()).toBeDefined();
    expect(migrations.map((x) => x.id)).toEqual([...migrations.map((x) => x.id)].sort());
  });
});

describe.skipIf(!RUN)("migration 0010 (real DB)", () => {
  it("can run twice and leaves the four columns nullable, with their types", async () => {
    for (let i = 0; i < 2; i++) for (const s of m().statements) await db.execute(sql.raw(s));

    const cols = (await db.execute(sql`
      SELECT table_name, column_name, data_type, character_maximum_length, is_nullable FROM information_schema.columns
      WHERE (table_name = 'receiving_line' AND column_name IN ('expiry_date', 'lot_number'))
         OR (table_name = 'fifo_batch' AND column_name = 'lot_number')
         OR (table_name = 'receiving_session' AND column_name = 'docket_number')
      ORDER BY table_name, column_name`)) as unknown as Array<{
      table_name: string;
      column_name: string;
      data_type: string;
      character_maximum_length: number | null;
      is_nullable: string;
    }>;
    expect(cols.map((c) => `${c.table_name}.${c.column_name}:${c.data_type}:${c.character_maximum_length ?? ""}`)).toEqual([
      "fifo_batch.lot_number:character varying:50",
      "receiving_line.expiry_date:date:",
      "receiving_line.lot_number:character varying:50",
      "receiving_session.docket_number:character varying:50",
    ]);
    expect(cols.every((c) => c.is_nullable === "YES")).toBe(true);
  });
});
