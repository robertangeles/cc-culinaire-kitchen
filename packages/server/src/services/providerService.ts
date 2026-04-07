/**
 * @module providerService
 *
 * AI provider abstraction layer — routes all LLM and embedding traffic
 * through OpenRouter (https://openrouter.ai), a unified AI gateway with
 * an OpenAI-compatible API.
 *
 * Architecture:
 *
 *   ┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
 *   │  aiService   │────▶│ providerService  │────▶│   OpenRouter    │
 *   │              │     │  getModel()      │     │  (unified API)  │
 *   │              │     │  getWebSearch()  │     │ ─▶ Claude       │
 *   │              │     │  getEmbedding()  │     │ ─▶ GPT-4o       │
 *   └─────────────┘     └──────────────────┘     │ ─▶ Sonar        │
 *   ┌─────────────────┐          │               │ ─▶ Embeddings   │
 *   │knowledgeService │──────────┘               └─────────────────┘
 *   └─────────────────┘
 *
 * Model IDs use OpenRouter format: "provider/model-name"
 * (e.g. "anthropic/claude-sonnet-4-20250514", "openai/gpt-4o").
 *
 * A fresh provider instance is created on every call so that credential
 * changes via the Integrations panel take effect immediately without
 * requiring a server restart or cache invalidation.
 */

import { createOpenAI } from "@ai-sdk/openai";

/** Default chat model (OpenRouter format). */
const DEFAULT_MODEL = "anthropic/claude-sonnet-4-20250514";

/** Default web-search-capable model. */
const DEFAULT_WEB_SEARCH_MODEL = "perplexity/sonar-pro";

/** Embedding model — hardcoded because changing it requires re-embedding
 *  all knowledge chunks (dimension mismatch with existing pgvector data). */
const EMBEDDING_MODEL = "openai/text-embedding-3-small";

/**
 * Create a fresh OpenRouter-backed provider instance.
 * Reads OPENROUTER_API_KEY from process.env (hydrated from DB at startup
 * via {@link module:credentialService.hydrateEnvFromCredentials}).
 */
function getOpenRouterProvider() {
  return createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    headers: {
      "HTTP-Referer": process.env.CLIENT_URL ?? "http://localhost:5179",
      "X-Title": "CulinAIre Kitchen",
    },
  });
}

/**
 * Build and return the configured LLM model instance via OpenRouter.
 * Model ID comes from AI_MODEL env/credential, defaulting to Claude Sonnet.
 */
/**
 * Ensure a model ID is in OpenRouter format (provider/model).
 * If no slash is present, assumes Anthropic (e.g. "claude-sonnet-4-6"
 * becomes "anthropic/claude-sonnet-4-6"). This handles legacy DB values
 * that were stored before the OpenRouter migration.
 */
function normalizeModelId(id: string): string {
  return id.includes("/") ? id : `anthropic/${id}`;
}

export function getModel() {
  const modelId = normalizeModelId(process.env.AI_MODEL ?? DEFAULT_MODEL);
  return getOpenRouterProvider()(modelId);
}

/**
 * Return a web-search-capable model (e.g., Perplexity Sonar) via OpenRouter.
 *
 * When web search is enabled, aiService swaps to this model instead of
 * the default chat model. Knowledge base tools are stripped — the web
 * search model uses only its built-in web grounding.
 *
 * @param modelId - Optional override from site settings (web_search_model).
 */
export function getWebSearchModel(modelId?: string) {
  const id = modelId ?? process.env.WEB_SEARCH_MODEL ?? DEFAULT_WEB_SEARCH_MODEL;
  return getOpenRouterProvider()(id);
}

/**
 * Return an embedding model instance via OpenRouter.
 * Used by knowledgeService for vector embeddings (1536 dimensions).
 */
export function getEmbeddingModel() {
  return getOpenRouterProvider().embedding(EMBEDDING_MODEL);
}
