/**
 * @module controllers/sitePageController
 *
 * Validation + response formatting for the site_page CRUD surface.
 * Admin endpoints are mounted under /api/admin/site-pages with role gate;
 * public endpoints under /api/site-pages with no auth.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  listPages,
  listPublishedPages,
  getPageBySlugAdmin,
  getPublishedPageBySlug,
  upsertPage,
  deletePage,
} from "../services/sitePageService.js";

const SLUG_RE = /^[a-z][a-z0-9-]{1,79}$/;

const upsertSchema = z.object({
  title: z.string().min(1).max(200),
  bodyMd: z.string().max(100_000),
  publishedInd: z.boolean(),
}).strict();

function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

// ── Public ───────────────────────────────────────────────

/** GET /api/site-pages — list published pages (footer hydration). */
export async function handleListPublic(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await listPublishedPages());
  } catch (err) { next(err); }
}

/** GET /api/site-pages/:slug — one published page or 404. */
export async function handleGetPublic(req: Request, res: Response, next: NextFunction) {
  try {
    const slug = req.params.slug as string;
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "Invalid slug" });
      return;
    }
    const page = await getPublishedPageBySlug(slug);
    if (!page) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    res.json(page);
  } catch (err) { next(err); }
}

// ── Admin ────────────────────────────────────────────────

/** GET /api/admin/site-pages — all pages including drafts. */
export async function handleListAdmin(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await listPages());
  } catch (err) { next(err); }
}

/** GET /api/admin/site-pages/:slug — one page in any state. */
export async function handleGetAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const slug = req.params.slug as string;
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "Invalid slug" });
      return;
    }
    const page = await getPageBySlugAdmin(slug);
    if (!page) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    res.json(page);
  } catch (err) { next(err); }
}

/** PUT /api/admin/site-pages/:slug — upsert. */
export async function handleUpsertAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const slug = req.params.slug as string;
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "Invalid slug" });
      return;
    }
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const saved = await upsertPage({ slug, ...parsed.data });
    res.json(saved);
  } catch (err) { next(err); }
}

/** DELETE /api/admin/site-pages/:slug — guarded against reserved slugs. */
export async function handleDeleteAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const slug = req.params.slug as string;
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "Invalid slug" });
      return;
    }
    const result = await deletePage(slug);
    if (!result.deleted) {
      const status = result.reason ? 400 : 404;
      res.status(status).json({ error: result.reason ?? "Page not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
}
