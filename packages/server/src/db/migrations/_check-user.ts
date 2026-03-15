// @ts-nocheck
import "dotenv/config";
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL);
const users = await sql`SELECT user_id, user_name, subscription_status, subscription_tier, free_sessions FROM "user" LIMIT 5`;
console.log(JSON.stringify(users, null, 2));
await sql.end();
