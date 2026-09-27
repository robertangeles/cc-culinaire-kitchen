/**
 * Baseline integration tests for knowledgeManagementService barrel —
 * real DB, TENANT_IT=1 gated.
 * Goal: regression signal for the Phase 2f barrel split. Happy-path only.
 * Self-cleaning: afterAll removes created rows.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "../utils/envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { knowledgeDocument, knowledgeChunk } from "../db/schema.js";
import {
  KnowledgeError,
  ingestManual,
  listDocuments,
  getDocument,
  deleteDocument,
} from "./knowledgeManagementService.js";

const RUN = process.env.TENANT_IT === "1";
const tag = `km_${Date.now().toString(36)}`;
let docId: number;

describe.skipIf(!RUN)("knowledgeManagementService barrel — baseline integration (real DB)", () => {
  beforeAll(async () => {
    // Seed a document in 'ready' state directly so we don't wait on async embedding
    const [row] = await db
      .insert(knowledgeDocument)
      .values({
        title: `${tag}-test-doc`,
        category: "test",
        tags: ["test"],
        body: "This is a test knowledge document for barrel split regression.",
        contentHash: `${tag}-hash`,
        sourceType: "manual",
        status: "ready",
        chunkCount: 1,
      })
      .returning({ documentId: knowledgeDocument.documentId });
    docId = row.documentId;
  });

  afterAll(async () => {
    if (docId) {
      await db.delete(knowledgeChunk).where(eq(knowledgeChunk.documentId, docId));
      await db.delete(knowledgeDocument).where(eq(knowledgeDocument.documentId, docId));
    }
  });

  it("KnowledgeError is exported and constructable", () => {
    const err = new KnowledgeError("test", 400);
    expect(err.message).toBe("test");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("KnowledgeError");
  });

  it("listDocuments — returns paginated documents including the seeded one", async () => {
    const result = await listDocuments(1, 50);
    expect(result.documents).toBeDefined();
    expect(result.total).toBeGreaterThanOrEqual(1);
    const found = result.documents.find((d) => d.documentId === docId);
    expect(found).toBeDefined();
    expect(found!.title).toBe(`${tag}-test-doc`);
    expect(found!.status).toBe("ready");
  });

  it("getDocument — returns the seeded document by id", async () => {
    const doc = await getDocument(docId);
    expect(doc).not.toBeNull();
    expect(doc!.documentId).toBe(docId);
    expect(doc!.title).toBe(`${tag}-test-doc`);
    expect(doc!.body).toBe("This is a test knowledge document for barrel split regression.");
  });

  it("getDocument — returns null for a non-existent id", async () => {
    const doc = await getDocument(999999999);
    expect(doc).toBeNull();
  });

  it("ingestManual — creates a document and returns an id immediately", async () => {
    const newId = await ingestManual({
      title: `${tag}-inline`,
      category: "test",
      tags: ["inline"],
      body: "Inline body for barrel barrel test.",
    });
    expect(typeof newId).toBe("number");
    expect(newId).toBeGreaterThan(0);
    // Clean up
    await db.delete(knowledgeChunk).where(eq(knowledgeChunk.documentId, newId));
    await db.delete(knowledgeDocument).where(eq(knowledgeDocument.documentId, newId));
  });

  it("deleteDocument — removes the seeded document and returns true", async () => {
    const deleted = await deleteDocument(docId);
    expect(deleted).toBe(true);
    // Verify it's gone
    const gone = await getDocument(docId);
    expect(gone).toBeNull();
    docId = 0; // prevent afterAll double-delete
  });

  it("deleteDocument — returns false for a non-existent id", async () => {
    const deleted = await deleteDocument(999999999);
    expect(deleted).toBe(false);
  });
});
