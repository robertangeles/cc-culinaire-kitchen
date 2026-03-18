// @ts-nocheck
import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL);

const rows = await sql`SELECT recipe_id, title, image_url, SUBSTRING(image_prompt, 1, 80) as prompt_preview FROM recipe LIMIT 5`;
for (const r of rows) {
  console.log(`${r.title} | url: ${r.image_url} | prompt: ${r.prompt_preview ?? 'NULL'}`);
}
console.log(`Total recipes: ${rows.length}`);
await sql.end();
