/**
 * @module services/sitePageService
 *
 * CRUD for `site_page`. Public reads honour `published_ind`; admin reads
 * see everything. The two seeded slugs ('terms', 'privacy') are
 * load-bearing for the landing footer — `deletePage` refuses to remove
 * them so a stray DELETE can't leave the public footer pointing at 404.
 */

import { eq, asc } from "drizzle-orm";
import { db } from "../db/index.js";
import { sitePage } from "../db/schema.js";

export interface SitePage {
  pageId: string;
  slug: string;
  title: string;
  bodyMd: string;
  publishedInd: boolean;
  createdDttm: Date;
  updatedDttm: Date;
}

/** Slugs that may not be deleted — they're wired into the landing footer. */
const RESERVED_SLUGS = new Set(["terms", "privacy"]);

/**
 * Idempotent boot-time seed. Ensures the two reserved slugs exist as
 * draft rows so admins always have a starting point for ToS + Privacy
 * content. Called once during server startup.
 */
export async function ensureSeededPages(): Promise<void> {
  const seeds = [
    { slug: "terms", title: "Terms of Service" },
    { slug: "privacy", title: "Privacy Policy" },
  ];

  for (const seed of seeds) {
    const existing = await db
      .select({ pageId: sitePage.pageId })
      .from(sitePage)
      .where(eq(sitePage.slug, seed.slug));
    if (existing.length === 0) {
      await db.insert(sitePage).values({
        slug: seed.slug,
        title: seed.title,
        bodyMd: "",
        publishedInd: false,
      });
    }
  }
}

/** Admin: every page, ordered by slug. */
export async function listPages(): Promise<SitePage[]> {
  return db.select().from(sitePage).orderBy(asc(sitePage.slug));
}

/** Public: published pages only — used by the footer to discover live pages. */
export async function listPublishedPages(): Promise<Pick<SitePage, "slug" | "title" | "updatedDttm">[]> {
  return db
    .select({ slug: sitePage.slug, title: sitePage.title, updatedDttm: sitePage.updatedDttm })
    .from(sitePage)
    .where(eq(sitePage.publishedInd, true))
    .orderBy(asc(sitePage.slug));
}

/** Admin: one page by slug, regardless of publish state. Returns null when missing. */
export async function getPageBySlugAdmin(slug: string): Promise<SitePage | null> {
  const [row] = await db.select().from(sitePage).where(eq(sitePage.slug, slug));
  return row ?? null;
}

/** Public: one page by slug, only when published. Returns null when missing or draft. */
export async function getPublishedPageBySlug(slug: string): Promise<SitePage | null> {
  const [row] = await db.select().from(sitePage).where(eq(sitePage.slug, slug));
  if (!row || !row.publishedInd) return null;
  return row;
}

export interface UpsertPageInput {
  slug: string;
  title: string;
  bodyMd: string;
  publishedInd: boolean;
}

/**
 * Insert or update a page by slug. Slug is the natural key — admins do
 * not edit it after creation, but the service does not enforce that
 * directly (the controller does, since it needs the request shape).
 */
export async function upsertPage(input: UpsertPageInput): Promise<SitePage> {
  const existing = await db
    .select({ pageId: sitePage.pageId })
    .from(sitePage)
    .where(eq(sitePage.slug, input.slug));

  if (existing.length > 0) {
    const [updated] = await db
      .update(sitePage)
      .set({
        title: input.title,
        bodyMd: input.bodyMd,
        publishedInd: input.publishedInd,
        updatedDttm: new Date(),
      })
      .where(eq(sitePage.pageId, existing[0].pageId))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(sitePage)
    .values({
      slug: input.slug,
      title: input.title,
      bodyMd: input.bodyMd,
      publishedInd: input.publishedInd,
    })
    .returning();
  return created;
}

/**
 * Delete a page. Refuses to delete reserved slugs; the caller surfaces
 * the rejection as a 400 to the admin UI.
 */
export async function deletePage(slug: string): Promise<{ deleted: boolean; reason?: string }> {
  if (RESERVED_SLUGS.has(slug)) {
    return { deleted: false, reason: "Reserved page — cannot be deleted" };
  }
  const result = await db.delete(sitePage).where(eq(sitePage.slug, slug)).returning({ pageId: sitePage.pageId });
  return { deleted: result.length > 0 };
}

export const __test = { RESERVED_SLUGS };
