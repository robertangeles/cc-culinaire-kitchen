import type { Migration } from "./runner.js";

/**
 * Receiving extras: an expiry date and a lot number per delivery line (the lot also on the FIFO batch it becomes),
 * and the supplier's docket number per delivery. Run BEFORE the server version that reads these columns deploys:
 * that server selects them on every receiving and FIFO batch query, so without them those queries fail.
 * The previous server version keeps working afterwards: every column is nullable and nothing there reads them.
 * No foreign keys, so no new indexes; nothing filters on these columns yet.
 */
export const migration: Migration = {
  id: "0010_receiving_extras",
  description: "receiving_line.expiry_date and lot_number, fifo_batch.lot_number, receiving_session.docket_number",
  statements: [
    `ALTER TABLE "receiving_line" ADD COLUMN IF NOT EXISTS "expiry_date" date`,
    `ALTER TABLE "receiving_line" ADD COLUMN IF NOT EXISTS "lot_number" varchar(50)`,
    `ALTER TABLE "fifo_batch" ADD COLUMN IF NOT EXISTS "lot_number" varchar(50)`,
    `ALTER TABLE "receiving_session" ADD COLUMN IF NOT EXISTS "docket_number" varchar(50)`,
  ],
};
