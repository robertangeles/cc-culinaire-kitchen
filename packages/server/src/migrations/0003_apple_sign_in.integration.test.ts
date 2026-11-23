import { describe, it, expect, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { oauthAccount, user } from "../db/schema.js";
import { migrations } from "./index.js";

/** Migration 0003 (Sign in with Apple): idempotent, applied by hand before the deploy. Gated on TENANT_IT=1. */
const RUN = process.env.TENANT_IT === "1";

describe("migration 0003", () => {
  it("is registered after 0002", () => {
    expect(migrations.map((m) => m.id)).toContain("0003_apple_sign_in");
  });
});

describe.skipIf(!RUN)("migration 0003 (real DB)", () => {
  const tag = `mig3-${Date.now().toString(36)}`;
  let userId: number | undefined;

  afterAll(async () => {
    if (userId === undefined) return;
    await db.delete(oauthAccount).where(eq(oauthAccount.userId, userId));
    await db.delete(user).where(eq(user.userId, userId));
  });

  it("can run twice and leaves a nullable token column, both Apple unique indexes and the retry table", async () => {
    const m = migrations.find((x) => x.id === "0003_apple_sign_in")!;
    for (let i = 0; i < 2; i++) for (const s of m.statements) await db.execute(sql.raw(s));

    const cols = (await db.execute(sql`
      SELECT is_nullable FROM information_schema.columns WHERE table_name = 'oauth_account' AND column_name = 'provider_refresh_token_enc'`)) as unknown as Array<{ is_nullable: string }>;
    expect(cols.map((c) => c.is_nullable)).toEqual(["YES"]);

    const idx = (await db.execute(sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'oauth_account' AND indexname LIKE 'uq_oauth_account_apple_%' ORDER BY indexname`)) as unknown as Array<{ indexname: string }>;
    expect(idx.map((i) => i.indexname)).toEqual(["uq_oauth_account_apple_subject", "uq_oauth_account_apple_user"]);

    const table = (await db.execute(sql`SELECT to_regclass('apple_revocation_retries') IS NOT NULL AS present`)) as unknown as Array<{ present: boolean }>;
    expect(table[0].present).toBe(true);
  });

  it("the previous server version keeps working: a Google link written without the new column, and repeated Google subjects, still insert", async () => {
    [{ id: userId }] = await db.insert(user).values({ userName: `${tag} User`, userEmail: `${tag}@it.test` }).returning({ id: user.userId });
    // Exactly the columns the previous version writes (see findOrCreateOAuthUser).
    await db.execute(sql`INSERT INTO oauth_account (user_id, oauth_provider, oauth_provider_id) VALUES (${userId}, 'google', ${tag})`);
    await db.execute(sql`INSERT INTO oauth_account (user_id, oauth_provider, oauth_provider_id) VALUES (${userId}, 'google', ${tag})`);
    const rows = await db.select().from(oauthAccount).where(eq(oauthAccount.userId, userId));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.providerRefreshTokenEnc === null)).toBe(true);
  });
});
