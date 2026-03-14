/**
 * @module aiService
 *
 * AI/LLM integration service for the CulinAIre Kitchen culinary chatbot.
 *
 * This service is the core orchestration layer between the chat API and the
 * language model. It constructs prompts, configures tool-use capabilities
 * (knowledge-base search and document retrieval), and streams LLM responses
 * back to the client over an HTTP response.
 *
 * The service deliberately keeps all LLM interaction behind a single entry
 * point (`streamChat`) so that routes and controllers never call LLM APIs
 * directly, in line with the project's separation-of-concerns rules.
 */

import { streamText, tool, type CoreMessage } from "ai";
import type { Response } from "express";
import { z } from "zod";
import { getModel, getProviderName } from "./providerService.js";
import { getSystemPrompt } from "./promptService.js";
import { searchKnowledge, readKnowledgeFile } from "./knowledgeService.js";
import { getAllSettings } from "./settingsService.js";
import pino from "pino";

const logger = pino({ name: "aiService" });

/**
 * Stream an AI-generated chat response to the client.
 *
 * Loads the system prompt, resolves the configured LLM provider/model, and
 * initiates a streaming text generation request that is piped directly to
 * the Express response. The model is given two tools it may invoke
 * autonomously during generation:
 *
 * - **searchKnowledge** — searches the curated knowledge base for relevant
 *   culinary reference material (techniques, ingredients, pastry, spirits).
 * - **readKnowledgeDocument** — reads the full content of a specific
 *   knowledge-base document identified by a prior search result.
 * - **web_search** (optional, Anthropic only) — Anthropic's built-in
 *   `web_search_20250305` server tool, enabled via the `web_search_enabled`
 *   site setting. When active, the model may search the web for current
 *   information beyond its training data and the local knowledge base.
 *
 * Up to three tool-use steps are allowed per request (five when web search
 * is enabled), giving the model room to search, read, and respond.
 *
 * @param {CoreMessage[]} messages - The conversation history in Vercel AI SDK
 *   `CoreMessage` format (each entry has a `role` and `content`).
 * @param {Response} res - The Express response object. The streaming data
 *   will be piped directly into this response; callers should **not** send
 *   additional data after invoking this function.
 * @returns {Promise<void>} Resolves once the stream setup is complete. The
 *   actual response data continues to flow asynchronously via the stream.
 * @throws {Error} If the system prompt cannot be loaded.
 */
export interface ChatOptions {
  /** When true, enable web search for this request (requires global setting). */
  webSearch?: boolean;
}

export async function streamChat(
  messages: CoreMessage[],
  res: Response,
  options: ChatOptions = {}
): Promise<void> {
  let systemPrompt: string;
  try {
    systemPrompt = await getSystemPrompt();
  } catch (err) {
    logger.error({ err }, "Failed to load system prompt");
    throw err;
  }

  // Web search requires both the global admin setting AND a per-request toggle.
  const settings = await getAllSettings();
  const webSearchEnabled =
    settings.web_search_enabled === "true" &&
    options.webSearch === true &&
    getProviderName() === "anthropic";

  const model = getModel({ webSearch: webSearchEnabled });

  const result = streamText({
    model,
    system: systemPrompt,
    messages,
    /**
     * Tools available to the LLM during generation.
     *
     * These give the model the ability to query the curated culinary
     * knowledge base in a two-step pattern: first search for relevant
     * documents, then read a specific document for full detail.
     */
    tools: {
      /**
       * **searchKnowledge** — Searches the culinary knowledge base by
       * query string, optionally scoped to a category (techniques,
       * pastry, spirits, or ingredients). Returns formatted snippets
       * with file paths the model can pass to `readKnowledgeDocument`.
       */
      searchKnowledge: tool({
        description:
          "Search the culinary knowledge base for reference material on techniques, ingredients, pastry, or spirits. Use this when you need detailed procedural information or specific ratios beyond your core knowledge.",
        parameters: z.object({
          query: z.string().describe("The search query"),
          category: z
            .enum(["techniques", "pastry", "spirits", "ingredients"])
            .optional()
            .describe("Optional category to narrow the search"),
        }),
        execute: async ({ query, category }) => {
          const results = await searchKnowledge(query, category);
          if (results.length === 0) {
            return "No matching documents found in the knowledge base.";
          }
          return results
            .map(
              (r) =>
                `[${r.title}] (${r.filePath}): ${r.snippet}`
            )
            .join("\n\n");
        },
      }),

      /**
       * **readKnowledgeDocument** — Reads the full content of a single
       * knowledge-base document identified by its file path (typically
       * obtained from a prior `searchKnowledge` call). Returns the
       * document title and body as Markdown.
       */
      readKnowledgeDocument: tool({
        description:
          "Read a specific knowledge base document to get the full detailed content. Use after searching to retrieve complete information from a specific file.",
        parameters: z.object({
          filePath: z
            .string()
            .describe("The file path returned from a search result"),
        }),
        execute: async ({ filePath }) => {
          const doc = await readKnowledgeFile(filePath);
          if (!doc) return "Document not found.";
          return `# ${doc.title}\n\n${doc.content}`;
        },
      }),
    },
    maxSteps: webSearchEnabled ? 8 : 5,
    onStepFinish({ stepType, toolCalls, finishReason, text }) {
      logger.info({
        stepType,
        finishReason,
        textLength: text?.length ?? 0,
        toolCalls: toolCalls?.map((tc) => tc.toolName),
      }, "AI step finished");
    },
  });

  // Prevent any intermediate proxy or Node layer from buffering the stream
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  await result.pipeDataStreamToResponse(res, {
    onError: (err) => {
      logger.error({ err }, "Stream error");
      return err instanceof Error ? err.message : "An error occurred.";
    },
  });
}
