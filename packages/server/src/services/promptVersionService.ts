/**
 * @module promptVersionService
 *
 * Service layer for managing prompt version history.
 *
 * Every time a prompt is saved, a snapshot is recorded in the
 * `prompt_version` table. The history is capped at {@link MAX_VERSIONS}
 * per prompt — when a new version would exceed the cap, the oldest
 * entry is automatically deleted.
 *
 * Versions are linked to the `prompt` table via `prompt_id` FK for
 * efficient integer-based joins.
 *
 * Rollback restores a previous version's content into the active prompt
 * via {@link savePrompt} from the prompt service.
 */

import { eq, asc, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { prompt, promptVersion } from "../db/schema.js";
import { savePrompt } from "./promptService.js";

/** Maximum number of versions retained per prompt. */
const MAX_VERSIONS = 7;

/**
 * Create a new version snapshot for the given prompt.
 *
 * Automatically increments the version number and deletes the oldest
 * version if the cap ({@link MAX_VERSIONS}) would be exceeded.
 *
 * @param promptId - The `prompt_id` FK of the active prompt row.
 * @param body     - The prompt content to snapshot.
 */
export async function createVersion(
  promptId: number,
  body: string
): Promise<void> {
  // Determine next version number
  const latest = await db
    .select({ versionNumber: promptVersion.versionNumber })
    .from(promptVersion)
    .where(eq(promptVersion.promptId, promptId))
    .orderBy(desc(promptVersion.versionNumber))
    .limit(1);

  const nextVersion = latest.length > 0 ? latest[0].versionNumber + 1 : 1;

  // Insert the new version
  await db.insert(promptVersion).values({
    promptId,
    promptBody: body,
    versionNumber: nextVersion,
  });

  // Enforce cap: delete oldest if over MAX_VERSIONS
  const all = await db
    .select({ versionId: promptVersion.versionId })
    .from(promptVersion)
    .where(eq(promptVersion.promptId, promptId))
    .orderBy(asc(promptVersion.versionNumber));

  if (all.length > MAX_VERSIONS) {
    const toDelete = all.slice(0, all.length - MAX_VERSIONS);
    for (const row of toDelete) {
      await db
        .delete(promptVersion)
        .where(eq(promptVersion.versionId, row.versionId));
    }
  }
}

/**
 * Retrieve all version snapshots for a prompt, newest first.
 *
 * @param promptId - The `prompt_id` FK to filter by.
 * @returns Array of version records ordered by descending version number.
 */
export async function getVersions(promptId: number) {
  return db
    .select()
    .from(promptVersion)
    .where(eq(promptVersion.promptId, promptId))
    .orderBy(desc(promptVersion.versionNumber));
}

/**
 * Restore a previous version's content into the active prompt.
 *
 * Looks up the version by ID, resolves the prompt name from the parent
 * `prompt` row, writes the body back through {@link savePrompt} (which
 * also creates a new version snapshot and invalidates the cache), and
 * returns the restored content.
 *
 * @param versionId - The `version_id` of the snapshot to restore.
 * @returns The restored prompt content.
 * @throws {Error} If the version ID is not found.
 */
export async function rollbackToVersion(versionId: number): Promise<string> {
  const rows = await db
    .select()
    .from(promptVersion)
    .where(eq(promptVersion.versionId, versionId));

  if (rows.length === 0) {
    throw new Error(`Version ${versionId} not found`);
  }

  const version = rows[0];

  // Resolve prompt name from the parent prompt row
  const promptRows = await db
    .select({ promptName: prompt.promptName })
    .from(prompt)
    .where(eq(prompt.promptId, version.promptId));

  if (promptRows.length === 0) {
    throw new Error(`Prompt ${version.promptId} not found`);
  }

  await savePrompt(promptRows[0].promptName, version.promptBody);
  return version.promptBody;
}
