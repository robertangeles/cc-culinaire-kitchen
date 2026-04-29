/**
 * @module promptService
 *
 * Service layer for managing chatbot prompt templates (system prompts, etc.).
 *
 * Prompts are stored in the database with a default/custom distinction:
 * - `default_ind = true`  -- the original, immutable version shipped with the app.
 * - `default_ind = false` -- the user-edited (active) version used at runtime.
 *
 * When a prompt has not yet been customised, the service falls back to reading
 * the corresponding Markdown file under `prompts/chatbot/`. Gray-matter is used
 * to strip any YAML front-matter before returning the body.
 *
 * An in-memory cache avoids repeated DB round-trips for the hot-path
 * (`getSystemPrompt`) used on every chat request.
 */

import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { prompt, promptVersion } from "../db/schema.js";
import { createVersion } from "./promptVersionService.js";
import {
  PromptIsDeviceOnlyError,
  PromptNotFoundError,
  PromptNotDeviceRuntimeError,
} from "../errors/promptErrors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the directory containing prompt Markdown files. */
const PROMPTS_DIR = join(__dirname, "../../../../prompts/chatbot");

/** Cached prompt data (body + optional model override). */
interface CachedPrompt {
  body: string;
  modelId: string | null;
}

/** Simple in-memory cache keyed by prompt name. Invalidated on save. */
const cache = new Map<string, CachedPrompt>();

/**
 * Retrieve the active system prompt content for use in chat completions.
 *
 * Resolution order:
 * 1. In-memory cache
 * 2. Database (custom row where `default_ind = false`)
 * 3. Markdown file on disk (graceful fallback when DB is unavailable)
 *
 * @returns Object with the prompt body text and optional model override.
 */
export async function getSystemPrompt(): Promise<{ body: string; modelId: string | null }> {
  const cached = cache.get("systemPrompt");
  if (cached) return cached;

  try {
    const rows = await db
      .select({
        promptBody: prompt.promptBody,
        modelId: prompt.modelId,
        runtime: prompt.runtime,
        promptKey: prompt.promptKey,
      })
      .from(prompt)
      .where(
        and(eq(prompt.promptName, "systemPrompt"), eq(prompt.defaultInd, false))
      );

    if (rows.length > 0) {
      // Guard: refuse to invoke device-only prompts server-side. Throw before
      // caching so the cache never holds a body the server can't legally use.
      if (rows[0].runtime === "device") {
        throw new PromptIsDeviceOnlyError(rows[0].promptKey ?? "systemPrompt");
      }
      const result = { body: rows[0].promptBody, modelId: rows[0].modelId };
      cache.set("systemPrompt", result);
      return result;
    }
  } catch (err) {
    // Re-throw the typed device-only error so it surfaces through the error
    // handler. Other DB errors fall through to the file fallback.
    if (err instanceof PromptIsDeviceOnlyError) throw err;
    // DB not available — fall back to file
  }

  const body = await loadPromptFromFile("systemPrompt");
  return { body, modelId: null };
}

/**
 * Retrieve the raw prompt body for display in the admin/editor UI.
 *
 * Looks up the custom row first; falls back to the file-based version
 * if no custom row exists yet.
 *
 * @param name - Logical prompt identifier (e.g. `"systemPrompt"`).
 * @returns Object with the prompt body text and optional model override.
 */
export async function getPromptRaw(name: string): Promise<{ content: string; modelId: string | null }> {
  const rows = await db
    .select({
      promptBody: prompt.promptBody,
      modelId: prompt.modelId,
      runtime: prompt.runtime,
      promptKey: prompt.promptKey,
    })
    .from(prompt)
    .where(and(eq(prompt.promptName, name), eq(prompt.defaultInd, false)));

  if (rows.length > 0) {
    // Guard: refuse to hand a device-only prompt to a server-side caller.
    if (rows[0].runtime === "device") {
      throw new PromptIsDeviceOnlyError(rows[0].promptKey ?? name);
    }
    return { content: rows[0].promptBody, modelId: rows[0].modelId };
  }

  // Fall back to file if not yet in DB
  const content = await loadPromptFromFile(name);
  return { content, modelId: null };
}

/**
 * Admin-display variant of {@link getPromptRaw}: returns the prompt body
 * regardless of runtime, plus the runtime field itself so the admin UI can
 * render a different shell for on-device prompts (e.g. hide the model
 * dropdown, show a "this runs on the user's device" banner).
 *
 * Use this ONLY for admin-facing read paths (`GET /api/prompts/:name`).
 * Server-side prompt invocation must continue to use {@link getPromptRaw},
 * which guards against accidentally calling a device-only prompt.
 *
 * @param name - Logical prompt identifier (e.g. `"Antoine System Prompt"`).
 * @returns Prompt body, model override, runtime, and slug for admin rendering.
 */
export async function getPromptRawForAdmin(name: string): Promise<{
  content: string;
  modelId: string | null;
  runtime: "server" | "device";
  promptKey: string | null;
}> {
  const rows = await db
    .select({
      promptBody: prompt.promptBody,
      modelId: prompt.modelId,
      runtime: prompt.runtime,
      promptKey: prompt.promptKey,
    })
    .from(prompt)
    .where(and(eq(prompt.promptName, name), eq(prompt.defaultInd, false)));

  if (rows.length > 0) {
    return {
      content: rows[0].promptBody,
      modelId: rows[0].modelId,
      runtime: (rows[0].runtime === "device" ? "device" : "server"),
      promptKey: rows[0].promptKey,
    };
  }

  // Fall back to file if not yet in DB. File-backed prompts have no runtime
  // metadata; default to "server" since the file fallback only ever existed
  // for server-runtime prompts.
  const content = await loadPromptFromFile(name);
  return { content, modelId: null, runtime: "server", promptKey: null };
}

/**
 * Mobile prompt-fetch path: look up an on-device prompt by its slug
 * (`prompt_key`) and return everything the mobile client needs to run
 * inference locally and cache by version.
 *
 * Behavior:
 * - Resolves the **active** row only (`default_ind = false`) — the factory
 *   baseline is never exposed to mobile.
 * - Throws {@link PromptNotFoundError} if no row matches the slug.
 * - Throws {@link PromptNotDeviceRuntimeError} if the slug matches but its
 *   runtime is `'server'` — mobile clients must never receive server-runtime
 *   prompt bodies. The mapping to 404 (in the controller) deliberately does
 *   NOT reveal that the prompt exists, limiting reconnaissance.
 * - Joins `prompt_version` to surface the latest `version_number`. Mobile
 *   clients cache by version; when their cached version is older than the
 *   one returned here, they refetch.
 *
 * @param slug - The `prompt_key` value (e.g. `"antoine-system-prompt"`).
 * @returns The body, runtime, model id, version, slug, and last-updated timestamp.
 */
export async function getDevicePromptForMobile(slug: string): Promise<{
  promptKey: string;
  promptBody: string;
  runtime: "device";
  modelId: string | null;
  version: number;
  updatedAtDttm: Date;
}> {
  const rows = await db
    .select({
      promptId: prompt.promptId,
      promptKey: prompt.promptKey,
      promptBody: prompt.promptBody,
      modelId: prompt.modelId,
      runtime: prompt.runtime,
      updatedDttm: prompt.updatedDttm,
    })
    .from(prompt)
    .where(and(eq(prompt.promptKey, slug), eq(prompt.defaultInd, false)))
    .limit(1);

  if (rows.length === 0) {
    throw new PromptNotFoundError(slug);
  }

  const row = rows[0];
  if (row.runtime !== "device") {
    throw new PromptNotDeviceRuntimeError(slug);
  }

  // Latest version number — used by mobile clients to cache and decide
  // when to refetch. Falls back to 0 for prompts that somehow have no
  // version history (defensive; createPrompt always inserts version 1).
  const versions = await db
    .select({ versionNumber: promptVersion.versionNumber })
    .from(promptVersion)
    .where(eq(promptVersion.promptId, row.promptId))
    .orderBy(desc(promptVersion.versionNumber))
    .limit(1);

  const version = versions.length > 0 ? versions[0].versionNumber : 0;

  return {
    promptKey: row.promptKey ?? slug,
    promptBody: row.promptBody,
    runtime: "device",
    modelId: row.modelId,
    version,
    updatedAtDttm: row.updatedDttm,
  };
}

/**
 * Switch a prompt's runtime in place. Updates BOTH the active row
 * (`default_ind=false`) and the factory baseline (`default_ind=true`) in a
 * single transaction so they cannot drift out of sync — the factory row is
 * what "Reset to Default" restores, and a runtime mismatch there would
 * resurface the foot-gun this guard exists to prevent.
 *
 * Side effects:
 * - When switching TO `'device'`, `modelId` is force-cleared to `null` on
 *   both rows. A device-runtime prompt has no server-side model binding;
 *   keeping a stale `modelId` would mislead future readers.
 * - The in-memory prompt cache is invalidated for the prompt name.
 * - **Not done here:** notifying mobile clients that their cached body for
 *   a now-server-runtime slug will start returning 404. That's an inherent
 *   property of the toggle; document in the UI confirmation flow.
 *
 * @param name    - Prompt name (e.g. `"Antoine System Prompt"`).
 * @param runtime - New runtime. `'server'` or `'device'`.
 * @throws {Error} If no active row exists for the name.
 */
export async function setPromptRuntime(
  name: string,
  runtime: "server" | "device"
): Promise<void> {
  // Confirm a row exists before doing the dual-update so we can throw a
  // clear "not found" rather than silently update zero rows.
  const existing = await db
    .select({ promptId: prompt.promptId })
    .from(prompt)
    .where(and(eq(prompt.promptName, name), eq(prompt.defaultInd, false)))
    .limit(1);

  if (existing.length === 0) {
    throw new Error(`No active prompt found with name "${name}"`);
  }

  const updates: Record<string, unknown> = {
    runtime,
    updatedDttm: new Date(),
  };
  // Switching to device runtime: clear any leftover modelId on both rows.
  if (runtime === "device") {
    updates.modelId = null;
  }

  // Update both copies (active + factory) to keep them in sync. The
  // factory row's body never changes here — only its runtime/modelId.
  await db.update(prompt).set(updates).where(eq(prompt.promptName, name));

  // Invalidate the in-memory cache. The cache is keyed by name and only
  // populated by getSystemPrompt for "systemPrompt" — but invalidating
  // by name is harmless for any other prompt and future-proofs against
  // additional cache entries.
  cache.delete(name);
}

/**
 * Resolve a prompt name to the active (non-default) prompt's primary key.
 *
 * @param name - Logical prompt identifier.
 * @returns The `prompt_id` of the active row, or `null` if none exists.
 */
export async function getActivePromptId(
  name: string
): Promise<number | null> {
  const rows = await db
    .select({ promptId: prompt.promptId })
    .from(prompt)
    .where(and(eq(prompt.promptName, name), eq(prompt.defaultInd, false)));

  return rows.length > 0 ? rows[0].promptId : null;
}

/**
 * Persist prompt content to the database and invalidate the cache.
 *
 * If a custom row already exists it is updated in place; otherwise a new
 * row is inserted with `default_ind = false`. After saving, a version
 * snapshot is recorded for history / rollback.
 *
 * @param name    - Logical prompt identifier.
 * @param content - New prompt body text.
 * @param modelId - Optional model override (null = use global default).
 */
export async function savePrompt(
  name: string,
  content: string,
  modelId?: string | null
): Promise<void> {
  const existing = await db
    .select({ promptId: prompt.promptId })
    .from(prompt)
    .where(and(eq(prompt.promptName, name), eq(prompt.defaultInd, false)));

  let promptId: number;

  const updates: Record<string, unknown> = { promptBody: content, updatedDttm: new Date() };
  if (modelId !== undefined) updates.modelId = modelId;

  if (existing.length > 0) {
    promptId = existing[0].promptId;
    await db
      .update(prompt)
      .set(updates)
      .where(eq(prompt.promptId, promptId));
  } else {
    const inserted = await db
      .insert(prompt)
      .values({ promptName: name, promptBody: content, defaultInd: false, modelId: modelId ?? null })
      .returning({ promptId: prompt.promptId });
    promptId = inserted[0].promptId;
  }

  cache.delete(name);

  // Record a version snapshot for history / rollback
  await createVersion(promptId, content, modelId ?? null);
}

/**
 * Retrieve the factory-default prompt content.
 *
 * Used by {@link resetPrompt} to restore the original version. Reads from
 * the DB row where `default_ind = true`, falling back to the Markdown file.
 *
 * @param name - Logical prompt identifier.
 * @returns The default prompt body text.
 */
export async function getDefaultPrompt(name: string): Promise<string> {
  const rows = await db
    .select({ promptBody: prompt.promptBody })
    .from(prompt)
    .where(and(eq(prompt.promptName, name), eq(prompt.defaultInd, true)));

  if (rows.length > 0) return rows[0].promptBody;

  // Fall back to file
  return loadPromptFromFile(name);
}

/**
 * Reset a prompt to its factory-default content.
 *
 * Fetches the default body via {@link getDefaultPrompt}, writes it back
 * through {@link savePrompt} (which also invalidates the cache), and
 * returns the restored content.
 *
 * @param name - Logical prompt identifier.
 * @returns The restored default prompt body text.
 */
export async function resetPrompt(name: string): Promise<string> {
  const defaultContent = await getDefaultPrompt(name);
  await savePrompt(name, defaultContent, null);
  return defaultContent;
}

/**
 * List all active prompts (non-default copies) for the admin UI.
 *
 * Returns prompt metadata (id, name, key, timestamps) without the full
 * body to keep the response lightweight.
 *
 * @returns Array of prompt summary objects ordered by name.
 */
export async function listAllPrompts() {
  return db
    .select({
      promptId: prompt.promptId,
      promptName: prompt.promptName,
      promptKey: prompt.promptKey,
      modelId: prompt.modelId,
      updatedDttm: prompt.updatedDttm,
      createdDttm: prompt.createdDttm,
    })
    .from(prompt)
    .where(eq(prompt.defaultInd, false))
    .orderBy(prompt.promptName);
}

/**
 * Create a new prompt with both active and default (factory-baseline) copies.
 *
 * The `promptKey` is auto-generated from the name by converting to
 * lowercase kebab-case (e.g. "Technique Guide" → "technique-guide").
 *
 * @param name    - Human-readable prompt name.
 * @param body    - Initial prompt body text.
 * @returns The newly created active prompt row.
 * @throws {Error} If a prompt with the same key already exists.
 */
export async function createPrompt(
  name: string,
  body: string,
  modelId?: string | null,
  runtime: "server" | "device" = "server"
): Promise<{ promptId: number; promptName: string; promptKey: string | null }> {
  const key = name
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1-$2") // camelCase → kebab
    .replace(/[\s_]+/g, "-")
    .toLowerCase();

  // Check for duplicate key
  const existing = await db
    .select({ promptId: prompt.promptId })
    .from(prompt)
    .where(eq(prompt.promptKey, key));

  if (existing.length > 0) {
    throw new Error(`A prompt with key "${key}" already exists`);
  }

  // Device-runtime prompts are consumed by an on-device model; storing a
  // server-side modelId for them is meaningless and would mislead future
  // resolution code. Force null when runtime='device'.
  const persistedModelId = runtime === "device" ? null : (modelId ?? null);

  // Insert active copy
  const [active] = await db
    .insert(prompt)
    .values({
      promptName: name,
      promptKey: key,
      promptBody: body,
      defaultInd: false,
      modelId: persistedModelId,
      runtime,
    })
    .returning({ promptId: prompt.promptId, promptName: prompt.promptName, promptKey: prompt.promptKey });

  // Insert default/factory-baseline copy. Runtime stays in sync with the
  // active row — both rows always agree on runtime so the "Reset to Default"
  // flow can never produce a runtime mismatch.
  await db
    .insert(prompt)
    .values({ promptName: name, promptKey: key, promptBody: body, defaultInd: true, runtime });

  // Record initial version
  await createVersion(active.promptId, body, persistedModelId);

  return active;
}

/**
 * Load a prompt from its Markdown file on disk.
 *
 * Used as the final fallback when neither a custom nor default DB row
 * exists. Gray-matter strips any YAML front-matter before returning the
 * content body.
 *
 * @param name - Logical prompt identifier, used to resolve `{name}.md`.
 * @returns The trimmed Markdown body.
 */
async function loadPromptFromFile(name: string): Promise<string> {
  const filePath = join(PROMPTS_DIR, `${name}.md`);
  const raw = await readFile(filePath, "utf-8");
  const { content } = matter(raw);
  return content.trim();
}
