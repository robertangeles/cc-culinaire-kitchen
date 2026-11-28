/**
 * @module scripts/seedReviewerDemo
 *
 * The App Store and Google Play reviewer's accounts: two verified users with a password, no MFA, both admins of a small
 * organisation of their own with one location, three storage areas holding eleven items (butter is in two areas), and a stock take open by
 * area, so the reviewer can sign in on the phone and count straight away. Both accounts have messages in the kitchen's Bench
 * room, so whichever one the reviewer signs in with has a message to report and a person to block. Neither holds bench:moderate. Owner-run. Safe to run
 * again: it reuses what exists and only adds what is missing (if the reviewer deleted an account, as Apple's review does, it
 * makes a new one in the same kitchen).
 *
 * Against anything but a local database it refuses unless you name that database's host with --confirm-host, so
 * seeding production is always a deliberate act. The passwords come from the environment and are never printed.
 *
 *   REVIEWER_DEMO_EMAIL=reviewer@your-domain REVIEWER_DEMO_PASSWORD=... \
 *   REVIEWER_DEMO_EMAIL_2=reviewer2@your-domain REVIEWER_DEMO_PASSWORD_2=... \
 *     pnpm --filter @culinaire/server exec tsx src/scripts/seedReviewerDemo.ts [--confirm-host <database host>]
 *
 * Production needs APP_ENV=prod with the PROD_ variables in .env, like the other owner-run scripts.
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

import { and, eq, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { benchMessage, kitchenProfile, storeLocation, user, userOrganisation, userStoreLocation } from "../db/schema.js";
import { registerUser } from "../services/authService.js";
import { hashForLookup } from "../services/piiService.js";
import { createIngredient } from "../services/ingredientCatalogService.js";
import { createOrganisation, getMembership, getUserOrganisation, grantOperationsAdminRole } from "../services/organisationService.js";
import { assignStaffToLocation, createStoreLocation } from "../services/storeLocationService.js";
import { getUserLocationContext } from "../services/locationContextService.js";
import { createArea, listAreas, setAreaItems } from "../services/storageAreaService.js";
import { openSession } from "../services/stockTakeSessionService.js";
import { createMessage, getOrCreateOrgChannel } from "../services/benchService.js";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export const DEMO_ORGANISATION = "CulinAIre Demo Kitchen";
export const DEMO_LOCATION = "Demo Kitchen";

/**
 * Area name, then its items: name, category, unit, unit cost. The names are three of the four areas a new location starts with.
 * Butter sits in two areas, so the phone shows its shared-item marker.
 */
export const DEMO_AREAS: Array<{ area: string; items: Array<[string, string, string, string]> }> = [
  { area: "Dry Storage", items: [["Plain flour", "dry_goods", "kg", "1.20"], ["Caster sugar", "dry_goods", "kg", "1.80"], ["Arborio rice", "dry_goods", "kg", "3.40"], ["Sea salt", "dry_goods", "kg", "2.10"]] },
  { area: "Cool Room", items: [["Butter", "dairy", "kg", "11.50"], ["Cream", "dairy", "L", "5.20"], ["Free-range eggs", "dairy", "dozen", "6.40"], ["Chicken thigh", "proteins", "kg", "9.80"]] },
  { area: "Freezer", items: [["Butter", "dairy", "kg", "11.50"], ["Frozen peas", "frozen", "kg", "3.10"], ["Vanilla ice cream", "frozen", "L", "7.60"], ["King prawns", "frozen", "kg", "24.00"]] },
];

/** Made up and harmless: the first account's post in the kitchen's Bench room, for the reviewer on the second account to report or block. */
export const DEMO_FIRST_BENCH_MESSAGES = ["Welcome to the demo kitchen. Stock counts are open by area today."];

/** Made up and harmless: the second account's posts in the kitchen's Bench room, for the reviewer to report or block. */
export const DEMO_BENCH_MESSAGES = [
  "Morning all. The Cool Room is restocked; butter is on the second shelf.",
  "Could someone count the Freezer before lunch service?",
  "The prawns arrive on Thursday this week, not Wednesday.",
];

export type DemoAccount = { email: string; password: string };

/** Refuses a database that is not local unless the person named its host on purpose. */
export function assertDemoSeedAllowed(databaseUrl: string | undefined, confirmHost: string | undefined): string {
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const host = new URL(databaseUrl).hostname;
  if (!LOCAL_HOSTS.has(host) && confirmHost !== host) {
    throw new Error(`This database is "${host}", which is not local. To seed it on purpose, run again with --confirm-host ${host}`);
  }
  return host;
}

/** Both accounts from REVIEWER_DEMO_EMAIL / _PASSWORD and REVIEWER_DEMO_EMAIL_2 / _PASSWORD_2. */
export function demoAccountsFrom(env: Record<string, string | undefined>): [DemoAccount, DemoAccount] {
  const [first, second] = ["", "_2"].map((n) => {
    const email = env[`REVIEWER_DEMO_EMAIL${n}`];
    const password = env[`REVIEWER_DEMO_PASSWORD${n}`];
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`REVIEWER_DEMO_EMAIL${n} must be an email address.`);
    if (!password || password.length < 12) throw new Error(`REVIEWER_DEMO_PASSWORD${n} must be at least 12 characters.`);
    return { email, password };
  });
  if (first.email.toLowerCase() === second.email.toLowerCase()) throw new Error("REVIEWER_DEMO_EMAIL_2 must differ from REVIEWER_DEMO_EMAIL.");
  return [first, second];
}

async function findUser(email: string) {
  const [row] = await db
    .select({ userId: user.userId, userStatus: user.userStatus })
    .from(user)
    .where(or(eq(user.userEmailHash, hashForLookup(email)), eq(user.userEmail, email.toLowerCase())));
  return row && row.userStatus !== "deleted" ? row : null;
}

async function findOrMakeUser(name: string, { email, password }: DemoAccount) {
  const existing = await findUser(email);
  if (existing) return existing.userId;
  const userId = await registerUser(name, email, password);
  // The owner's own address cannot receive the verification email a store reviewer would need.
  await db.update(user).set({ emailVerifiedInd: true, updatedDttm: new Date() }).where(eq(user.userId, userId));
  await db.insert(kitchenProfile).values({ userId, onboardingDoneInd: true });
  return userId;
}

export async function seedReviewerDemo(firstAccount: DemoAccount, secondAccount: DemoAccount) {
  const userId = await findOrMakeUser("App Review", firstAccount);
  const secondUserId = await findOrMakeUser("Demo Cook", secondAccount);

  // A kitchen that lost one account (the reviewer deleted it) is found through the other. Creating one makes the reviewer its
  // admin with the Operations Admin role: they can count, and nothing needs approving by anyone else.
  const org = (await getUserOrganisation(userId)) ?? (await getUserOrganisation(secondUserId)) ?? (await createOrganisation(userId, { name: DEMO_ORGANISATION }));
  const organisationId = org.organisationId;
  // Both are admins: account deletion refuses the only admin of a kitchen that has other members.
  for (const id of [userId, secondUserId]) {
    if (!(await getMembership(id, organisationId))) await db.insert(userOrganisation).values({ userId: id, organisationId, role: "admin" });
  }
  await grantOperationsAdminRole(userId);

  let [location] = await db.select().from(storeLocation).where(eq(storeLocation.organisationId, organisationId));
  if (!location) {
    location = await createStoreLocation(organisationId, { locationName: DEMO_LOCATION, classification: "hq" }, userId) as typeof location;
  }
  const storeLocationId = location.storeLocationId;
  for (const id of [userId, secondUserId]) {
    const [assigned] = await db.select({ id: userStoreLocation.userStoreLocationId }).from(userStoreLocation).where(eq(userStoreLocation.userId, id));
    if (!assigned) await assignStaffToLocation(storeLocationId, id, userId);
  }
  // A regular stock take refuses to open until opening inventory is done.
  await db.update(storeLocation).set({ inventoryActive: true }).where(eq(storeLocation.storeLocationId, storeLocationId));

  // A new location starts with default areas, all empty. Open sessions lock the area lists, so items are only assigned while none holds any.
  const areas = await listAreas(storeLocationId, organisationId);
  if (areas.every((a) => a.itemCount === 0)) {
    const itemIds = new Map<string, string>();
    for (const { area, items } of DEMO_AREAS) {
      const target = areas.find((a) => a.areaName === area) ?? (await createArea(storeLocationId, organisationId, area));
      const assignments = [];
      for (const [name, category, unit, cost] of items) {
        let id = itemIds.get(name);
        if (!id) {
          id = (await createIngredient(organisationId, { ingredientName: name, ingredientCategory: category, baseUnit: unit, unitCost: cost })).ingredientId;
          itemIds.set(name, id);
        }
        assignments.push({ ingredientId: id });
      }
      await setAreaItems(target.storageAreaId, organisationId, assignments);
    }
  }

  let opened = false;
  try {
    await openSession(storeLocationId, organisationId, userId, DEMO_AREAS.map((a) => a.area), "AREA");
    opened = true;
  } catch (err) {
    // One already open (a rerun) is the state we want; anything else is a real failure.
    if (!/already/i.test(err instanceof Error ? err.message : "")) throw err;
  }

  // The kitchen's Bench room is open to its members; a message the reviewer deleted is posted again.
  const room = await getOrCreateOrgChannel(organisationId, org.organisationName);
  let benchMessagesPosted = 0;
  for (const [authorId, messages] of [[userId, DEMO_FIRST_BENCH_MESSAGES], [secondUserId, DEMO_BENCH_MESSAGES]] as const) {
    const posted = await db
      .select({ body: benchMessage.messageBody })
      .from(benchMessage)
      .where(and(eq(benchMessage.channelId, room.channelId), eq(benchMessage.userId, authorId), eq(benchMessage.deletedInd, false)));
    for (const body of messages) {
      if (posted.some((p) => p.body === body)) continue;
      await createMessage(room.channelId, authorId, body);
      benchMessagesPosted++;
    }
  }

  const context = await getUserLocationContext(userId);
  return { userId, secondUserId, organisationId, storeLocationId, openedStockTake: opened, benchMessagesPosted, locationsSeenByPhone: context.locations.length };
}

// Auto-run only when invoked directly (not when imported by a test).
if (process.argv[1]?.endsWith("seedReviewerDemo.ts")) {
  (async () => {
    const flag = process.argv.indexOf("--confirm-host");
    const host = assertDemoSeedAllowed(process.env.DATABASE_URL, flag > -1 ? process.argv[flag + 1] : undefined);
    const [first, second] = demoAccountsFrom(process.env);
    console.log(`Seeding the reviewer demo accounts into database host "${host}"...`);
    const out = await seedReviewerDemo(first, second);
    console.log(`Done: users ${out.userId} and ${out.secondUserId}, organisation ${out.organisationId}, location ${out.storeLocationId}, new stock take opened: ${out.openedStockTake}, Bench messages posted: ${out.benchMessagesPosted}.`);
    console.log("Sign in on the phone with REVIEWER_DEMO_EMAIL and REVIEWER_DEMO_PASSWORD, then put both accounts in the store review notes.");
    process.exit(0);
  })().catch((err) => {
    console.error("Reviewer demo seed failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
