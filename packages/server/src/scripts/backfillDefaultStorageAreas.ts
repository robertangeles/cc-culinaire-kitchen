/**
 * @module scripts/backfillDefaultStorageAreas
 *
 * One-time rollout helper for default storage areas.
 *
 * `seedDefaultAreas` now runs on every new location (createStoreLocation), but
 * locations created before that change have no areas. This seeds the default
 * count-sheet areas (Dry Storage, Cool Room, Freezer, FOH / Counter) into every
 * existing location that has ZERO areas. Locations where an operator has already
 * created areas are left untouched — we never clobber their setup.
 *
 * Idempotent: re-running only seeds locations still at zero areas.
 *
 * Run once (safe to run anytime after this change deploys):
 *   pnpm --filter @culinaire/server exec tsx src/scripts/backfillDefaultStorageAreas.ts
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

import { eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { storeLocation, storageArea } from "../db/schema.js";
import { seedDefaultAreas, DEFAULT_AREA_NAMES } from "../services/storageAreaService.js";

async function main(): Promise<void> {
  // Left join + null area id = exactly the locations with no areas (one row each,
  // since there are no matching area rows to fan out on). No N+1 count-per-location.
  const areaLess = await db
    .select({
      id: storeLocation.storeLocationId,
      orgId: storeLocation.organisationId,
    })
    .from(storeLocation)
    .leftJoin(storageArea, eq(storageArea.storeLocationId, storeLocation.storeLocationId))
    .where(isNull(storageArea.storageAreaId));

  if (areaLess.length === 0) {
    console.log("No area-less locations — nothing to backfill.");
    process.exit(0);
  }

  let seeded = 0;
  for (const loc of areaLess) {
    // Per-location transaction so a mid-run failure leaves each location either
    // fully seeded or untouched — never half a default set.
    await db.transaction(async (tx) => {
      await seedDefaultAreas(loc.id, loc.orgId, tx);
    });
    seeded++;
    console.log(`  seeded ${DEFAULT_AREA_NAMES.length} areas -> location ${loc.id}`);
  }

  console.log(`Done. Seeded default areas into ${seeded} location(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
