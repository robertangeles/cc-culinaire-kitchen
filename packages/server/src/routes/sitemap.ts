/**
 * @module routes/sitemap
 *
 * Dynamic XML sitemap including static pages and all public recipes
 * from The Kitchen Shelf. Enables search engine discovery of recipe content.
 */

import { Router, type Request, type Response } from "express";
import { db } from "../db/index.js";
import { recipe } from "../db/schema.js";
import { eq, and, desc } from "drizzle-orm";

export const sitemapRouter = Router();

sitemapRouter.get("/", async (req: Request, res: Response) => {
  const baseUrl = process.env.CLIENT_URL ?? "https://culinaire.kitchen";
  const now = new Date().toISOString().split("T")[0];

  // Static pages
  const staticUrls = [
    { loc: "/", priority: "1.0", changefreq: "weekly" },
    { loc: "/login", priority: "0.5", changefreq: "monthly" },
    { loc: "/register", priority: "0.5", changefreq: "monthly" },
    { loc: "/kitchen-shelf", priority: "0.9", changefreq: "daily" },
    { loc: "/recipes", priority: "0.8", changefreq: "monthly" },
  ];

  // Dynamic recipe pages (public, non-archived)
  let recipeUrls: { loc: string; lastmod: string; image?: string }[] = [];
  try {
    const recipes = await db
      .select({
        slug: recipe.slug,
        recipeId: recipe.recipeId,
        imageUrl: recipe.imageUrl,
        updatedDttm: recipe.updatedDttm,
      })
      .from(recipe)
      .where(and(eq(recipe.isPublicInd, true), eq(recipe.archivedInd, false)))
      .orderBy(desc(recipe.createdDttm))
      .limit(1000);

    recipeUrls = recipes.map((r) => ({
      loc: `/kitchen-shelf/${r.slug ?? r.recipeId}`,
      lastmod: r.updatedDttm.toISOString().split("T")[0],
      image: r.imageUrl ?? undefined,
    }));
  } catch {
    // DB unavailable — serve static sitemap only
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${staticUrls.map((u) => `  <url>
    <loc>${baseUrl}${u.loc}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join("\n")}
${recipeUrls.map((r) => `  <url>
    <loc>${baseUrl}${r.loc}</loc>
    <lastmod>${r.lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>${r.image ? `
    <image:image>
      <image:loc>${r.image}</image:loc>
    </image:image>` : ""}
  </url>`).join("\n")}
</urlset>`;

  res.header("Content-Type", "application/xml");
  res.send(xml);
});
