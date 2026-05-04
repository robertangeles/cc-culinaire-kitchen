/**
 * @module services/sitePageService
 *
 * CRUD for `site_page`. Public reads honour `published_ind`; admin reads
 * see everything. Each row belongs to a single `surface` ('web' or
 * 'mobile') so admins can author distinct legal copy per app. The two
 * reserved slugs ('terms', 'privacy') are seeded for every surface —
 * `deletePage` refuses to remove them so a stray DELETE can't leave the
 * public footer pointing at 404.
 */

import { and, eq, asc } from "drizzle-orm";
import { db } from "../db/index.js";
import { sitePage } from "../db/schema.js";

/** Which app surface a site page row belongs to. */
export type Surface = "web" | "mobile";

/** All surfaces seeded at boot. Add a new surface here to extend coverage. */
const SURFACES: Surface[] = ["web", "mobile"];

export interface SitePage {
  pageId: string;
  slug: string;
  surface: Surface;
  title: string;
  bodyMd: string;
  publishedInd: boolean;
  createdDttm: Date;
  updatedDttm: Date;
}

/** Slugs that may not be deleted — they're wired into every surface's footer. */
const RESERVED_SLUGS = new Set(["terms", "privacy"]);

/**
 * Idempotent boot-time seed. Ensures the two reserved slugs exist as
 * draft rows on every surface so admins always have a starting point
 * for ToS + Privacy content. Called once during server startup.
 */
export async function ensureSeededPages(): Promise<void> {
  const seeds = [
    { slug: "terms", title: "Terms of Service" },
    { slug: "privacy", title: "Privacy Policy" },
  ];

  for (const surface of SURFACES) {
    for (const seed of seeds) {
      const existing = await db
        .select({ pageId: sitePage.pageId })
        .from(sitePage)
        .where(and(eq(sitePage.slug, seed.slug), eq(sitePage.surface, surface)));
      if (existing.length === 0) {
        await db.insert(sitePage).values({
          slug: seed.slug,
          surface,
          title: seed.title,
          bodyMd: "",
          publishedInd: false,
        });
      }
    }
  }
}

/** Admin: every page on a surface, ordered by slug. */
export async function listPages(surface: Surface): Promise<SitePage[]> {
  const rows = await db
    .select()
    .from(sitePage)
    .where(eq(sitePage.surface, surface))
    .orderBy(asc(sitePage.slug));
  return rows as SitePage[];
}

/** Public: published pages on a surface — used by the footer to discover live pages. */
export async function listPublishedPages(
  surface: Surface,
): Promise<Pick<SitePage, "slug" | "title" | "updatedDttm">[]> {
  return db
    .select({ slug: sitePage.slug, title: sitePage.title, updatedDttm: sitePage.updatedDttm })
    .from(sitePage)
    .where(and(eq(sitePage.publishedInd, true), eq(sitePage.surface, surface)))
    .orderBy(asc(sitePage.slug));
}

/** Admin: one page by (slug, surface), regardless of publish state. Returns null when missing. */
export async function getPageBySlugAdmin(slug: string, surface: Surface): Promise<SitePage | null> {
  const [row] = await db
    .select()
    .from(sitePage)
    .where(and(eq(sitePage.slug, slug), eq(sitePage.surface, surface)));
  return (row as SitePage | undefined) ?? null;
}

/** Public: one page by (slug, surface), only when published. Returns null when missing or draft. */
export async function getPublishedPageBySlug(
  slug: string,
  surface: Surface,
): Promise<SitePage | null> {
  const [row] = await db
    .select()
    .from(sitePage)
    .where(and(eq(sitePage.slug, slug), eq(sitePage.surface, surface)));
  if (!row || !row.publishedInd) return null;
  return row as SitePage;
}

export interface UpsertPageInput {
  slug: string;
  surface: Surface;
  title: string;
  bodyMd: string;
  publishedInd: boolean;
}

/**
 * Insert or update a page by (slug, surface). Each surface keeps its own
 * row per slug — admins do not edit slug or surface after creation, but
 * the service does not enforce that directly (the controller does, since
 * it needs the request shape).
 */
export async function upsertPage(input: UpsertPageInput): Promise<SitePage> {
  const existing = await db
    .select({ pageId: sitePage.pageId })
    .from(sitePage)
    .where(and(eq(sitePage.slug, input.slug), eq(sitePage.surface, input.surface)));

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
    return updated as SitePage;
  }

  const [created] = await db
    .insert(sitePage)
    .values({
      slug: input.slug,
      surface: input.surface,
      title: input.title,
      bodyMd: input.bodyMd,
      publishedInd: input.publishedInd,
    })
    .returning();
  return created as SitePage;
}

/**
 * Delete a page by (slug, surface). Refuses to delete reserved slugs on
 * any surface; the caller surfaces the rejection as a 400 to the admin UI.
 */
export async function deletePage(
  slug: string,
  surface: Surface,
): Promise<{ deleted: boolean; reason?: string }> {
  if (RESERVED_SLUGS.has(slug)) {
    return { deleted: false, reason: "Reserved page — cannot be deleted" };
  }
  const result = await db
    .delete(sitePage)
    .where(and(eq(sitePage.slug, slug), eq(sitePage.surface, surface)))
    .returning({ pageId: sitePage.pageId });
  return { deleted: result.length > 0 };
}
