/**
 * @module db/migrations/add-store-locations
 *
 * Data migration: creates HQ store locations for existing orgs,
 * copies address data, backfills Kitchen Ops store_location_id,
 * and drops address columns from organisation table.
 *
 * Run: npx tsx src/db/migrations/add-store-locations.ts
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
// migrations/ → db/ → src/ → server/ → packages/ → repo root
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../.env") });

import postgres from "postgres";
import crypto from "crypto";

const sql = postgres(process.env.DATABASE_URL!);

function generateStoreKey(): string {
  return (
    "KITCHEN-" +
    crypto
      .randomBytes(9)
      .toString("base64url")
      .replace(/[^A-Z0-9]/gi, "")
      .slice(0, 12)
      .toUpperCase()
  );
}

async function migrate() {
  console.log("Starting store location migration...\n");

  // Phase 1: Check which orgs already have HQ locations
  const existingHQs = await sql`
    SELECT organisation_id FROM store_location WHERE classification = 'hq'
  `;
  const orgsWithHQ = new Set(existingHQs.map((r) => r.organisation_id));

  // Get all orgs
  const orgs = await sql`
    SELECT organisation_id, organisation_name,
           organisation_address_line1, organisation_address_line2,
           organisation_suburb, organisation_state,
           organisation_country, organisation_postcode,
           created_by
    FROM organisation
  `;

  console.log(`Found ${orgs.length} organisations, ${orgsWithHQ.size} already have HQ locations.`);

  // Phase 2: Create HQ for orgs that don't have one
  let created = 0;
  for (const org of orgs) {
    if (orgsWithHQ.has(org.organisation_id)) {
      console.log(`  [skip] Org #${org.organisation_id} "${org.organisation_name}" already has HQ`);
      continue;
    }

    const storeKey = generateStoreKey();
    const locationName = org.organisation_name
      ? `${org.organisation_name} HQ`
      : "Main Kitchen";

    await sql`
      INSERT INTO store_location (
        organisation_id, location_name, classification,
        address_line_1, address_line_2, suburb, state, country, postcode,
        store_key, created_by
      ) VALUES (
        ${org.organisation_id}, ${locationName}, 'hq',
        ${org.organisation_address_line1}, ${org.organisation_address_line2},
        ${org.organisation_suburb}, ${org.organisation_state},
        ${org.organisation_country}, ${org.organisation_postcode},
        ${storeKey}, ${org.created_by}
      )
    `;
    created++;
    console.log(`  [created] HQ for org #${org.organisation_id} "${org.organisation_name}" → key: ${storeKey}`);
  }
  console.log(`\nCreated ${created} HQ locations.\n`);

  // Phase 3: Backfill Kitchen Ops store_location_id
  // For each org, set all their Kitchen Ops data to point to the HQ
  const hqs = await sql`
    SELECT store_location_id, organisation_id FROM store_location WHERE classification = 'hq'
  `;

  for (const hq of hqs) {
    // Waste logs
    const wasteResult = await sql`
      UPDATE waste_log SET store_location_id = ${hq.store_location_id}
      WHERE organisation_id = ${hq.organisation_id}
        AND store_location_id IS NULL
    `;
    if (wasteResult.count > 0) {
      console.log(`  [backfill] ${wasteResult.count} waste logs → HQ of org #${hq.organisation_id}`);
    }

    // Prep sessions
    const prepResult = await sql`
      UPDATE prep_session SET store_location_id = ${hq.store_location_id}
      WHERE organisation_id = ${hq.organisation_id}
        AND store_location_id IS NULL
    `;
    if (prepResult.count > 0) {
      console.log(`  [backfill] ${prepResult.count} prep sessions → HQ of org #${hq.organisation_id}`);
    }
  }

  // Backfill menu items (no org_id on menu_item, so backfill via user → org → HQ)
  const menuBackfill = await sql`
    UPDATE menu_item mi
    SET store_location_id = sl.store_location_id
    FROM user_organisation uo
    JOIN store_location sl ON sl.organisation_id = uo.organisation_id AND sl.classification = 'hq'
    WHERE mi.user_id = uo.user_id
      AND mi.store_location_id IS NULL
  `;
  if (menuBackfill.count > 0) {
    console.log(`  [backfill] ${menuBackfill.count} menu items → HQ via user org membership`);
  }

  // Phase 4: Set selected_location_id for existing users to their org's HQ
  const userBackfill = await sql`
    UPDATE "user" u
    SET selected_location_id = sl.store_location_id
    FROM user_organisation uo
    JOIN store_location sl ON sl.organisation_id = uo.organisation_id AND sl.classification = 'hq'
    WHERE u.user_id = uo.user_id
      AND u.selected_location_id IS NULL
  `;
  console.log(`\n  [backfill] ${userBackfill.count} users → selected_location_id set to HQ`);

  console.log("\nMigration complete!");

  // Summary
  const locationCount = await sql`SELECT count(*)::int as c FROM store_location`;
  const nullWaste = await sql`SELECT count(*)::int as c FROM waste_log WHERE store_location_id IS NULL`;
  const nullPrep = await sql`SELECT count(*)::int as c FROM prep_session WHERE store_location_id IS NULL`;
  const nullMenu = await sql`SELECT count(*)::int as c FROM menu_item WHERE store_location_id IS NULL`;
  const nullUser = await sql`SELECT count(*)::int as c FROM "user" WHERE selected_location_id IS NULL AND user_id IN (SELECT user_id FROM user_organisation)`;

  console.log(`\n=== Summary ===`);
  console.log(`Total store locations: ${locationCount[0].c}`);
  console.log(`Waste logs missing location: ${nullWaste[0].c}`);
  console.log(`Prep sessions missing location: ${nullPrep[0].c}`);
  console.log(`Menu items missing location: ${nullMenu[0].c}`);
  console.log(`Org members missing selected_location: ${nullUser[0].c}`);

  await sql.end();
}

migrate().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
