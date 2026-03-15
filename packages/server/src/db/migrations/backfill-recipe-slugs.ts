// @ts-nocheck
/**
 * Backfill slugs for existing recipes that have none.
 */
import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL);

function toSlug(title) {
  return title
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

const recipes = await sql`SELECT recipe_id, title FROM recipe WHERE slug IS NULL`;
console.log(`Found ${recipes.length} recipes without slugs`);

for (const r of recipes) {
  let slug = toSlug(r.title);
  let suffix = 1;
  while (true) {
    const existing = await sql`SELECT 1 FROM recipe WHERE slug = ${slug} LIMIT 1`;
    if (existing.length === 0) break;
    suffix++;
    slug = `${toSlug(r.title)}-${suffix}`;
  }
  await sql`UPDATE recipe SET slug = ${slug} WHERE recipe_id = ${r.recipe_id}`;
  console.log(`  ${r.recipe_id} → ${slug}`);
}

console.log("Done");
await sql.end();
