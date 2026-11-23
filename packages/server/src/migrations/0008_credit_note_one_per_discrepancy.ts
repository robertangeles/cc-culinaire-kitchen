import type { Migration } from "./runner.js";

/**
 * One credit note per discrepancy. Run BEFORE the server version that relies on it deploys. The previous server keeps
 * working afterwards: it never means to write a second note for a discrepancy (it refuses a resolved one), so the only
 * insert the index refuses is the double-tap race it was letting through.
 *
 * Deletes nothing. If production already holds two notes for one discrepancy, the first statement stops the migration
 * (nothing is applied, nothing recorded) and names the problem; which note to keep is the owner's decision.
 * Check before applying:
 *   SELECT discrepancy_id, count(*) FROM credit_note GROUP BY discrepancy_id HAVING count(*) > 1;
 */
export const migration: Migration = {
  id: "0008_credit_note_one_per_discrepancy",
  description: "credit_note: unique index on discrepancy_id (replaces the plain FK index idx_credit_discrepancy)",
  statements: [
    `DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM "credit_note" GROUP BY "discrepancy_id" HAVING count(*) > 1) THEN
        RAISE EXCEPTION 'credit_note has more than one note for a discrepancy: resolve the duplicates before migration 0008 (nothing was changed)';
      END IF;
    END $$`,
    // "Get the credit for a discrepancy" (FK index); unique, so one discrepancy is never credited twice.
    `CREATE UNIQUE INDEX IF NOT EXISTS "uq_credit_note_discrepancy" ON "credit_note" ("discrepancy_id")`,
    // The unique index serves every query the plain one did.
    `DROP INDEX IF EXISTS "idx_credit_discrepancy"`,
  ],
};
