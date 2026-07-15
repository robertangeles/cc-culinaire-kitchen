/**
 * @module scripts/backfillKitchenUnits
 *
 * One-time rollout helper for the kitchen-unit model.
 *
 * Wine-class items were created with base_unit='ml' + pack_qty=<bottle ml> —
 * which made stock takes read "500 mL". Their KITCHEN unit (what you actually
 * count in the cellar) is the BOTTLE. For every spirits-category item with a
 * volume base unit and a bottle-size pack_qty, this script:
 *   1. records the content equivalence (1 bottle = <pack_qty> ml),
 *   2. flips base_unit → 'bottle' via changeKitchenUnit (stock ÷ pack_qty,
 *      per-unit costs × pack_qty, FIFO batches + pars converted atomically),
 *   3. clears pack_qty/purchase_unit (bought by the bottle until cases are
 *      configured per item).
 *
 * Idempotent: a flipped item has base_unit='bottle' and is skipped on re-run.
 *
 * Run once per environment:
 *   pnpm --filter @culinaire/server exec tsx src/scripts/backfillKitchenUnits.ts
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

import { and, eq, isNotNull, sql, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { ingredient } from "../db/schema.js";
import { changeKitchenUnit } from "../services/ingredientService.js";

async function main(): Promise<void> {
  // Wine-class candidates: spirits category, volume base, bottle-size pack.
  const candidates = await db
    .select({
      ingredientId: ingredient.ingredientId,
      organisationId: ingredient.organisationId,
      ingredientName: ingredient.ingredientName,
      baseUnit: ingredient.baseUnit,
      packQty: ingredient.packQty,
    })
    .from(ingredient)
    .where(
      and(
        eq(ingredient.ingredientCategory, "spirits"),
        inArray(sql`lower(${ingredient.baseUnit})`, ["ml", "mL".toLowerCase()]),
        isNotNull(ingredient.packQty),
      ),
    );

  let flipped = 0;
  for (const c of candidates) {
    const bottleMl = Number(c.packQty);
    // Sanity: only plausible bottle sizes (a 187 ml split up to a 3 L jeroboam).
    if (!(bottleMl >= 100 && bottleMl <= 3000)) {
      console.log(`SKIP ${c.ingredientName}: pack_qty ${bottleMl} is not a plausible bottle size`);
      continue;
    }
    // 1. Content equivalence FIRST (1 bottle = <bottleMl> ml).
    await db
      .update(ingredient)
      .set({ contentQty: String(bottleMl), contentUnit: "ml", updatedDttm: new Date() })
      .where(eq(ingredient.ingredientId, c.ingredientId));
    // 2. Flip the kitchen unit (converts stock/costs/pars/FIFO atomically).
    await changeKitchenUnit(c.ingredientId, c.organisationId, "bottle", bottleMl);
    // 3. Bought by the bottle until a case is configured per item.
    await db
      .update(ingredient)
      .set({ packQty: null, purchaseUnit: null, updatedDttm: new Date() })
      .where(eq(ingredient.ingredientId, c.ingredientId));
    console.log(`FLIPPED ${c.ingredientName}: bottle (1 bottle = ${bottleMl} ml)`);
    flipped++;
  }

  console.log(`Kitchen-unit backfill complete: ${candidates.length} candidates, ${flipped} flipped.`);
}

// Auto-run only when invoked directly (not when imported by a test).
if (process.argv[1]?.endsWith("backfillKitchenUnits.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Kitchen-unit backfill failed:", err);
      process.exit(1);
    });
}
