/**
 * @module modelOptionService
 *
 * Service layer for managing the admin-curated list of AI models.
 *
 * Models are sourced from OpenRouter's catalog (`/api/v1/models`) and
 * selectively enabled by the admin. Only enabled models appear in the
 * per-prompt model dropdown. Pricing and context-length metadata are
 * stored locally so the UI can display cost estimates without a live
 * API call on every page load.
 */

import { eq, asc, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { modelOption } from "../db/schema.js";
import pino from "pino";

const logger = pino({ name: "modelOptionService" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape returned by OpenRouter's GET /api/v1/models endpoint. */
interface OpenRouterModel {
  id: string;
  name: string;
  context_length?: number;
  pricing?: {
    prompt?: string;   // cost per token as string
    completion?: string;
  };
}

/** Normalised model info returned to callers. */
export interface ModelInfo {
  modelOptionId: number;
  modelId: string;
  displayName: string;
  provider: string;
  category: string;
  contextLength: number | null;
  inputCostPerM: string | null;
  outputCostPerM: string | null;
  sortOrder: number;
  enabledInd: boolean;
}

// ---------------------------------------------------------------------------
// OpenRouter catalog fetch
// ---------------------------------------------------------------------------

/**
 * Fetch all available models from the OpenRouter catalog.
 *
 * Parses pricing from per-token to per-1M-tokens for readability.
 * Returns a flat array suitable for the "Browse Models" UI.
 */
export async function fetchOpenRouterModels(): Promise<
  Array<{
    modelId: string;
    displayName: string;
    provider: string;
    contextLength: number | null;
    inputCostPerM: string | null;
    outputCostPerM: string | null;
  }>
> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.CLIENT_URL ?? "http://localhost:5179",
      "X-Title": "CulinAIre Kitchen",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter /models returned ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { data: OpenRouterModel[] };

  return data.data.map((m) => {
    const provider = m.id.includes("/") ? m.id.split("/")[0] : "unknown";
    const perTokenToPerM = (val?: string) => {
      if (!val) return null;
      const n = parseFloat(val);
      if (isNaN(n)) return null;
      return (n * 1_000_000).toFixed(4);
    };

    return {
      modelId: m.id,
      displayName: m.name || m.id,
      provider,
      contextLength: m.context_length ?? null,
      inputCostPerM: perTokenToPerM(m.pricing?.prompt),
      outputCostPerM: perTokenToPerM(m.pricing?.completion),
    };
  });
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * List only enabled models, sorted by sort_order then display_name.
 * Used by the per-prompt model dropdown.
 */
export async function listEnabledModels(
  category?: string
): Promise<ModelInfo[]> {
  const rows = await db
    .select()
    .from(modelOption)
    .where(eq(modelOption.enabledInd, true))
    .orderBy(asc(modelOption.sortOrder), asc(modelOption.displayName));

  const result = rows.map(mapRow);
  if (category) return result.filter((r) => r.category === category);
  return result;
}

/**
 * List all models (enabled + disabled) for the admin Model Registry.
 */
export async function listAllModels(): Promise<ModelInfo[]> {
  const rows = await db
    .select()
    .from(modelOption)
    .orderBy(asc(modelOption.sortOrder), asc(modelOption.displayName));

  return rows.map(mapRow);
}

/**
 * Enable (add) a model from the OpenRouter catalog.
 * Upserts — if the model_id already exists, re-enables and updates metadata.
 */
export async function enableModel(params: {
  modelId: string;
  displayName: string;
  provider: string;
  category?: string;
  contextLength?: number | null;
  inputCostPerM?: string | null;
  outputCostPerM?: string | null;
}): Promise<ModelInfo> {
  // Check if it already exists
  const existing = await db
    .select()
    .from(modelOption)
    .where(eq(modelOption.modelId, params.modelId));

  if (existing.length > 0) {
    // Re-enable and update metadata
    await db
      .update(modelOption)
      .set({
        displayName: params.displayName,
        provider: params.provider,
        category: params.category ?? "chat",
        contextLength: params.contextLength ?? null,
        inputCostPerM: params.inputCostPerM ?? null,
        outputCostPerM: params.outputCostPerM ?? null,
        enabledInd: true,
        updatedDttm: new Date(),
      })
      .where(eq(modelOption.modelOptionId, existing[0].modelOptionId));

    const [updated] = await db
      .select()
      .from(modelOption)
      .where(eq(modelOption.modelOptionId, existing[0].modelOptionId));
    return mapRow(updated);
  }

  // Determine next sort order
  const maxSort = await db
    .select({ sortOrder: modelOption.sortOrder })
    .from(modelOption)
    .orderBy(desc(modelOption.sortOrder))
    .limit(1);
  const nextSort = maxSort.length > 0 ? maxSort[0].sortOrder + 1 : 0;

  const [inserted] = await db
    .insert(modelOption)
    .values({
      modelId: params.modelId,
      displayName: params.displayName,
      provider: params.provider,
      category: params.category ?? "chat",
      contextLength: params.contextLength ?? null,
      inputCostPerM: params.inputCostPerM ?? null,
      outputCostPerM: params.outputCostPerM ?? null,
      sortOrder: nextSort,
      enabledInd: true,
    })
    .returning();

  logger.info({ modelId: params.modelId }, "Model enabled");
  return mapRow(inserted);
}

/**
 * Soft-disable a model (set enabled_ind = false).
 */
export async function disableModel(modelOptionId: number): Promise<void> {
  await db
    .update(modelOption)
    .set({ enabledInd: false, updatedDttm: new Date() })
    .where(eq(modelOption.modelOptionId, modelOptionId));

  logger.info({ modelOptionId }, "Model disabled");
}

/**
 * Update the sort order of a model.
 */
export async function updateModelSort(
  modelOptionId: number,
  sortOrder: number
): Promise<void> {
  await db
    .update(modelOption)
    .set({ sortOrder, updatedDttm: new Date() })
    .where(eq(modelOption.modelOptionId, modelOptionId));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapRow(row: typeof modelOption.$inferSelect): ModelInfo {
  return {
    modelOptionId: row.modelOptionId,
    modelId: row.modelId,
    displayName: row.displayName,
    provider: row.provider,
    category: row.category,
    contextLength: row.contextLength,
    inputCostPerM: row.inputCostPerM,
    outputCostPerM: row.outputCostPerM,
    sortOrder: row.sortOrder,
    enabledInd: row.enabledInd,
  };
}
