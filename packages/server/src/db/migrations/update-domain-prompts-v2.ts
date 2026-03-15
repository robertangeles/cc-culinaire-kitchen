// @ts-nocheck
/**
 * Update patisseriePrompt and spiritsPrompt with V2 content in the database.
 * Reads from the V2 prompt files and updates both active and default rows.
 */
import "dotenv/config";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = postgres(process.env.DATABASE_URL);

const prompts = [
  { name: "patisseriePrompt", file: "patisseriePromptV2.md" },
  { name: "spiritsPrompt", file: "spiritsPromptV2.md" },
];

for (const p of prompts) {
  const filePath = join(__dirname, "../../../../../prompts/recipe", p.file);
  const raw = await readFile(filePath, "utf-8");
  const content = matter(raw).content.trim();

  // Update active copy
  const active = await sql`UPDATE prompt SET prompt_body = ${content}, updated_dttm = NOW() WHERE prompt_name = ${p.name} AND default_ind = false RETURNING prompt_id`;
  // Update default copy
  const def = await sql`UPDATE prompt SET prompt_body = ${content}, updated_dttm = NOW() WHERE prompt_name = ${p.name} AND default_ind = true RETURNING prompt_id`;

  console.log(`${p.name}: active=${active.length > 0 ? "updated" : "not found"}, default=${def.length > 0 ? "updated" : "not found"}`);
}

console.log("Done — V2 prompts updated in database");
await sql.end();
