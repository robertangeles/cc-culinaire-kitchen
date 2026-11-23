import type { Migration } from "./runner.js";

/**
 * Wave 3 (store room and bar): a row per front-of-house restock, keyed by the id the client made, so a phone
 * that resends "stock the fridge" moves the stock once. Run BEFORE the server version that writes it deploys.
 * The previous server version keeps working afterwards: it never reads or writes this table.
 */
export const migration: Migration = {
  id: "0007_foh_restocks",
  description: "foh_restocks: one row per back-of-house to front-of-house restock (replay guard and audit trail)",
  statements: [
    `CREATE TABLE IF NOT EXISTS "foh_restocks" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "organisation_id" integer NOT NULL REFERENCES "organisation"("organisation_id"),
      "store_location_id" uuid NOT NULL REFERENCES "store_location"("store_location_id"),
      "ingredient_id" uuid NOT NULL REFERENCES "ingredient"("ingredient_id"),
      "user_id" integer NOT NULL REFERENCES "user"("user_id"),
      "quantity" numeric(12, 3) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )`,
    // FK index: "restocks at this location, newest first" (FOH history), and the location FK check.
    `CREATE INDEX IF NOT EXISTS "idx_foh_restocks_store_location_id" ON "foh_restocks" ("store_location_id", "created_at")`,
    // FK index: the constraint check when an organisation row is deleted.
    `CREATE INDEX IF NOT EXISTS "idx_foh_restocks_organisation_id" ON "foh_restocks" ("organisation_id")`,
    // FK index: "restocks of one item", and the constraint check when that ingredient row is deleted.
    `CREATE INDEX IF NOT EXISTS "idx_foh_restocks_ingredient_id" ON "foh_restocks" ("ingredient_id")`,
    // FK index: "restocks by one user", and the constraint check when that user row is deleted.
    `CREATE INDEX IF NOT EXISTS "idx_foh_restocks_user_id" ON "foh_restocks" ("user_id")`,
  ],
};
