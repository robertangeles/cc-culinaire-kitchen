/**
 * @module guideService
 *
 * Service layer for managing user guide content stored in the `guide`
 * table. Guides are markdown documents that help users understand each
 * module (Waste Intelligence, Kitchen Copilot, Menu Intelligence, etc.).
 *
 * Admins can create and update guides; all authenticated users can read.
 */

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { guide } from "../db/schema.js";

/**
 * Retrieve a single guide by its unique key.
 *
 * @param guideKey - The slug identifier (e.g. "waste_intelligence").
 * @returns The guide's key, title, and markdown content, or null if not found.
 */
export async function getGuide(
  guideKey: string,
): Promise<{ guideKey: string; title: string; content: string } | null> {
  const rows = await db
    .select({
      guideKey: guide.guideKey,
      title: guide.title,
      content: guide.content,
    })
    .from(guide)
    .where(eq(guide.guideKey, guideKey))
    .limit(1);

  return rows.length > 0 ? rows[0] : null;
}

/**
 * Retrieve all guides (admin listing).
 *
 * @returns Array of guides with key, title, content, and last-updated timestamp.
 */
export async function getAllGuides(): Promise<
  Array<{ guideKey: string; title: string; content: string; updatedDttm: Date }>
> {
  return db
    .select({
      guideKey: guide.guideKey,
      title: guide.title,
      content: guide.content,
      updatedDttm: guide.updatedDttm,
    })
    .from(guide);
}

/**
 * Insert or update a guide by key.
 *
 * If a guide with the given key exists, its title, content, and
 * updated metadata are overwritten. Otherwise a new row is created.
 *
 * @param guideKey  - The slug identifier.
 * @param title     - Human-readable title.
 * @param content   - Markdown body.
 * @param updatedBy - The userId of the admin performing the upsert.
 */
export async function upsertGuide(
  guideKey: string,
  title: string,
  content: string,
  updatedBy: number,
): Promise<void> {
  const existing = await db
    .select({ guideId: guide.guideId })
    .from(guide)
    .where(eq(guide.guideKey, guideKey))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(guide)
      .set({ title, content, updatedBy, updatedDttm: new Date() })
      .where(eq(guide.guideId, existing[0].guideId));
  } else {
    await db.insert(guide).values({ guideKey, title, content, updatedBy });
  }
}
