/**
 * @module scripts/backfillMenuItemOrganisation
 *
 * Gives every menu item without an organisation its creator's primary organisation (migration 0006 did this once;
 * the previous server version keeps creating NULL rows until the new one is live). Idempotent: only NULL rows change.
 *
 * Run once after the Wave 7 server deploys (APP_ENV=prod selects the production database):
 *   pnpm --filter @culinaire/server exec tsx src/scripts/backfillMenuItemOrganisation.ts
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { BACKFILL_MENU_ITEM_ORGANISATION } from "../migrations/0006_menu_item_organisation.js";

async function main(): Promise<void> {
  const result = (await db.execute(sql.raw(BACKFILL_MENU_ITEM_ORGANISATION))) as unknown as { count: number };
  const left = (await db.execute(sql`SELECT count(*)::int AS n FROM menu_item WHERE organisation_id IS NULL`)) as unknown as Array<{ n: number }>;
  console.log(`Menu item organisation backfill: ${result.count} rows set; ${left[0].n} still without one (creators with no organisation).`);
}

if (process.argv[1]?.endsWith("backfillMenuItemOrganisation.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Menu item organisation backfill failed:", err);
      process.exit(1);
    });
}
