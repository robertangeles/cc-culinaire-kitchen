/**
 * Targeted, idempotent migration: add postal address columns to `supplier`.
 *
 * Why this script (rather than `drizzle-kit push`): per tasks/lessons.md #50,
 * push surfaces unrelated drift against this live DB. This applies ONLY the
 * six ADD COLUMN statements, mirroring organisation & store_location address
 * fields. Safe to re-run (IF NOT EXISTS).
 *
 * Usage: `npx tsx scripts/add-supplier-address.ts`
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

const stmts: string[] = [
  `ALTER TABLE "supplier"
     ADD COLUMN IF NOT EXISTS "address_line_1" varchar(200),
     ADD COLUMN IF NOT EXISTS "address_line_2" varchar(200),
     ADD COLUMN IF NOT EXISTS "suburb"         varchar(100),
     ADD COLUMN IF NOT EXISTS "state"          varchar(100),
     ADD COLUMN IF NOT EXISTS "country"        varchar(100),
     ADD COLUMN IF NOT EXISTS "postcode"       varchar(20);`,
];

try {
  await sql.begin(async (tx) => {
    for (const s of stmts) {
      console.log("→", s.replace(/\s+/g, " ").slice(0, 80), "…");
      await tx.unsafe(s);
    }
  });
  // Verify the columns now exist.
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'supplier'
      AND column_name IN ('address_line_1','address_line_2','suburb','state','country','postcode')
    ORDER BY column_name;
  `;
  console.log("\n✓ supplier address columns present:", cols.map((c) => c.column_name).join(", "));
} catch (err) {
  console.error("Apply failed:", err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
