/**
 * @module scripts/seedE2eCiData
 *
 * Seeds the minimum a Playwright run needs into an EMPTY throwaway database (the
 * CI `e2e` job): the MFA-enabled E2E user (Administrator + Subscriber +
 * Operations Admin, like the dev account), one organisation and one HQ location
 * the user is assigned to. Specs create every other row (suppliers, ingredients,
 * pars, orders) through the API themselves.
 *
 * Refuses to run against anything but a localhost database, so it can never
 * touch the shared dev or the prod database. Run after `db:push` and `db:seed`:
 *
 *   E2E_USER_EMAIL=... E2E_USER_PASSWORD=... E2E_USER_TOTP_SECRET=... \
 *     pnpm --filter @culinaire/server exec tsx src/scripts/seedE2eCiData.ts
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix, isProductionProcess } = await import("../utils/envShim.js");
applyEnvPrefix();

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { role, user, userRole } from "../db/schema.js";
import { registerUser } from "../services/authService.js";
import { createOrganisation } from "../services/organisationService.js";
import { assignStaffToLocation, createStoreLocation } from "../services/storeLocationService.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function assertSeedAllowed(prod: boolean, databaseUrl: string | undefined): void {
  if (prod) throw new Error("Refusing to seed E2E data in a production process.");
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const host = new URL(databaseUrl).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to seed E2E data into non-local database host "${host}".`);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}

export async function seedE2eCiData(email: string, password: string, totpSecret: string) {
  const userId = await registerUser("E2E User", email, password);

  await db.update(user).set({ mfaEnabledInd: true, mfaSecret: totpSecret, updatedDttm: new Date() }).where(eq(user.userId, userId));

  const [admin] = await db.select({ roleId: role.roleId }).from(role).where(eq(role.roleName, "Administrator"));
  if (!admin) throw new Error("Administrator role not found. Run db:seed first.");
  await db.insert(userRole).values({ userId, roleId: admin.roleId });

  // Also grants Operations Admin and adds the user as an organisation admin.
  const org = await createOrganisation(userId, { name: "E2E Kitchen" });
  const location = await createStoreLocation(org.organisationId, { locationName: "E2E HQ", classification: "hq" }, userId);
  await assignStaffToLocation(location.storeLocationId, userId, userId);

  return { userId, organisationId: org.organisationId, storeLocationId: location.storeLocationId };
}

// Auto-run only when invoked directly (not when imported by a test).
if (process.argv[1]?.endsWith("seedE2eCiData.ts")) {
  (async () => {
    assertSeedAllowed(isProductionProcess(), process.env.DATABASE_URL);
    const seeded = await seedE2eCiData(
      requireEnv("E2E_USER_EMAIL"),
      requireEnv("E2E_USER_PASSWORD"),
      requireEnv("E2E_USER_TOTP_SECRET"),
    );
    console.log(`Seeded E2E data: user ${seeded.userId}, organisation ${seeded.organisationId}, location ${seeded.storeLocationId}`);
    process.exit(0);
  })().catch((err) => {
    console.error("E2E seed failed:", err);
    process.exit(1);
  });
}
