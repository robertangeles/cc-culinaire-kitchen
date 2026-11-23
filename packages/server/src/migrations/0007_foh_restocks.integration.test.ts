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

/** Migration 0007 (Wave 3 store room and bar): a new table, idempotent, applied by hand before the deploy. Gated on TENANT_IT=1. */
const RUN = process.env.TENANT_IT === "1";

describe("migration 0007", () => {
  it("is registered, last", () => {
    expect(migrations.at(-1)?.id).toBe("0007_foh_restocks");
  });
});

describe.skipIf(!RUN)("migration 0007 (real DB)", () => {
  it("can run twice and leaves the table with an index on every foreign key", async () => {
    const m = migrations.find((x) => x.id === "0007_foh_restocks")!;
    for (let i = 0; i < 2; i++) for (const s of m.statements) await db.execute(sql.raw(s));

    const idx = (await db.execute(sql`SELECT indexname FROM pg_indexes WHERE tablename = 'foh_restocks' ORDER BY indexname`)) as unknown as Array<{
      indexname: string;
    }>;
    expect(idx.map((i) => i.indexname)).toEqual(
      expect.arrayContaining([
        "idx_foh_restocks_ingredient_id",
        "idx_foh_restocks_organisation_id",
        "idx_foh_restocks_store_location_id",
        "idx_foh_restocks_user_id",
      ]),
    );
  });
});
