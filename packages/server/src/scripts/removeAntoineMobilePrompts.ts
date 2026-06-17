/**
 * @module scripts/removeAntoineMobilePrompts
 *
 * One-shot: delete the two on-device Antoine prompts that are no longer
 * consumed by the mobile app. Mobile pivoted to server-side chat on
 * 2026-06-15 (see shared-context/mobile-needs.md and decisions.md), so
 * the on-device `antoine-system-prompt` (EN) and `antoine-system-prompt-fr`
 * (FR placeholder) are dead rows.
 *
 * What it does (atomic per key):
 *   1. Find every `prompt` row for the key — both the active (default_ind=false)
 *      and factory baseline (default_ind=true) copies.
 *   2. Delete every linked `prompt_version` row by prompt_id.
 *   3. Delete the `prompt` rows themselves.
 *
 * Idempotent: re-running after a successful run finds nothing to delete
 * and exits cleanly.
 *
 * Run once:
 *   pnpm --filter @culinaire/server tsx src/scripts/removeAntoineMobilePrompts.ts
 *
 * After it succeeds, delete this script in the same commit — it has no
 * reason to exist beyond the one-time cleanup.
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });

import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { prompt, promptVersion } from "../db/schema.js";

const KEYS_TO_REMOVE = ["antoine-system-prompt", "antoine-system-prompt-fr"];

async function removeOne(key: string): Promise<void> {
  const rows = await db
    .select({ promptId: prompt.promptId, defaultInd: prompt.defaultInd })
    .from(prompt)
    .where(eq(prompt.promptKey, key));

  if (rows.length === 0) {
    console.log(`[remove-antoine] ${key}: not found (already gone) — skipping.`);
    return;
  }

  const promptIds = rows.map((r) => r.promptId);

  const deletedVersions = await db
    .delete(promptVersion)
    .where(inArray(promptVersion.promptId, promptIds))
    .returning({ versionId: promptVersion.versionId });

  const deletedPrompts = await db
    .delete(prompt)
    .where(eq(prompt.promptKey, key))
    .returning({ promptId: prompt.promptId, defaultInd: prompt.defaultInd });

  console.log(
    `[remove-antoine] ${key}: deleted ${deletedPrompts.length} prompt row(s) (${
      deletedPrompts.filter((r) => r.defaultInd).length
    } factory, ${deletedPrompts.filter((r) => !r.defaultInd).length} active) and ${deletedVersions.length} version row(s).`,
  );
}

async function main(): Promise<void> {
  for (const key of KEYS_TO_REMOVE) {
    await removeOne(key);
  }
  console.log("[remove-antoine] done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[remove-antoine] FAILED:", err);
    process.exit(1);
  });
