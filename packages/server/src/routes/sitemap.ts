import { Router, type Request, type Response } from "express";

export const sitemapRouter = Router();

sitemapRouter.get("/", (req: Request, res: Response) => {
  const baseUrl = process.env.CLIENT_URL ?? "https://culinaire.kitchen";
  const now = new Date().toISOString().split("T")[0];

  const urls = [
    { loc: "/", priority: "1.0", changefreq: "weekly" },
    { loc: "/login", priority: "0.8", changefreq: "monthly" },
    { loc: "/register", priority: "0.8", changefreq: "monthly" },
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${baseUrl}${u.loc}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join("\n")}
</urlset>`;

  res.header("Content-Type", "application/xml");
  res.send(xml);
});
