/**
 * @module services/knowledgeManagementService
 *
 * Manages the lifecycle of knowledge documents: ingest, extract, chunk,
 * embed, re-embed, and delete. All ingestion is async — the HTTP handler
 * returns immediately with a 'processing' status while extraction and
 * embedding happen in the background.
 *
 * Pipeline:
 *   ingest(source) → extractText → validate → dedup → chunkText → embedChunks → persist
 *
 * Source privacy: sourceUrl, originalFilename, and sourceType are stored
 * for admin visibility but are NEVER exposed to the AI or end users.
 */

import { createHash } from "node:crypto";
import pino from "pino";
import { db } from "../db/index.js";
import { knowledgeDocument, knowledgeChunk } from "../db/schema.js";
import { eq, sql, and, lt } from "drizzle-orm";
import { embedText } from "./knowledgeService.js";

const logger = pino({ name: "knowledgeManagement" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChunkResult {
  text: string;
  tokenCount: number;
}

interface IngestFileParams {
  buffer: Buffer;
  mimeType: string;
  originalFilename: string;
  title: string;
  category: string;
  tags: string[];
}

interface IngestUrlParams {
  url: string;
  title: string;
  category: string;
  tags: string[];
  crawl?: boolean;
}

interface IngestManualParams {
  title: string;
  category: string;
  tags: string[];
  body: string;
}

// ---------------------------------------------------------------------------
// Text Extraction
// ---------------------------------------------------------------------------

async function extractFromPdf(buffer: Buffer): Promise<string> {
  // Try pdf-parse first (fast, works for text-based PDFs)
  // @ts-ignore
  const mod = await import("pdf-parse");
  const parse = (mod as any).default ?? mod;
  const data = await parse(buffer);
  const text = (data.text ?? "").replace(/\x00/g, "").trim();

  // If we got meaningful text, return it
  if (text.length > 50) {
    return text;
  }

  // Fallback: OCR for scanned/image-only PDFs
  logger.info("No text layer found in PDF — falling back to Tesseract OCR");
  return extractFromPdfWithOcr(buffer);
}

/** OCR fallback for scanned PDFs using Tesseract.js + pdf-to-img */
async function extractFromPdfWithOcr(buffer: Buffer): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const { pdf } = await import("pdf-to-img");

  const worker = await createWorker("eng");
  const pages: string[] = [];
  let pageNum = 0;

  try {
    const pdfDoc = await pdf(buffer, { scale: 2 });
    for await (const pageImage of pdfDoc) {
      pageNum++;
      if (pageNum % 10 === 0 || pageNum === 1) {
        logger.info({ page: pageNum }, "OCR processing page");
      }
      const { data } = await worker.recognize(pageImage);
      const pageText = (data.text ?? "").replace(/\x00/g, "").trim();
      if (pageText.length > 5) {
        pages.push(pageText);
      }
    }
  } finally {
    await worker.terminate();
  }

  logger.info({ totalPages: pageNum, pagesWithText: pages.length }, "OCR extraction complete");

  if (pages.length === 0) {
    throw new Error("OCR could not extract text from this PDF. The document may contain only images or unsupported content.");
  }

  return pages.join("\n\n");
}

async function extractFromDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function extractFromUrl(url: string): Promise<string> {
  // SSRF protection: block private IPs and cloud metadata endpoints
  validateUrlSafety(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "CulinAIre-Knowledge-Bot/1.0" },
    });

    if (!res.ok) {
      throw new Error(`URL returned HTTP ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || "";
    const contentLength = parseInt(res.headers.get("content-length") || "0", 10);
    if (contentLength > 5 * 1024 * 1024) {
      throw new Error("Page too large (>5MB)");
    }

    // If the URL points to a PDF, extract via pdf-parse
    if (contentType.includes("application/pdf")) {
      const arrayBuffer = await res.arrayBuffer();
      return extractFromPdf(Buffer.from(arrayBuffer));
    }

    const html = await res.text();
    if (html.length > 5 * 1024 * 1024) {
      throw new Error("Page too large (>5MB)");
    }

    const cheerio = await import("cheerio");
    const $ = cheerio.load(html);

    // Remove non-content elements
    $("script, style, nav, footer, header, aside, iframe, noscript").remove();

    // Extract meaningful text from article or main content, fallback to body
    const article = $("article").text() || $("main").text() || $("body").text();
    return article.replace(/\s+/g, " ").trim();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Crawl a site starting from the given URL. Follows same-origin links
 * found on the page up to `maxPages` (default 20). Returns an array
 * of { url, text } for each successfully scraped page.
 */
const CRAWL_MAX_PAGES = 20;

async function crawlSite(
  startUrl: string,
): Promise<{ pageUrl: string; text: string; title: string }[]> {
  validateUrlSafety(startUrl);

  const origin = new URL(startUrl).origin;
  const visited = new Set<string>();
  const queue = [startUrl];
  const results: { pageUrl: string; text: string; title: string }[] = [];

  while (queue.length > 0 && visited.size < CRAWL_MAX_PAGES) {
    const url = queue.shift()!;
    // Normalize: strip hash, trailing slash for dedup
    const normalized = url.replace(/#.*$/, "").replace(/\/$/, "");
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    try {
      validateUrlSafety(url);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      const res = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "CulinAIre-Knowledge-Bot/1.0" },
      });
      clearTimeout(timeout);

      if (!res.ok) continue;

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) continue;

      const html = await res.text();
      if (html.length > 5 * 1024 * 1024) continue;

      const cheerio = await import("cheerio");
      const $ = cheerio.load(html);

      // Extract links before stripping nav
      if (visited.size < CRAWL_MAX_PAGES) {
        $("a[href]").each((_, el) => {
          try {
            const href = $(el).attr("href");
            if (!href) return;
            const resolved = new URL(href, url).href.replace(/#.*$/, "").replace(/\/$/, "");
            if (resolved.startsWith(origin) && !visited.has(resolved) && !queue.includes(resolved)) {
              queue.push(resolved);
            }
          } catch { /* invalid URL, skip */ }
        });
      }

      // Extract page title
      const pageTitle = $("title").text().trim() || $("h1").first().text().trim() || url;

      // Strip non-content elements
      $("script, style, nav, footer, header, aside, iframe, noscript").remove();
      const article = $("article").text() || $("main").text() || $("body").text();
      const text = article.replace(/\s+/g, " ").trim();

      if (text.length > 50) {
        results.push({ pageUrl: url, text, title: pageTitle });
      }
    } catch {
      // Skip pages that fail (timeout, DNS, etc.)
      continue;
    }
  }

  logger.info({ startUrl, pagesVisited: visited.size, pagesExtracted: results.length }, "Crawl complete");
  return results;
}

function extractFromTxt(buffer: Buffer): string {
  return buffer.toString("utf-8");
}

function extractFromMd(buffer: Buffer): string {
  const raw = buffer.toString("utf-8");
  // Strip YAML frontmatter if present
  const match = raw.match(/^---\s*\n[\s\S]*?\n---\s*\n/);
  return match ? raw.slice(match[0].length) : raw;
}

/**
 * Dispatcher: extract text from a buffer based on MIME type.
 */
async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  switch (mimeType) {
    case "application/pdf":
      return extractFromPdf(buffer);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return extractFromDocx(buffer);
    case "text/plain":
      return extractFromTxt(buffer);
    case "text/markdown":
      return extractFromMd(buffer);
    default:
      throw new Error(`Unsupported file type: ${mimeType}`);
  }
}

// ---------------------------------------------------------------------------
// SSRF Protection
// ---------------------------------------------------------------------------

function validateUrlSafety(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL format");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  }

  const hostname = parsed.hostname;

  // Block private/reserved IP ranges
  const blocked = [
    /^127\./,                           // loopback
    /^10\./,                            // Class A private
    /^172\.(1[6-9]|2\d|3[01])\./,       // Class B private
    /^192\.168\./,                      // Class C private
    /^169\.254\./,                      // link-local
    /^0\./,                             // current network
    /^fc00:/i, /^fd00:/i,              // IPv6 unique local
    /^fe80:/i,                          // IPv6 link-local
    /^::1$/,                            // IPv6 loopback
    /^localhost$/i,
    /\.local$/i,
    /\.internal$/i,
  ];

  // Block cloud metadata endpoints
  const blockedHosts = [
    "metadata.google.internal",
    "metadata.google.com",
  ];

  if (blocked.some((re) => re.test(hostname)) || blockedHosts.includes(hostname.toLowerCase())) {
    throw new Error("URL not allowed: private or reserved address");
  }
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/**
 * Splits text into chunks of approximately `maxTokens` tokens with
 * `overlap` tokens carried from the end of the previous chunk.
 *
 * Uses paragraph breaks (`\n\n`) as soft boundaries. If a single
 * paragraph exceeds `maxTokens`, it falls back to sentence splitting.
 */
function chunkText(
  text: string,
  maxTokens = 1000,
  overlap = 200,
): ChunkResult[] {
  const cleaned = text.replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  const estimateTokens = (t: string) => Math.ceil(t.split(/\s+/).filter(Boolean).length / 0.75);

  const totalTokens = estimateTokens(cleaned);
  // If entire text fits in one chunk, return as-is
  if (totalTokens <= maxTokens) {
    return [{ text: cleaned, tokenCount: totalTokens }];
  }

  const paragraphs = cleaned.split(/\n\n+/);
  const chunks: ChunkResult[] = [];
  let currentParts: string[] = [];
  let currentTokens = 0;

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);

    // If a single paragraph is too large, split by sentences
    if (paraTokens > maxTokens) {
      // Flush current buffer first
      if (currentParts.length > 0) {
        const chunkText = currentParts.join("\n\n");
        chunks.push({ text: chunkText, tokenCount: estimateTokens(chunkText) });
        currentParts = getOverlapParts(currentParts, overlap);
        currentTokens = estimateTokens(currentParts.join("\n\n"));
      }

      // Split large paragraph by sentences
      const sentences = para.match(/[^.!?]+[.!?]+\s*/g) || [para];
      for (const sentence of sentences) {
        const sentTokens = estimateTokens(sentence);
        if (currentTokens + sentTokens > maxTokens && currentParts.length > 0) {
          const chunkText = currentParts.join(" ");
          chunks.push({ text: chunkText, tokenCount: estimateTokens(chunkText) });
          currentParts = getOverlapParts(currentParts, overlap);
          currentTokens = estimateTokens(currentParts.join(" "));
        }
        currentParts.push(sentence.trim());
        currentTokens += sentTokens;
      }
      continue;
    }

    if (currentTokens + paraTokens > maxTokens && currentParts.length > 0) {
      const chunkText = currentParts.join("\n\n");
      chunks.push({ text: chunkText, tokenCount: estimateTokens(chunkText) });
      // Carry overlap from end of previous chunk
      currentParts = getOverlapParts(currentParts, overlap);
      currentTokens = estimateTokens(currentParts.join("\n\n"));
    }

    currentParts.push(para);
    currentTokens += paraTokens;
  }

  // Flush remaining
  if (currentParts.length > 0) {
    const chunkText = currentParts.join("\n\n");
    const tokens = estimateTokens(chunkText);
    if (tokens > 0) {
      chunks.push({ text: chunkText, tokenCount: tokens });
    }
  }

  // Cap at 500 chunks max
  return chunks.slice(0, 500);
}

/**
 * Returns trailing parts from the buffer that fit within the overlap
 * token budget, for carrying context into the next chunk.
 */
function getOverlapParts(parts: string[], overlapTokens: number): string[] {
  const estimateTokens = (t: string) => Math.ceil(t.split(/\s+/).filter(Boolean).length / 0.75);
  const result: string[] = [];
  let tokens = 0;

  for (let i = parts.length - 1; i >= 0; i--) {
    const partTokens = estimateTokens(parts[i]);
    if (tokens + partTokens > overlapTokens) break;
    result.unshift(parts[i]);
    tokens += partTokens;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Embedding (batch)
// ---------------------------------------------------------------------------

const EMBED_BATCH_SIZE = 50;
const EMBED_MAX_RETRIES = 3;

/**
 * Embeds an array of chunk texts in batches. Returns the embeddings in order.
 * On API failure after retries, returns null entries for failed chunks.
 */
async function embedChunks(
  texts: string[],
): Promise<(number[] | null)[]> {
  const results: (number[] | null)[] = new Array(texts.length).fill(null);

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    let lastError: unknown;

    for (let attempt = 0; attempt < EMBED_MAX_RETRIES; attempt++) {
      try {
        const embeddings = await Promise.all(
          batch.map((text) => embedText(text)),
        );
        for (let j = 0; j < embeddings.length; j++) {
          results[i + j] = embeddings[j];
        }
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        logger.warn(
          { attempt: attempt + 1, batchStart: i, error: (err as Error).message },
          "Embedding batch failed, retrying",
        );
        if (attempt < EMBED_MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
      }
    }

    if (lastError) {
      logger.error(
        { batchStart: i, error: (lastError as Error).message },
        "Embedding batch failed after all retries",
      );
      // Leave nulls — chunks stored without embeddings (keyword search still works)
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Document Processing Pipeline
// ---------------------------------------------------------------------------

async function processDocument(
  documentId: number,
  rawText: string,
): Promise<void> {
  try {
    // Validate extracted text
    const cleaned = rawText.trim();
    if (!cleaned || cleaned.length < 10) {
      await setDocumentFailed(documentId, "No text extracted — document may be scanned/image-only. Try a text-based document.");
      return;
    }

    // Compute content hash for dedup
    const hash = createHash("sha256").update(cleaned).digest("hex");

    // Check for duplicates
    const existing = await db
      .select({ documentId: knowledgeDocument.documentId, title: knowledgeDocument.title })
      .from(knowledgeDocument)
      .where(and(
        eq(knowledgeDocument.contentHash, hash),
        sql`${knowledgeDocument.documentId} != ${documentId}`,
      ))
      .limit(1);

    if (existing.length > 0) {
      await setDocumentFailed(documentId, `Duplicate content — already exists as "${existing[0].title}"`);
      return;
    }

    // Update hash + body
    await db
      .update(knowledgeDocument)
      .set({ contentHash: hash, body: cleaned })
      .where(eq(knowledgeDocument.documentId, documentId));

    // Auto-generate tags from content (if none exist yet)
    try {
      const [doc] = await db
        .select({ tags: knowledgeDocument.tags })
        .from(knowledgeDocument)
        .where(eq(knowledgeDocument.documentId, documentId));

      if (!doc?.tags || doc.tags.length === 0) {
        const { generateObject } = await import("ai");
        const { getModel } = await import("./providerService.js");
        const { z } = await import("zod");
        const model = getModel();
        const snippet = cleaned.slice(0, 3000);
        const { object } = await generateObject({
          model,
          schema: z.object({
            tags: z.array(z.string().max(30)).min(3).max(8),
          }),
          prompt: `Analyze this culinary/food-service document and generate 5-8 short, specific tags that describe its key topics. Tags should be lowercase, 1-3 words each. Focus on culinary techniques, ingredients, cuisine types, or food-service concepts.\n\nDocument excerpt:\n${snippet}`,
        });
        if (object.tags?.length > 0) {
          await db
            .update(knowledgeDocument)
            .set({ tags: object.tags })
            .where(eq(knowledgeDocument.documentId, documentId));
          logger.info({ documentId, tags: object.tags }, "Auto-generated tags");
        }
      }
    } catch (err) {
      logger.warn({ documentId, err: (err as Error).message }, "Failed to auto-generate tags — continuing without");
    }

    // Chunk
    const chunks = chunkText(cleaned);
    if (chunks.length === 0) {
      await setDocumentFailed(documentId, "No content to index after chunking.");
      return;
    }

    // Embed
    let embeddings: (number[] | null)[];
    try {
      embeddings = await embedChunks(chunks.map((c) => c.text));
    } catch {
      // If embedding completely fails, store chunks without embeddings
      embeddings = new Array(chunks.length).fill(null);
    }

    // Persist chunks
    const now = new Date();
    for (let i = 0; i < chunks.length; i++) {
      await db.insert(knowledgeChunk).values({
        documentId,
        chunkIndex: i,
        chunkText: chunks[i].text,
        tokenCount: chunks[i].tokenCount,
        embedding: embeddings[i],
        embeddedAtDttm: embeddings[i] ? now : null,
      });
    }

    const hasEmbeddings = embeddings.some((e) => e !== null);

    // Update document status
    await db
      .update(knowledgeDocument)
      .set({
        status: "ready",
        chunkCount: chunks.length,
        errorMessage: hasEmbeddings ? null : "Ready (keyword search only — embedding API unavailable)",
        updatedDttm: now,
      })
      .where(eq(knowledgeDocument.documentId, documentId));

    logger.info(
      { documentId, chunkCount: chunks.length, hasEmbeddings },
      "Document processed successfully",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown processing error";
    await setDocumentFailed(documentId, message);
    logger.error({ documentId, error: message }, "Document processing failed");
  }
}

async function setDocumentFailed(documentId: number, errorMessage: string): Promise<void> {
  await db
    .update(knowledgeDocument)
    .set({ status: "failed", errorMessage, updatedDttm: new Date() })
    .where(eq(knowledgeDocument.documentId, documentId));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ingest a file upload (PDF, DOCX, TXT, MD).
 * Returns the new document ID immediately; processing is async.
 */
export async function ingestFile(params: IngestFileParams): Promise<number> {
  const [doc] = await db
    .insert(knowledgeDocument)
    .values({
      title: params.title,
      category: params.category,
      tags: params.tags,
      body: "",
      contentHash: "",
      sourceType: mimeToSourceType(params.mimeType),
      originalFilename: params.originalFilename,
      fileSizeBytes: params.buffer.length,
      status: "processing",
    })
    .returning({ documentId: knowledgeDocument.documentId });

  // Async processing — don't await
  (async () => {
    try {
      const text = await extractText(params.buffer, params.mimeType);
      await processDocument(doc.documentId, text);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Extraction failed";
      await setDocumentFailed(doc.documentId, message);
    }
  })();

  return doc.documentId;
}

/**
 * Ingest content from a URL.
 * Returns the new document ID immediately; processing is async.
 */
export async function ingestUrl(params: IngestUrlParams): Promise<number> {
  // Validate URL before creating document
  validateUrlSafety(params.url);

  if (params.crawl) {
    return ingestUrlCrawl(params);
  }

  const [doc] = await db
    .insert(knowledgeDocument)
    .values({
      title: params.title,
      category: params.category,
      tags: params.tags,
      body: "",
      contentHash: "",
      sourceType: "url",
      sourceUrl: params.url,
      status: "processing",
    })
    .returning({ documentId: knowledgeDocument.documentId });

  // Async processing — don't await
  (async () => {
    try {
      const text = await extractFromUrl(params.url);
      await processDocument(doc.documentId, text);
    } catch (err) {
      const message = err instanceof Error ? err.message : "URL fetch failed";
      await setDocumentFailed(doc.documentId, message);
    }
  })();

  return doc.documentId;
}

/**
 * Crawl a site and create a separate document for each page found.
 * Returns the ID of the first document (the start URL). All crawled
 * pages share the same category and tags.
 */
async function ingestUrlCrawl(params: IngestUrlParams): Promise<number> {
  // Create a placeholder document for the start URL
  const [first] = await db
    .insert(knowledgeDocument)
    .values({
      title: params.title,
      category: params.category,
      tags: params.tags,
      body: "",
      contentHash: "",
      sourceType: "url",
      sourceUrl: params.url,
      status: "processing",
    })
    .returning({ documentId: knowledgeDocument.documentId });

  // Async: crawl and create documents for each page
  (async () => {
    try {
      const pages = await crawlSite(params.url);

      if (pages.length === 0) {
        await setDocumentFailed(first.documentId, "No content found when crawling this URL.");
        return;
      }

      // Process the first page as the already-created document
      const firstPage = pages[0];
      await db
        .update(knowledgeDocument)
        .set({ title: params.title || firstPage.title })
        .where(eq(knowledgeDocument.documentId, first.documentId));
      await processDocument(first.documentId, firstPage.text);

      // Create separate documents for subsequent pages
      for (let i = 1; i < pages.length; i++) {
        const page = pages[i];
        try {
          const [doc] = await db
            .insert(knowledgeDocument)
            .values({
              title: page.title.slice(0, 200),
              category: params.category,
              tags: params.tags,
              body: "",
              contentHash: "",
              sourceType: "url",
              sourceUrl: page.pageUrl,
              status: "processing",
            })
            .returning({ documentId: knowledgeDocument.documentId });

          await processDocument(doc.documentId, page.text);
        } catch (err) {
          logger.warn({ pageUrl: page.pageUrl, error: (err as Error).message }, "Crawl: failed to process page");
        }
      }

      logger.info({ startUrl: params.url, totalPages: pages.length }, "Crawl ingestion complete");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Crawl failed";
      await setDocumentFailed(first.documentId, message);
    }
  })();

  return first.documentId;
}

/**
 * Ingest manually entered text.
 * Returns the new document ID immediately; processing is async.
 */
export async function ingestManual(params: IngestManualParams): Promise<number> {
  const [doc] = await db
    .insert(knowledgeDocument)
    .values({
      title: params.title,
      category: params.category,
      tags: params.tags,
      body: "",
      contentHash: "",
      sourceType: "manual",
      status: "processing",
    })
    .returning({ documentId: knowledgeDocument.documentId });

  // Async processing
  (async () => {
    try {
      await processDocument(doc.documentId, params.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Processing failed";
      await setDocumentFailed(doc.documentId, message);
    }
  })();

  return doc.documentId;
}

/**
 * Re-embed an existing document: delete old chunks, re-chunk and re-embed.
 * Throws if the document is already processing.
 */
export async function reEmbedDocument(documentId: number): Promise<void> {
  const [doc] = await db
    .select({ status: knowledgeDocument.status, body: knowledgeDocument.body })
    .from(knowledgeDocument)
    .where(eq(knowledgeDocument.documentId, documentId));

  if (!doc) throw new Error("DOCUMENT_NOT_FOUND");
  if (doc.status === "processing") throw new Error("ALREADY_PROCESSING");

  // Set to processing
  await db
    .update(knowledgeDocument)
    .set({ status: "processing", errorMessage: null, updatedDttm: new Date() })
    .where(eq(knowledgeDocument.documentId, documentId));

  // Delete old chunks
  await db.delete(knowledgeChunk).where(eq(knowledgeChunk.documentId, documentId));

  // Re-process async
  (async () => {
    try {
      await processDocument(documentId, doc.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Re-embedding failed";
      await setDocumentFailed(documentId, message);
    }
  })();
}

/**
 * Delete a document and all its chunks (CASCADE).
 */
export async function deleteDocument(documentId: number): Promise<boolean> {
  // Delete chunks first (explicit, in case CASCADE isn't set at DB level)
  await db.delete(knowledgeChunk).where(eq(knowledgeChunk.documentId, documentId));
  const result = await db
    .delete(knowledgeDocument)
    .where(eq(knowledgeDocument.documentId, documentId))
    .returning({ documentId: knowledgeDocument.documentId });
  return result.length > 0;
}

/**
 * List all documents for admin view (paginated).
 */
export async function listDocuments(page = 1, limit = 20) {
  const offset = (page - 1) * limit;
  const docs = await db
    .select({
      documentId: knowledgeDocument.documentId,
      title: knowledgeDocument.title,
      category: knowledgeDocument.category,
      tags: knowledgeDocument.tags,
      sourceType: knowledgeDocument.sourceType,
      originalFilename: knowledgeDocument.originalFilename,
      sourceUrl: knowledgeDocument.sourceUrl,
      fileSizeBytes: knowledgeDocument.fileSizeBytes,
      chunkCount: knowledgeDocument.chunkCount,
      status: knowledgeDocument.status,
      errorMessage: knowledgeDocument.errorMessage,
      createdDttm: knowledgeDocument.createdDttm,
    })
    .from(knowledgeDocument)
    .orderBy(sql`${knowledgeDocument.createdDttm} DESC`)
    .limit(limit)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(knowledgeDocument);

  return { documents: docs, total: count, page, limit };
}

/**
 * Get a single document detail for admin view.
 */
export async function getDocument(documentId: number) {
  const [doc] = await db
    .select()
    .from(knowledgeDocument)
    .where(eq(knowledgeDocument.documentId, documentId));
  return doc || null;
}

/**
 * Startup recovery: reset stale 'processing' documents to 'failed'.
 * Called once in index.ts during server startup.
 */
export async function recoverStaleDocuments(): Promise<number> {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const result = await db
    .update(knowledgeDocument)
    .set({
      status: "failed",
      errorMessage: "Processing interrupted by server restart. Click re-embed to retry.",
      updatedDttm: new Date(),
    })
    .where(
      and(
        eq(knowledgeDocument.status, "processing"),
        lt(knowledgeDocument.updatedDttm, tenMinutesAgo),
      ),
    )
    .returning({ documentId: knowledgeDocument.documentId });

  if (result.length > 0) {
    logger.info(
      { recoveredCount: result.length, documentIds: result.map((r) => r.documentId) },
      "Recovered stale processing documents",
    );
  }
  return result.length;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mimeToSourceType(mime: string): string {
  switch (mime) {
    case "application/pdf": return "pdf";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return "docx";
    case "text/plain": return "txt";
    case "text/markdown": return "markdown";
    default: return "manual";
  }
}
