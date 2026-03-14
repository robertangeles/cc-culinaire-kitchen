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
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { prompt } from "../db/schema.js";
import { createVersion } from "./promptVersionService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the directory containing prompt Markdown files. */
const PROMPTS_DIR = join(__dirname, "../../../../prompts/chatbot");

/** Simple in-memory cache keyed by prompt name. Invalidated on save. */
const cache = new Map<string, string>();

/**
 * Retrieve the active system prompt content for use in chat completions.
 *
 * Resolution order:
 * 1. In-memory cache
 * 2. Database (custom row where `default_ind = false`)
 * 3. Markdown file on disk (graceful fallback when DB is unavailable)
 *
 * @returns The system prompt body text.
 */
export async function getSystemPrompt(): Promise<string> {
  const cached = cache.get("systemPrompt");
  if (cached) return cached;

  try {
    const rows = await db
      .select({ promptBody: prompt.promptBody })
      .from(prompt)
      .where(
        and(eq(prompt.promptName, "systemPrompt"), eq(prompt.defaultInd, false))
      );

    if (rows.length > 0) {
      cache.set("systemPrompt", rows[0].promptBody);
      return rows[0].promptBody;
    }
  } catch {
    // DB not available — fall back to file
  }

  return loadPromptFromFile("systemPrompt");
}

/**
 * Retrieve the raw prompt body for display in the admin/editor UI.
 *
 * Looks up the custom row first; falls back to the file-based version
 * if no custom row exists yet.
 *
 * @param name - Logical prompt identifier (e.g. `"systemPrompt"`).
 * @returns The prompt body text.
 */
export async function getPromptRaw(name: string): Promise<string> {
  const rows = await db
    .select({ promptBody: prompt.promptBody })
    .from(prompt)
    .where(and(eq(prompt.promptName, name), eq(prompt.defaultInd, false)));

  if (rows.length > 0) return rows[0].promptBody;

  // Fall back to file if not yet in DB
  return loadPromptFromFile(name);
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
 */
export async function savePrompt(
  name: string,
  content: string
): Promise<void> {
  const existing = await db
    .select({ promptId: prompt.promptId })
    .from(prompt)
    .where(and(eq(prompt.promptName, name), eq(prompt.defaultInd, false)));

  let promptId: number;

  if (existing.length > 0) {
    promptId = existing[0].promptId;
    await db
      .update(prompt)
      .set({ promptBody: content, updatedDttm: new Date() })
      .where(eq(prompt.promptId, promptId));
  } else {
    const inserted = await db
      .insert(prompt)
      .values({ promptName: name, promptBody: content, defaultInd: false })
      .returning({ promptId: prompt.promptId });
    promptId = inserted[0].promptId;
  }

  cache.delete(name);

  // Record a version snapshot for history / rollback
  await createVersion(promptId, content);
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
  await savePrompt(name, defaultContent);
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
  body: string
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

  // Insert active copy
  const [active] = await db
    .insert(prompt)
    .values({ promptName: name, promptKey: key, promptBody: body, defaultInd: false })
    .returning({ promptId: prompt.promptId, promptName: prompt.promptName, promptKey: prompt.promptKey });

  // Insert default/factory-baseline copy
  await db
    .insert(prompt)
    .values({ promptName: name, promptKey: key, promptBody: body, defaultInd: true });

  // Record initial version
  await createVersion(active.promptId, body);

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
