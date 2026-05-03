/**
 * @module scripts/addSitePageSurface
 *
 * One-shot migration: add `surface` column to `site_page`, drop the legacy
 * unique on `slug`, and replace it with a composite unique on
 * `(slug, surface)`. Idempotent — each statement guards against re-runs.
 *
 * Run with: `pnpm --filter @culinaire/server tsx src/scripts/addSitePageSurface.ts`
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Match the path the main server entry uses so DATABASE_URL resolves the
// same way under tsx as it does under `pnpm dev`.
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { ensureSeededPages } from "../services/sitePageService.js";

async function main(): Promise<void> {
  console.log("[migrate] adding surface column to site_page (idempotent)…");
  await db.execute(sql`
    ALTER TABLE "site_page"
    ADD COLUMN IF NOT EXISTS "surface" varchar(20) NOT NULL DEFAULT 'web'
  `);

  // Postgres auto-names a column unique constraint as `${table}_${col}_key`.
  // Drop it if present; ignore if it was already replaced.
  console.log("[migrate] dropping legacy unique on slug if present…");
  await db.execute(sql`
    ALTER TABLE "site_page"
    DROP CONSTRAINT IF EXISTS "site_page_slug_key"
  `);
  await db.execute(sql`
    ALTER TABLE "site_page"
    DROP CONSTRAINT IF EXISTS "site_page_slug_unique"
  `);

  console.log("[migrate] creating composite unique (slug, surface) if missing…");
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "site_page_slug_surface_unq"
    ON "site_page" ("slug", "surface")
  `);

  console.log("[migrate] seeding terms + privacy on every surface…");
  await ensureSeededPages();

  console.log("[migrate] done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[migrate] FAILED:", err);
    process.exit(1);
  });
