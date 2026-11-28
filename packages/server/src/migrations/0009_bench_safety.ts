import type { Migration } from "./runner.js";

/**
 * The Bench: blocking a person, reporting a message or a person, and the moderators' record of what was done about a report.
 * Run BEFORE the server version that reads these tables deploys. That version still serves the Bench without them (nobody is
 * treated as blocked); only blocking, reporting and the moderation queue fail. The previous server version never reads them.
 */
export const migration: Migration = {
  id: "0009_bench_safety",
  description: "bench_blocks, bench_reports, bench_report_actions and the bench:moderate permission",
  statements: [
    `CREATE TABLE IF NOT EXISTS "bench_blocks" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" integer NOT NULL REFERENCES "user"("user_id") ON DELETE CASCADE,
      "blocked_user_id" integer NOT NULL REFERENCES "user"("user_id") ON DELETE CASCADE,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "bench_blocks_not_self" CHECK ("user_id" <> "blocked_user_id")
    )`,
    // FK index (user_id first): "the people I blocked" (history filters, the blocked list), and one row per pair.
    `CREATE UNIQUE INDEX IF NOT EXISTS "idx_bench_blocks_pair" ON "bench_blocks" ("user_id", "blocked_user_id")`,
    // FK index: "who blocked this author", read before every live message, edit, typing notice and presence list.
    `CREATE INDEX IF NOT EXISTS "idx_bench_blocks_blocked_user_id" ON "bench_blocks" ("blocked_user_id")`,

    `CREATE TABLE IF NOT EXISTS "bench_reports" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" integer NOT NULL REFERENCES "user"("user_id") ON DELETE CASCADE,
      "reported_user_id" integer NOT NULL REFERENCES "user"("user_id") ON DELETE CASCADE,
      "message_id" uuid REFERENCES "bench_message"("message_id") ON DELETE SET NULL,
      "message_body" text,
      "reason" varchar(20) NOT NULL,
      "note" varchar(500),
      "status" varchar(20) NOT NULL DEFAULT 'open',
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "bench_reports_reason" CHECK ("reason" IN ('spam', 'harassment', 'hate', 'sexual', 'violence', 'other')),
      CONSTRAINT "bench_reports_status" CHECK ("status" IN ('open', 'hidden', 'dismissed', 'resolved'))
    )`,
    // FK index: "reports this person made today" (the daily limit), and the constraint check when that user row is deleted.
    `CREATE INDEX IF NOT EXISTS "idx_bench_reports_user_id" ON "bench_reports" ("user_id", "created_at")`,
    // FK index: the constraint check when the reported user row is deleted.
    `CREATE INDEX IF NOT EXISTS "idx_bench_reports_reported_user_id" ON "bench_reports" ("reported_user_id")`,
    // FK index: "open reports about this message" (closed together when it is hidden).
    `CREATE INDEX IF NOT EXISTS "idx_bench_reports_message_id" ON "bench_reports" ("message_id")`,
    // "The open queue, newest first": only open reports are in it.
    `CREATE INDEX IF NOT EXISTS "idx_bench_reports_open" ON "bench_reports" ("created_at") WHERE "status" = 'open'`,

    `CREATE TABLE IF NOT EXISTS "bench_report_actions" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "report_id" uuid NOT NULL REFERENCES "bench_reports"("id") ON DELETE CASCADE,
      "user_id" integer REFERENCES "user"("user_id") ON DELETE SET NULL,
      "action" varchar(20) NOT NULL,
      "note" varchar(500),
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "bench_report_actions_action" CHECK ("action" IN ('hide', 'dismiss', 'resolve'))
    )`,
    // FK index: "what was done about this report" (the queue shows it).
    `CREATE INDEX IF NOT EXISTS "idx_bench_report_actions_report_id" ON "bench_report_actions" ("report_id")`,
    // FK index: the constraint check when a moderator's user row is deleted.
    `CREATE INDEX IF NOT EXISTS "idx_bench_report_actions_user_id" ON "bench_report_actions" ("user_id")`,

    // Granted to no role: an Administrator holds every permission. A role editor can give it to a moderator role.
    `INSERT INTO "permission" ("permission_key", "permission_description")
      VALUES ('bench:moderate', 'Review Bench reports: hide a message, dismiss or resolve a report')
      ON CONFLICT ("permission_key") DO NOTHING`,
  ],
};
