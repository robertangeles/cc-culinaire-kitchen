// @ts-nocheck
import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL);

const result = await sql`UPDATE recipe SET image_url = NULL WHERE image_url LIKE '/uploads/%'`;
console.log(`Cleared ${result.count} broken image URLs`);

await sql.end();
