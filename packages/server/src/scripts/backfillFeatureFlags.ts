/**
 * @module scripts/backfillFeatureFlags
 *
 * One-time rollout helper, prod-only in practice, for the `compliance_enabled`
 * feature flag added retroactively to a feature that has been live in
 * production since before this flag existed.
 *
 * `seed.ts`'s settings loop is existence-check-only: it inserts a row only if
 * the key is entirely absent, and never touches a key that's already there.
 * That's the right default for every other setting in that list, but it's
 * exactly wrong here — if this repo's `db:seed` has EVER run against prod
 * before this flag existed (it has; `db:seed` is a routinely-run command for
 * permission backfills, not a first-install-only script), `compliance_enabled`
 * is either already correctly absent (seed.ts will insert "true" next run,
 * fine) or, if some other path inserted it as "false" first, seed.ts will
 * never correct it — and the enforcing `requireFlag("compliance_enabled")`
 * middleware would then 404 a feature real users are actively using.
 *
 * This script is the explicit, unconditional fix for that one key: it forces
 * `compliance_enabled` to "true" regardless of its current value or absence,
 * and does nothing else. `roster_enabled` / `workforce_enabled` need no
 * equivalent — they seed "false" correctly via the ordinary seed.ts path,
 * since neither feature has ever shipped.
 *
 * Idempotent: safe to run any number of times, including on a database where
 * `compliance_enabled` is already "true".
 *
 * Run once, before (or immediately alongside) deploying requireFlag's retrofit
 * onto routes/compliance.ts:
 *   APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/backfillFeatureFlags.ts
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { siteSetting } from "../db/schema.js";

export type FlagAction =
  | { kind: "insert" }
  | { kind: "correct"; from: string }
  | { kind: "noop" };

/**
 * Pure decision: given the row's current value (or `undefined` if the row
 * doesn't exist at all), what does this script need to do to reach "true"?
 * Extracted so idempotency is unit-testable without a database — mirrors
 * backfillNavPermissions.ts's computeMissingLinks, which the sibling
 * backfillCompliancePermissions.ts notably skipped.
 */
export function decideFlagAction(currentValue: string | undefined): FlagAction {
  if (currentValue === undefined) return { kind: "insert" };
  if (currentValue === "true") return { kind: "noop" };
  return { kind: "correct", from: currentValue };
}

async function main(): Promise<void> {
  const existing = await db
    .select({ value: siteSetting.settingValue })
    .from(siteSetting)
    .where(eq(siteSetting.settingKey, "compliance_enabled"));

  const action = decideFlagAction(existing[0]?.value);

  switch (action.kind) {
    case "insert":
      await db.insert(siteSetting).values({ settingKey: "compliance_enabled", settingValue: "true" });
      console.log("Inserted compliance_enabled = true (row did not exist)");
      return;
    case "noop":
      console.log("compliance_enabled already true — nothing to do");
      return;
    case "correct":
      await db
        .update(siteSetting)
        .set({ settingValue: "true", updatedDttm: new Date() })
        .where(eq(siteSetting.settingKey, "compliance_enabled"));
      console.log(`Corrected compliance_enabled: "${action.from}" -> "true"`);
      return;
  }
}

if (process.argv[1]?.endsWith("backfillFeatureFlags.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Backfill failed:", err);
      process.exit(1);
    });
}
