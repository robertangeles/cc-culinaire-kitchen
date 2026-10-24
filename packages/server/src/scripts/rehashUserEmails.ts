/**
 * One-off: recompute `user.user_email_hash` (the blind index used by Google sign-in and
 * other lookups) with the PII_HMAC_KEY of the environment this runs against.
 *
 * Why: production had no PII_HMAC_KEY set, so every boot generated a random one and
 * the stored hashes matched nothing. Run this once AFTER the fixed key is set, with
 * the same key the server will use.
 *
 * Only `user_email_hash` is written, only for users whose hash is wrong, never for
 * deleted users (their hash is null on purpose). Idempotent: a second run changes 0.
 *
 * Run (dev first; then prod after a backup):
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/rehashUserEmails.ts
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/rehashUserEmails.ts
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

const { eq, ne } = await import("drizzle-orm");
const { db } = await import("../db/index.js");
const { user } = await import("../db/schema.js");
const { decryptUserPii } = await import("../services/piiService.js");
const { hashForLookup } = await import("../utils/crypto.js");

const rows = await db
  .select({
    userId: user.userId,
    userEmail: user.userEmail,
    userEmailEnc: user.userEmailEnc,
    userEmailIv: user.userEmailIv,
    userEmailTag: user.userEmailTag,
    userEmailHash: user.userEmailHash,
  })
  .from(user)
  .where(ne(user.userStatus, "deleted"));

const stale = rows
  .map((r) => ({ userId: r.userId, hash: hashForLookup(decryptUserPii(r).userEmail), current: r.userEmailHash }))
  .filter((r) => r.hash !== r.current);

await db.transaction(async (tx) => {
  for (const r of stale) await tx.update(user).set({ userEmailHash: r.hash }).where(eq(user.userId, r.userId));
});

console.log(`rehashUserEmails: ${rows.length} users checked, ${stale.length} updated`);
process.exit(0);
