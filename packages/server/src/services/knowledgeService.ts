/**
 * @module knowledgeService
 *
 * Retrieves curated culinary knowledge from the chunk-based vector store.
 *
 * ## Search modes
 *
 * **Vector search (semantic, preferred)**
 * When `vector_search_enabled = "true"` in site settings AND an OpenAI
 * embedding is available, the query is embedded with `text-embedding-3-small`
 * and a cosine-similarity search is run against `knowledge_chunk` embeddings.
 * Falls back to keyword search on any failure.
 *
 * **Keyword search (fallback / default)**
 * SQL ILIKE search across `knowledge_chunk.chunk_text`, joined to
 * `knowledge_document` for title/category. Top 5 results by match count.
 *
 * ## Source privacy
 * Search results NEVER include filePath, sourceUrl, originalFilename, or
 * sourceType. All knowledge is presented as internally curated.
 */

import { sql } from "drizzle-orm";
import { embed } from "ai";
import { getEmbeddingModel } from "./providerService.js";
import pino from "pino";
import { db } from "../db/index.js";
import { knowledgeDocument, knowledgeChunk } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { getAllSettings } from "./settingsService.js";

const logger = pino({ name: "knowledgeService" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A search result returned to callers — source metadata is stripped. */
export interface SearchResult {
  documentId: number;
  chunkId: number;
  title: string;
  category: string;
  snippet: string;
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

/**
 * Embed a text string using OpenAI text-embedding-3-small (1536 dims).
 *
 * @returns The embedding vector, or null if the API is unavailable.
 */
export async function embedText(text: string): Promise<number[] | null> {
  try {
    const { embedding } = await embed({
      model: getEmbeddingModel(),
      value: text,
    });
    return embedding;
  } catch (err) {
    logger.warn({ err }, "embedText: embedding API call failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Vector search (chunk-based)
// ---------------------------------------------------------------------------

/**
 * Search `knowledge_chunk` embeddings using pgvector cosine similarity.
 * Joins to `knowledge_document` for title/category.
 * Returns top-K results — source metadata is NEVER included.
 */
async function vectorSearch(
  query: string,
  category?: string,
  topK = 5,
): Promise<SearchResult[] | null> {
  const embedding = await embedText(query);
  if (!embedding) return null;

  const vectorStr = `[${embedding.join(",")}]`;

  try {
    const categoryFilter = category
      ? sql`AND d.category = ${category}`
      : sql``;

    const rows = await db.execute(sql`
      SELECT c.chunk_id, c.document_id, c.chunk_text,
             d.title, d.category,
             1 - (c.embedding <=> ${vectorStr}::vector) AS similarity
      FROM knowledge_chunk c
      JOIN knowledge_document d ON d.document_id = c.document_id
      WHERE c.embedding IS NOT NULL
        AND d.status = 'ready'
        ${categoryFilter}
      ORDER BY c.embedding <=> ${vectorStr}::vector
      LIMIT ${topK}
    `);

    return (rows as unknown as {
      chunk_id: number;
      document_id: number;
      chunk_text: string;
      title: string;
      category: string;
    }[]).map((row) => ({
      documentId: row.document_id,
      chunkId: row.chunk_id,
      title: row.title,
      category: row.category,
      snippet: row.chunk_text.slice(0, 300),
    }));
  } catch (err) {
    logger.warn({ err }, "vectorSearch: pgvector query failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Keyword search (fallback — SQL-based)
// ---------------------------------------------------------------------------

/**
 * Keyword search across `knowledge_chunk.chunk_text` using SQL ILIKE.
 * Joins to `knowledge_document` for title/category filtering.
 * Scores by number of matching terms. Returns top 5.
 */
async function keywordSearch(
  query: string,
  category?: string,
): Promise<SearchResult[]> {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2); // skip tiny words

  if (terms.length === 0) return [];

  try {
    // Build ILIKE conditions for each term
    const conditions = terms.map(
      (term) => sql`(LOWER(c.chunk_text) LIKE ${"%" + term + "%"} OR LOWER(d.title) LIKE ${"%" + term + "%"})`,
    );

    // Score = count of matching conditions (approximation)
    const scoreExpr = sql.join(
      terms.map(
        (term) =>
          sql`(CASE WHEN LOWER(d.title) LIKE ${"%" + term + "%"} THEN 10 ELSE 0 END +
               CASE WHEN LOWER(c.chunk_text) LIKE ${"%" + term + "%"} THEN 3 ELSE 0 END)`,
      ),
      sql` + `,
    );

    const categoryFilter = category
      ? sql`AND d.category = ${category}`
      : sql``;

    const anyMatch = sql.join(conditions, sql` OR `);

    const rows = await db.execute(sql`
      SELECT c.chunk_id, c.document_id, c.chunk_text,
             d.title, d.category,
             (${scoreExpr}) AS score
      FROM knowledge_chunk c
      JOIN knowledge_document d ON d.document_id = c.document_id
      WHERE d.status = 'ready'
        AND (${anyMatch})
        ${categoryFilter}
      ORDER BY score DESC
      LIMIT 5
    `);

    return (rows as unknown as {
      chunk_id: number;
      document_id: number;
      chunk_text: string;
      title: string;
      category: string;
      score: number;
    }[])
      .filter((row) => row.score > 0)
      .map((row) => ({
        documentId: row.document_id,
        chunkId: row.chunk_id,
        title: row.title,
        category: row.category,
        snippet: row.chunk_text.slice(0, 300),
      }));
  } catch (err) {
    logger.warn({ err }, "keywordSearch: SQL query failed");
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public search API
// ---------------------------------------------------------------------------

/**
 * Search the culinary knowledge base.
 *
 * Uses vector (semantic) search when `vector_search_enabled = "true"` in
 * site settings and the embedding API is available. Falls back to keyword
 * search transparently on any failure.
 *
 * Source privacy: results never include filePath, sourceUrl, or sourceType.
 *
 * @param query    - Free-text search query (e.g. "searing scallops").
 * @param category - Optional category filter (techniques, pastry, spirits, ingredients).
 * @returns Up to 5 {@link SearchResult} objects sorted by relevance.
 */
export async function searchKnowledge(
  query: string,
  category?: string,
): Promise<SearchResult[]> {
  // Try vector search when enabled
  let settings: Record<string, string>;
  try {
    settings = await getAllSettings();
  } catch {
    settings = {};
  }

  if (settings.vector_search_enabled === "true") {
    try {
      const results = await vectorSearch(query, category);
      if (results && results.length > 0) {
        logger.debug({ count: results.length, mode: "vector" }, "searchKnowledge: vector search");
        return results;
      }
      // Zero results from vector — fall through to keyword
    } catch (err) {
      logger.warn({ err }, "searchKnowledge: vector search threw — falling back to keyword");
    }
  }

  // Keyword fallback
  const results = await keywordSearch(query, category);
  logger.debug({ count: results.length, mode: "keyword" }, "searchKnowledge: keyword search");
  return results;
}

/**
 * Read a knowledge document by ID, returning surrounding chunks for context.
 * Source metadata is NEVER included — only title, category, and content.
 *
 * @param documentId - The document ID to read.
 * @returns An object with title, category, and content, or null if not found.
 */
export async function readKnowledgeDocument(
  documentId: number,
): Promise<{ title: string; category: string; content: string } | null> {
  const [doc] = await db
    .select({
      title: knowledgeDocument.title,
      category: knowledgeDocument.category,
    })
    .from(knowledgeDocument)
    .where(eq(knowledgeDocument.documentId, documentId))
    .limit(1);

  if (!doc) return null;

  // Fetch first 10 chunks only — prevents dumping entire books into the LLM context.
  // The search snippets already provide targeted results; this gives more detail
  // without overwhelming the model or killing the stream.
  const MAX_READ_CHUNKS = 10;
  const MAX_CONTENT_LENGTH = 8000;

  const chunks = await db
    .select({ chunkText: knowledgeChunk.chunkText })
    .from(knowledgeChunk)
    .where(eq(knowledgeChunk.documentId, documentId))
    .orderBy(knowledgeChunk.chunkIndex)
    .limit(MAX_READ_CHUNKS);

  let content = chunks.map((c) => c.chunkText).join("\n\n");
  if (content.length > MAX_CONTENT_LENGTH) {
    content = content.slice(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated for brevity]";
  }

  return {
    title: doc.title,
    category: doc.category,
    content,
  };
}
