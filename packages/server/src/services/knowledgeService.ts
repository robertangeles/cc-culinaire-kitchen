/**
 * @module knowledgeService
 *
 * Indexes and retrieves curated culinary knowledge from the markdown-based
 * knowledge base (`knowledge-base/`).
 *
 * ## Search modes
 *
 * **Vector search (semantic, preferred)**
 * When `vector_search_enabled = "true"` in site settings AND an OpenAI
 * embedding is available, the query is embedded with `text-embedding-3-small`
 * and a cosine-similarity search is run against the pgvector index on the
 * `knowledge_document` table.  Falls back to keyword search on any failure.
 *
 * **Keyword search (fallback / default)**
 * Term-matching with weighted scoring: title (10× per term), tags (8×),
 * body content (3×). Results sorted by score, capped at top 5.
 *
 * ## Document sync (startup)
 *
 * `syncDocuments()` is called once at server startup.  It:
 *  1. Scans all `.md` files under `knowledge-base/`
 *  2. Computes a SHA-256 hash of each file's raw content
 *  3. Compares with the stored `content_hash` in the DB
 *  4. Embeds and upserts only new or changed documents
 *  5. Also rebuilds the in-memory keyword index
 *
 * If the embedding API is unavailable at startup, documents are synced into
 * the DB without embeddings and keyword search remains the active mode.
 */

import { createHash } from "crypto";
import { readFile, readdir } from "fs/promises";
import { join, dirname, resolve, relative } from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";
import { sql } from "drizzle-orm";
import { embed } from "ai";
import { openai } from "@ai-sdk/openai";
import pino from "pino";
import { db } from "../db/index.js";
import { knowledgeDocument } from "../db/schema.js";
import { getAllSettings } from "./settingsService.js";

const logger = pino({ name: "knowledgeService" });

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the knowledge-base directory at the repository root. */
const KNOWLEDGE_DIR = resolve(__dirname, "../../../../knowledge-base");

// ---------------------------------------------------------------------------
// In-memory index (keyword search)
// ---------------------------------------------------------------------------

/** A single parsed knowledge-base entry held in the in-memory index. */
interface KnowledgeEntry {
  filePath: string;
  title: string;
  category: string;
  tags: string[];
  content: string;
}

/** A search result returned to callers, containing a text snippet for preview. */
export interface SearchResult {
  filePath: string;
  title: string;
  category: string;
  snippet: string;
}

/** In-memory index populated on startup by syncDocuments(). */
let index: KnowledgeEntry[] = [];

// ---------------------------------------------------------------------------
// File scanning + SHA-256 hashing
// ---------------------------------------------------------------------------

/**
 * Recursively scans a directory for `.md` files and returns parsed entries.
 * Non-markdown files and unreadable directories are silently skipped.
 */
async function scanDirectory(dir: string): Promise<(KnowledgeEntry & { rawContent: string })[]> {
  const entries: (KnowledgeEntry & { rawContent: string })[] = [];

  let items: string[];
  try {
    items = await readdir(dir);
  } catch {
    return entries;
  }

  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = await import("fs").then((fs) => fs.promises.stat(fullPath));

    if (stat.isDirectory()) {
      const nested = await scanDirectory(fullPath);
      entries.push(...nested);
    } else if (item.endsWith(".md")) {
      const raw = await readFile(fullPath, "utf-8");
      const { data, content } = matter(raw);
      const relativePath = relative(KNOWLEDGE_DIR, fullPath).replace(/\\/g, "/");

      entries.push({
        filePath: relativePath,
        title: (data.title as string) ?? item.replace(".md", ""),
        category: (data.category as string) ?? relative(KNOWLEDGE_DIR, dir).replace(/\\/g, "/"),
        tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
        content,
        rawContent: raw,
      });
    }
  }

  return entries;
}

/** Compute a SHA-256 hex digest of a string (used for change detection). */
function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Embedding
// ---------------------------------------------------------------------------

/**
 * Embed a text string using OpenAI text-embedding-3-small (1536 dims).
 *
 * @returns The embedding vector, or null if the API is unavailable.
 */
async function embedText(text: string): Promise<number[] | null> {
  try {
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: text,
    });
    return embedding;
  } catch (err) {
    logger.warn({ err }, "embedText: embedding API call failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Document sync (startup)
// ---------------------------------------------------------------------------

/**
 * Synchronise the `knowledge_document` table with the files in `knowledge-base/`.
 *
 * Uses SHA-256 hashes to skip unchanged documents, so subsequent starts
 * are fast (only re-embeds new or modified files).
 *
 * Also rebuilds the in-memory keyword index so that keyword search always
 * reflects the current state of the knowledge base regardless of whether
 * vector search is enabled.
 *
 * @remarks
 * If the embedding API is down at startup, documents are upserted into the
 * DB without embeddings and a warning is logged.  The server still starts
 * normally and keyword search remains active.
 */
export async function syncDocuments(): Promise<void> {
  logger.info("Knowledge sync starting...");

  let entries: (KnowledgeEntry & { rawContent: string })[];
  try {
    entries = await scanDirectory(KNOWLEDGE_DIR);
  } catch (err) {
    logger.error({ err }, "Knowledge sync: failed to scan directory — skipping");
    return;
  }

  // Rebuild in-memory keyword index from scanned files
  index = entries.map(({ rawContent: _raw, ...e }) => e);

  let synced = 0;
  let skipped = 0;

  for (const entry of entries) {
    const hash = sha256(entry.rawContent);

    // Check if this document already exists with the same hash
    const existing = await db.execute(
      sql`SELECT content_hash FROM knowledge_document WHERE file_path = ${entry.filePath} LIMIT 1`
    );

    const existingHash = (existing as unknown as { content_hash: string }[])[0]?.content_hash;
    if (existingHash === hash) {
      skipped++;
      continue;
    }

    // New or changed document — embed and upsert
    const embeddingText = `${entry.title}\n${entry.tags.join(", ")}\n${entry.content}`;
    const embedding = await embedText(embeddingText);
    const embeddingStr = embedding ? `[${embedding.join(",")}]` : null;

    if (embeddingStr) {
      await db.execute(sql`
        INSERT INTO knowledge_document
          (file_path, title, category, tags, body, content_hash, embedding, embedded_at, updated_dttm)
        VALUES (
          ${entry.filePath},
          ${entry.title},
          ${entry.category},
          ${entry.tags},
          ${entry.content},
          ${hash},
          ${embeddingStr}::vector,
          NOW(),
          NOW()
        )
        ON CONFLICT (file_path) DO UPDATE SET
          title        = EXCLUDED.title,
          category     = EXCLUDED.category,
          tags         = EXCLUDED.tags,
          body         = EXCLUDED.body,
          content_hash = EXCLUDED.content_hash,
          embedding    = EXCLUDED.embedding,
          embedded_at  = EXCLUDED.embedded_at,
          updated_dttm = NOW()
      `);
    } else {
      // No embedding available — upsert without vector (keyword search only)
      await db.execute(sql`
        INSERT INTO knowledge_document
          (file_path, title, category, tags, body, content_hash, updated_dttm)
        VALUES (
          ${entry.filePath},
          ${entry.title},
          ${entry.category},
          ${entry.tags},
          ${entry.content},
          ${hash},
          NOW()
        )
        ON CONFLICT (file_path) DO UPDATE SET
          title        = EXCLUDED.title,
          category     = EXCLUDED.category,
          tags         = EXCLUDED.tags,
          body         = EXCLUDED.body,
          content_hash = EXCLUDED.content_hash,
          updated_dttm = NOW()
      `);
    }

    synced++;
    logger.debug({ filePath: entry.filePath, embedded: !!embeddingStr }, "Knowledge sync: upserted document");
  }

  logger.info({ synced, skipped, total: entries.length }, "Knowledge sync complete");
}

/**
 * Alias for syncDocuments() — kept for backward compatibility.
 * Prefer calling `syncDocuments()` directly.
 */
export async function buildIndex(): Promise<void> {
  return syncDocuments();
}

// ---------------------------------------------------------------------------
// Vector search
// ---------------------------------------------------------------------------

/**
 * Search the `knowledge_document` table using pgvector cosine similarity.
 *
 * Embeds the query with OpenAI text-embedding-3-small and runs an IVFFlat
 * ANN search.  Returns the top-K results ordered by similarity descending.
 *
 * @param query    - Free-text search query.
 * @param category - Optional category filter.
 * @param topK     - Maximum number of results (default 5).
 * @returns Array of search results, or null if embedding fails.
 */
async function vectorSearch(
  query: string,
  category?: string,
  topK = 5
): Promise<SearchResult[] | null> {
  const embedding = await embedText(query);
  if (!embedding) return null;

  const vectorStr = `[${embedding.join(",")}]`;

  let rows: unknown[];
  try {
    if (category) {
      rows = await db.execute(sql`
        SELECT file_path, title, category, body,
               1 - (embedding <=> ${vectorStr}::vector) AS similarity
        FROM knowledge_document
        WHERE embedding IS NOT NULL
          AND category = ${category}
        ORDER BY embedding <=> ${vectorStr}::vector
        LIMIT ${topK}
      `);
    } else {
      rows = await db.execute(sql`
        SELECT file_path, title, category, body,
               1 - (embedding <=> ${vectorStr}::vector) AS similarity
        FROM knowledge_document
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> ${vectorStr}::vector
        LIMIT ${topK}
      `);
    }
  } catch (err) {
    logger.warn({ err }, "vectorSearch: pgvector query failed");
    return null;
  }

  return (rows as { file_path: string; title: string; category: string; body: string }[]).map((row) => ({
    filePath: row.file_path,
    title: row.title,
    category: row.category,
    snippet: extractSnippet(row.body, query.split(/\s+/)),
  }));
}

// ---------------------------------------------------------------------------
// Keyword search (fallback)
// ---------------------------------------------------------------------------

/**
 * Keyword search over the in-memory index.
 * Matches query terms case-insensitively against title (10×), tags (8×),
 * and body (3×).  Returns up to 5 results sorted by score descending.
 */
function keywordSearch(query: string, category?: string): SearchResult[] {
  const terms = query.toLowerCase().split(/\s+/);

  return index
    .filter((entry) => !category || entry.category === category)
    .map((entry) => {
      let score = 0;
      const lowerContent = entry.content.toLowerCase();
      const lowerTitle = entry.title.toLowerCase();
      const lowerTags = entry.tags.map((t) => t.toLowerCase());

      for (const term of terms) {
        if (lowerTitle.includes(term)) score += 10;
        if (lowerTags.some((t) => t.includes(term))) score += 8;
        if (lowerContent.includes(term)) score += 3;
      }

      return { entry, score, snippet: extractSnippet(entry.content, terms) };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ entry, snippet }) => ({
      filePath: entry.filePath,
      title: entry.title,
      category: entry.category,
      snippet,
    }));
}

/** Extract a relevant snippet from body content given search terms. */
function extractSnippet(body: string, terms: string[]): string {
  const lines = body.split("\n");
  for (const line of lines) {
    if (terms.some((t) => line.toLowerCase().includes(t)) && line.trim().length > 10) {
      return line.trim().slice(0, 200);
    }
  }
  return lines.find((l) => l.trim().length > 10)?.trim().slice(0, 200) ?? "";
}

// ---------------------------------------------------------------------------
// Public search API
// ---------------------------------------------------------------------------

/**
 * Search the culinary knowledge base.
 *
 * Uses vector (semantic) search when `vector_search_enabled = "true"` in
 * site settings and the embedding API is available.  Falls back to keyword
 * search transparently on any failure.
 *
 * @param query    - Free-text search query (e.g. "searing scallops").
 * @param category - Optional category filter (techniques, pastry, spirits, ingredients).
 * @returns Up to 5 {@link SearchResult} objects sorted by relevance.
 */
export async function searchKnowledge(
  query: string,
  category?: string
): Promise<SearchResult[]> {
  // Ensure in-memory index is populated (fallback if syncDocuments wasn't called)
  if (index.length === 0) {
    try {
      const entries = await scanDirectory(KNOWLEDGE_DIR);
      index = entries.map(({ rawContent: _raw, ...e }) => e);
    } catch {
      logger.warn("searchKnowledge: could not rebuild keyword index");
    }
  }

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
  const results = keywordSearch(query, category);
  logger.debug({ count: results.length, mode: "keyword" }, "searchKnowledge: keyword search");
  return results;
}

/**
 * Reads and parses a single knowledge-base markdown file by its relative
 * path within the knowledge-base directory. Includes path-traversal
 * protection to prevent access outside the knowledge-base root.
 *
 * @param filePath - Relative path from the knowledge-base root
 *                   (e.g. "techniques/searing.md").
 * @returns An object with `title`, `category`, and `content` fields,
 *          or `null` if the file does not exist or the path is invalid.
 */
export async function readKnowledgeFile(
  filePath: string
): Promise<{ title: string; category: string; content: string } | null> {
  // Path traversal protection
  const resolved = resolve(KNOWLEDGE_DIR, filePath);
  if (!resolved.startsWith(KNOWLEDGE_DIR)) {
    return null;
  }

  try {
    const raw = await readFile(resolved, "utf-8");
    const { data, content } = matter(raw);
    return {
      title: (data.title as string) ?? filePath,
      category: (data.category as string) ?? "",
      content: content.trim(),
    };
  } catch {
    return null;
  }
}
