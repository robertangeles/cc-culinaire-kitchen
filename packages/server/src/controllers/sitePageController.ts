/**
 * @module controllers/sitePageController
 *
 * Validation + response formatting for the site_page CRUD surface.
 * Admin endpoints are mounted under /api/admin/site-pages with role gate;
 * public endpoints under /api/site-pages with no auth.
 *
 * Every route is partitioned by `surface` ('web' or 'mobile') passed as
 * a query string parameter. Public routes default to 'web' for backward
 * compatibility with existing /terms /privacy footer wiring; admin
 * routes require the parameter explicitly so the UI never confuses
 * which surface it's editing.
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
  type Surface,
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

/**
 * Pulls and validates the `surface` query string parameter. Returns the
 * surface or sends a 400 if the value is not a known surface. `defaultIf`
 * lets public callers fall through to 'web' when the param is omitted —
 * preserves the legacy /api/site-pages/:slug behaviour for the web footer.
 */
function readSurface(
  req: Request,
  res: Response,
  defaultIf?: Surface,
): Surface | null {
  const raw = typeof req.query.surface === "string" ? req.query.surface : undefined;
  if (raw === undefined) {
    if (defaultIf) return defaultIf;
    res.status(400).json({ error: "Missing surface" });
    return null;
  }
  if (raw !== "web" && raw !== "mobile") {
    res.status(400).json({ error: "Invalid surface" });
    return null;
  }
  return raw;
}

// ── Public ───────────────────────────────────────────────

/** GET /api/site-pages?surface=web|mobile — list published pages (footer hydration). */
export async function handleListPublic(req: Request, res: Response, next: NextFunction) {
  try {
    const surface = readSurface(req, res, "web");
    if (!surface) return;
    res.json(await listPublishedPages(surface));
  } catch (err) { next(err); }
}

/** GET /api/site-pages/:slug?surface=web|mobile — one published page or 404. */
export async function handleGetPublic(req: Request, res: Response, next: NextFunction) {
  try {
    const slug = req.params.slug as string;
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "Invalid slug" });
      return;
    }
    const surface = readSurface(req, res, "web");
    if (!surface) return;
    const page = await getPublishedPageBySlug(slug, surface);
    if (!page) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    res.json(page);
  } catch (err) { next(err); }
}

// ── Admin ────────────────────────────────────────────────

/** GET /api/admin/site-pages?surface=web|mobile — all pages including drafts. */
export async function handleListAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const surface = readSurface(req, res);
    if (!surface) return;
    res.json(await listPages(surface));
  } catch (err) { next(err); }
}

/** GET /api/admin/site-pages/:slug?surface=web|mobile — one page in any state. */
export async function handleGetAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const slug = req.params.slug as string;
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "Invalid slug" });
      return;
    }
    const surface = readSurface(req, res);
    if (!surface) return;
    const page = await getPageBySlugAdmin(slug, surface);
    if (!page) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    res.json(page);
  } catch (err) { next(err); }
}

/** PUT /api/admin/site-pages/:slug?surface=web|mobile — upsert. */
export async function handleUpsertAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const slug = req.params.slug as string;
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "Invalid slug" });
      return;
    }
    const surface = readSurface(req, res);
    if (!surface) return;
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const saved = await upsertPage({ slug, surface, ...parsed.data });
    res.json(saved);
  } catch (err) { next(err); }
}

/** DELETE /api/admin/site-pages/:slug?surface=web|mobile — guarded against reserved slugs. */
export async function handleDeleteAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const slug = req.params.slug as string;
    if (!isValidSlug(slug)) {
      res.status(400).json({ error: "Invalid slug" });
      return;
    }
    const surface = readSurface(req, res);
    if (!surface) return;
    const result = await deletePage(slug, surface);
    if (!result.deleted) {
      const status = result.reason ? 400 : 404;
      res.status(status).json({ error: result.reason ?? "Page not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
}
