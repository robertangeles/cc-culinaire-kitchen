import type { Migration } from "./runner.js";

/**
 * Push notifications (server side of Wave 4): per-type opt-outs, quiet hours and the pending delivery receipts.
 * Run BEFORE the server version that reads these deploys. The previous server version keeps working afterwards:
 * all three tables are new and nothing there reads or writes them, and no existing table or column changes.
 * The one exception is deleting a user: the previous version does not clear `push_opt_outs` / `push_quiet_hours`
 * rows, but it also never creates them, so there is nothing to clear until the new version is live.
 */
export const migration: Migration = {
  id: "0004_push_dispatch",
  description: "push_opt_outs, push_quiet_hours and push_receipts, with their indexes",
  statements: [
    // One row per notification type a user switched off; absence = on.
    `CREATE TABLE IF NOT EXISTS "push_opt_outs" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" integer NOT NULL REFERENCES "user"("user_id"),
      "notification_type" varchar(30) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )`,
    // "Has this user switched this type off?" at dispatch, and the settings screen's list; its leading user_id column serves the FK.
    `CREATE UNIQUE INDEX IF NOT EXISTS "uq_push_opt_outs_user_type" ON "push_opt_outs" ("user_id", "notification_type")`,
    // One quiet-hours window per user, in minutes after local midnight in the user's own time zone; end before start crosses midnight.
    `CREATE TABLE IF NOT EXISTS "push_quiet_hours" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" integer NOT NULL REFERENCES "user"("user_id"),
      "start_minute" smallint NOT NULL,
      "end_minute" smallint NOT NULL,
      "time_zone" varchar(64) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "ck_push_quiet_hours_minutes" CHECK ("start_minute" BETWEEN 0 AND 1439 AND "end_minute" BETWEEN 0 AND 1439 AND "start_minute" <> "end_minute")
    )`,
    // "What are this user's quiet hours?" at dispatch; also serves the FK.
    `CREATE UNIQUE INDEX IF NOT EXISTS "uq_push_quiet_hours_user" ON "push_quiet_hours" ("user_id")`,
    // Tickets the push provider accepted, kept until their delivery receipt has been read.
    `CREATE TABLE IF NOT EXISTS "push_receipts" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "device_token_id" uuid NOT NULL REFERENCES "device_token"("device_token_id") ON DELETE CASCADE,
      "ticket_id" varchar(100) NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )`,
    // FK index: dropping a device token cascades to its pending receipts.
    `CREATE INDEX IF NOT EXISTS "idx_push_receipts_device_token" ON "push_receipts" ("device_token_id")`,
    // The receipt job: "tickets old enough to have a receipt, oldest first" (and "older than a day: give up").
    `CREATE INDEX IF NOT EXISTS "idx_push_receipts_created" ON "push_receipts" ("created_at")`,
  ],
};
