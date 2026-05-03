/**
 * @module scripts/inspectSitePages
 *
 * Read-only diagnostic: dumps every row in site_page so you can verify
 * the (slug, surface) partitioning is what you expect. No mutations.
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });

import { asc } from "drizzle-orm";
import { db } from "../db/index.js";
import { sitePage } from "../db/schema.js";

const rows = await db
  .select({
    slug: sitePage.slug,
    surface: sitePage.surface,
    title: sitePage.title,
    publishedInd: sitePage.publishedInd,
    bodyLen: sitePage.bodyMd,
    updatedDttm: sitePage.updatedDttm,
  })
  .from(sitePage)
  .orderBy(asc(sitePage.slug), asc(sitePage.surface));

console.log(`\n${rows.length} row(s) in site_page:\n`);
console.log("slug".padEnd(14) + "surface".padEnd(10) + "title".padEnd(24) + "pub".padEnd(6) + "body".padEnd(8) + "updated");
console.log("-".repeat(80));
for (const r of rows) {
  const bodyLen = (r.bodyLen ?? "").length;
  console.log(
    r.slug.padEnd(14) +
      r.surface.padEnd(10) +
      r.title.padEnd(24) +
      (r.publishedInd ? "yes" : "no").padEnd(6) +
      `${bodyLen} ch`.padEnd(8) +
      r.updatedDttm.toISOString(),
  );
}

process.exit(0);
