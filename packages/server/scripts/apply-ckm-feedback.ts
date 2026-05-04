/**
 * Targeted, idempotent apply of the `ckm_feedback` table only.
 *
 * Why this script (rather than `drizzle-kit push`): push diffs the entire
 * schema and surfaces a pre-existing drift on the `guide` table
 * (`guide_guide_key_unique`) that is unrelated to this work. Applying
 * just the new table here avoids touching the `guide` table; the drift
 * needs a separate, deliberate fix.
 *
 * The DDL mirrors exactly what drizzle would produce from
 * `packages/server/src/db/schema.ts` for `ckmFeedback`. Idempotent —
 * safe to re-run.
 *
 * Usage: `npx tsx scripts/apply-ckm-feedback.ts`
 */
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

const stmts: string[] = [
  `CREATE TABLE IF NOT EXISTS "ckm_feedback" (
    "feedback_id"          serial PRIMARY KEY,
    "user_id"              integer REFERENCES "user"("user_id") ON DELETE SET NULL,
    "anonymous_ind"        boolean NOT NULL DEFAULT false,
    "category"             varchar(20) NOT NULL,
    "subject"              varchar(120) NOT NULL,
    "body"                 text NOT NULL,
    "app_version"          varchar(32) NOT NULL,
    "device_info"          jsonb,
    "screenshot_base64"    text,
    "email_sent_dttm"      timestamp with time zone,
    "email_send_attempts"  smallint NOT NULL DEFAULT 0,
    "created_dttm"         timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "ckm_feedback_category_check"
      CHECK ("category" IN ('bug', 'feature', 'feedback')),
    CONSTRAINT "ckm_feedback_body_length_check"
      CHECK (length("body") <= 4000)
  );`,
  `CREATE INDEX IF NOT EXISTS "idx_ckm_feedback_user"     ON "ckm_feedback" ("user_id");`,
  `CREATE INDEX IF NOT EXISTS "idx_ckm_feedback_created"  ON "ckm_feedback" ("created_dttm");`,
  `CREATE INDEX IF NOT EXISTS "idx_ckm_feedback_category" ON "ckm_feedback" ("category");`,
  `CREATE INDEX IF NOT EXISTS "idx_ckm_feedback_pending_send"
     ON "ckm_feedback" ("email_send_attempts")
     WHERE "email_sent_dttm" IS NULL;`,
];

try {
  for (const s of stmts) {
    const head = s.replace(/\s+/g, " ").slice(0, 80);
    console.log("→", head, "…");
    await sql.unsafe(s);
  }
  console.log("\n✓ ckm_feedback applied (idempotent).");
} catch (err) {
  console.error("Apply failed:", err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
