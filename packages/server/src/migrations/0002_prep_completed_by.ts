import type { Migration } from "./runner.js";

/**
 * Wave 2 line loop (prep). Run BEFORE the server version that reads these columns deploys. The previous
 * server version keeps working afterwards: both columns are nullable and nothing there reads them.
 */
export const migration: Migration = {
  id: "0002_prep_completed_by",
  description: "prep_task.completed_by (who ticked it) and prep_session.generate_request_id (replay guard for generate)",
  statements: [
    `ALTER TABLE "prep_task" ADD COLUMN IF NOT EXISTS "completed_by" integer REFERENCES "user"("user_id")`,
    // FK index: "prep tasks ticked by one user", and the constraint check when that user row is deleted.
    `CREATE INDEX IF NOT EXISTS "idx_prep_task_completed_by" ON "prep_task" ("completed_by")`,
    // The id of the last generate request that rebuilt this session's tasks: a replay of the same request answers with the stored tasks.
    `ALTER TABLE "prep_session" ADD COLUMN IF NOT EXISTS "generate_request_id" uuid`,
  ],
};
