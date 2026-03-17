// @ts-nocheck
import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL);

// Find and fix duplicate slugs by appending recipe_id suffix
const dupes = await sql`
  SELECT slug, COUNT(*) as count
  FROM recipe
  WHERE slug IS NOT NULL
  GROUP BY slug
  HAVING COUNT(*) > 1
`;

if (dupes.length > 0) {
  console.log(`Found ${dupes.length} duplicate slug(s), fixing...`);
  for (const dupe of dupes) {
    // Get all recipes with this slug except the first one
    const recipes = await sql`
      SELECT recipe_id FROM recipe
      WHERE slug = ${dupe.slug}
      ORDER BY created_dttm ASC
    `;
    // Skip the first (oldest) — keep its slug. Fix the rest.
    for (let i = 1; i < recipes.length; i++) {
      const newSlug = `${dupe.slug}-${i + 1}`;
      await sql`UPDATE recipe SET slug = ${newSlug} WHERE recipe_id = ${recipes[i].recipe_id}`;
      console.log(`  Fixed: ${dupe.slug} → ${newSlug}`);
    }
  }
}

// Also fix NULL slugs
const nullSlugs = await sql`SELECT recipe_id, title FROM recipe WHERE slug IS NULL`;
for (const r of nullSlugs) {
  const slug = (r.title || "recipe")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 200) + "-" + r.recipe_id.slice(0, 8);
  await sql`UPDATE recipe SET slug = ${slug} WHERE recipe_id = ${r.recipe_id}`;
  console.log(`  Fixed NULL slug: ${slug}`);
}

console.log("Duplicate/NULL slugs fixed");
await sql.end();
