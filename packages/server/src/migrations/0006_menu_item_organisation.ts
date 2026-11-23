import type { Migration } from "./runner.js";

// The creator's primary organisation is their earliest membership, the same rule getUserLocationContext uses. Only NULL rows are touched, so a re-run changes nothing.
export const BACKFILL_MENU_ITEM_ORGANISATION = `UPDATE "menu_item" SET "organisation_id" = (
       SELECT uo."organisation_id" FROM "user_organisation" uo
       WHERE uo."user_id" = "menu_item"."user_id" ORDER BY uo."user_organisation_id" ASC LIMIT 1
     ) WHERE "organisation_id" IS NULL`;

/**
 * Menu items belong to the organisation (Wave 7). Run BEFORE the server version that reads this column deploys.
 * The previous server version keeps working afterwards: both columns are nullable, and nothing there reads or writes them.
 * Rows that version creates between this migration and the new deploy stay NULL; run
 * `tsx src/scripts/backfillMenuItemOrganisation.ts` once after the deploy to claim them (the new server also keeps
 * showing a NULL row to its creator in the meantime).
 */
export const migration: Migration = {
  id: "0006_menu_item_organisation",
  description: "menu_item.organisation_id, its index, a backfill from each creator's earliest organisation membership, and consumption_log.zone",
  statements: [
    `ALTER TABLE "menu_item" ADD COLUMN IF NOT EXISTS "organisation_id" integer REFERENCES "organisation"("organisation_id")`,
    // "All menu items of one organisation, by category": the list, analysis and sale lookups, and the FK check when an organisation row is deleted.
    `CREATE INDEX IF NOT EXISTS "idx_menu_item_organisation" ON "menu_item" ("organisation_id")`,
    BACKFILL_MENU_ITEM_ORGANISATION,
    // The zone a sale took stock from. Existing rows stay NULL: a void of those falls back to the ingredient's item type.
    `ALTER TABLE "consumption_log" ADD COLUMN IF NOT EXISTS "zone" varchar(3)`,
  ],
};
