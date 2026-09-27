/**
 * @module services/knowledgeQueryService
 * Sync CRUD operations on knowledge documents (admin view).
 */

import { db } from "../db/index.js";
import { knowledgeDocument, knowledgeChunk } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";

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
