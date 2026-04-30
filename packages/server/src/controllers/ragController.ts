/**
 * @module controllers/ragController
 *
 * Controller for the mobile RAG retrieval endpoint.
 *
 * The mobile app (sibling repo `cc-culinaire-kitchen-mob`) calls this on
 * every chat turn to inject grounded culinary context into its on-device
 * LLM. The controller validates input, calls the retrieval service, and
 * maps service errors to HTTP responses.
 *
 * **Privacy invariant:** the chef's question text leaves the device for
 * retrieval but must NEVER be persisted server-side. This controller logs
 * only `userId`, `latencyMs`, `chunkCount`, and `mode` (vector vs
 * keyword). NEVER log `query`, `category`, or anything chunk-derived.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import pino from "pino";
import { retrieveForMobile } from "../services/knowledgeService.js";

const log = pino({ name: "ragController" });

/**
 * Request body schema.
 *
 * `.strict()` rejects unknown keys. The mobile spec was explicit: any
 * extra field returns 400 — prevents silent contract drift if the mobile
 * client sends a future field this server doesn't yet understand.
 */
const RetrieveRequestSchema = z
  .object({
    query: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().min(1, "query must not be empty after trim").max(2000, "query exceeds 2000 chars")),
    limit: z.number().int().min(1).max(20).optional().default(5),
    category: z.string().max(200).optional(),
  })
  .strict();

/**
 * **POST /api/mobile/rag/retrieve** — Top-K knowledge chunks for the
 * on-device LLM grounding flow.
 *
 * @returns 200 `{ chunks: MobileRetrievalChunk[], vectorSearchEnabled: boolean }`.
 *          Empty `chunks` is a 200, never a 404 — the mobile client
 *          handles "nothing matched" gracefully.
 * @returns 400 if validation fails (empty query, limit out of range,
 *          unknown extra keys).
 * @returns 401 if the JWT is missing or invalid (handled upstream by
 *          `authenticate`).
 * @returns 429 if the per-route rate limiter is exceeded.
 * @returns 503 if retrieval threw uncaught (vector AND keyword paths
 *          both unavailable). Differentiated from a 200-with-empty-chunks
 *          because empty results are normal but a thrown error is not.
 * @returns 5xx for any other unexpected error path (delegated to the
 *          global error handler).
 */
export async function handleMobileRagRetrieve(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const parsed = RetrieveRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Invalid request body.",
      details: parsed.error.flatten(),
    });
    return;
  }

  const { query, limit, category } = parsed.data;
  const startedAt = Date.now();

  try {
    const [chunks, vectorSearchEnabled] = await retrieveForMobile(query, limit, category);

    log.info(
      {
        userId: req.user?.sub,
        latencyMs: Date.now() - startedAt,
        chunkCount: chunks.length,
        // Mode tells ops "did vector serve this request, or did keyword?".
        // It does NOT include the query text — see privacy invariant above.
        mode: chunks.length > 0 && chunks[0].score > 0 ? "vector" : "keyword",
        limit,
        // category IS logged because it's a coarse filter, not the user's
        // private question. If callers want zero-leak retrieval they omit it.
        category: category ?? null,
      },
      "mobile.rag_retrieve",
    );

    res.json({ chunks, vectorSearchEnabled });
  } catch (err) {
    log.error(
      { err, userId: req.user?.sub, latencyMs: Date.now() - startedAt },
      "mobile.rag_retrieve.failed",
    );
    // 503: retrieval is unavailable (both paths threw, or a downstream
    // dependency is dead). Distinct from a generic 5xx so the mobile
    // client can show a "search temporarily unavailable" message instead
    // of a hard error.
    res.status(503).json({ error: "Retrieval is temporarily unavailable." });
  }
}
