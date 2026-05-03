/**
 * @module scripts/createFrPlaceholderPrompt
 *
 * One-shot: create the FR placeholder Antoine system prompt requested by the
 * mobile session in shared-context/mobile-needs.md (2026-05-03 URGENT entry).
 *
 * What it does:
 *   - Reads the current EN antoine-system-prompt body from the DB.
 *   - Wraps it with a `[PLACEHOLDER — pending culinary review,
 *     not production-ready]` marker as the first line per the spec.
 *   - Creates a new device-runtime prompt with key `antoine-system-prompt-fr`
 *     via createPrompt() so version + factory-baseline rows are inserted
 *     correctly.
 *   - Idempotent: re-running detects the existing row by key and exits.
 *
 * Run:  pnpm --filter @culinaire/server tsx src/scripts/createFrPlaceholderPrompt.ts
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { prompt } from "../db/schema.js";
import { createPrompt } from "../services/promptService.js";

const FR_KEY = "antoine-system-prompt-fr";
const EN_KEY = "antoine-system-prompt";
const FR_NAME = "Antoine System Prompt FR";
const PLACEHOLDER_HEADER =
  "[PLACEHOLDER — pending culinary review, not production-ready]";

async function main(): Promise<void> {
  // Idempotency check: bail if the FR slug already exists.
  const existing = await db
    .select({ promptId: prompt.promptId, defaultInd: prompt.defaultInd })
    .from(prompt)
    .where(eq(prompt.promptKey, FR_KEY));
  if (existing.length > 0) {
    console.log(`[fr-placeholder] ${FR_KEY} already exists (${existing.length} row(s)) — nothing to do.`);
    process.exit(0);
  }

  // Pull the current EN body. We deliberately use the active (admin-edited)
  // copy — that's what mobile is currently consuming for EN, and it's the
  // closest thing to "what the placeholder is approximating."
  const enRows = await db
    .select({ promptBody: prompt.promptBody })
    .from(prompt)
    .where(eq(prompt.promptKey, EN_KEY));
  const enActive = enRows[0];
  if (!enActive) {
    throw new Error(
      `Cannot find EN base prompt with key "${EN_KEY}". Aborting; nothing was inserted.`,
    );
  }

  // Per the spec, machine-translation of the EN body is acceptable. We do not
  // run an actual MT pipeline from this script — we simply ship the EN body
  // verbatim under the placeholder header. The mark on line 1 ensures no
  // downstream reader can mistake it for the authored translation, and the
  // language picker test paths described in mobile-needs.md only require the
  // slug to resolve, not for the body to be in fluent FR.
  const placeholderBody = `${PLACEHOLDER_HEADER}\n\n${enActive.promptBody}`;

  console.log(`[fr-placeholder] inserting ${FR_KEY} (device runtime, ${placeholderBody.length} chars)…`);
  const created = await createPrompt(FR_NAME, placeholderBody, null, "device");
  if (created.promptKey !== FR_KEY) {
    throw new Error(
      `[fr-placeholder] createPrompt derived key "${created.promptKey}" but mobile expects "${FR_KEY}". Aborting after partial insert — investigate name-to-key derivation in promptService.createPrompt.`,
    );
  }
  console.log(`[fr-placeholder] inserted prompt_id=${created.promptId} prompt_key=${created.promptKey}`);
  console.log("[fr-placeholder] done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[fr-placeholder] FAILED:", err);
    process.exit(1);
  });
