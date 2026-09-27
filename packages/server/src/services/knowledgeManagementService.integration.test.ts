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
  ingestFile,
  ingestUrl,
  reEmbedDocument,
  recoverStaleDocuments,
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

  it("ingestFile — returns a document id immediately for text/plain buffer", async () => {
    const buf = Buffer.from("Pork belly prep: slice to 2cm thickness, cure 24h, smoke at 82C.\n");
    const newId = await ingestFile({
      buffer: buf,
      mimeType: "text/plain",
      originalFilename: `${tag}-test.txt`,
      title: `${tag}-file-test`,
      category: "test",
      tags: ["test"],
    });
    expect(typeof newId).toBe("number");
    expect(newId).toBeGreaterThan(0);
    await db.delete(knowledgeChunk).where(eq(knowledgeChunk.documentId, newId));
    await db.delete(knowledgeDocument).where(eq(knowledgeDocument.documentId, newId));
  });

  it("reEmbedDocument — throws KnowledgeError(404) for non-existent id", async () => {
    await expect(reEmbedDocument(999999999)).rejects.toThrow(KnowledgeError);
    await expect(reEmbedDocument(999999999)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("reEmbedDocument — throws KnowledgeError(409) if document is already processing", async () => {
    const [row] = await db
      .insert(knowledgeDocument)
      .values({
        title: `${tag}-processing`,
        category: "test",
        tags: [],
        body: "processing state test",
        contentHash: `${tag}-proc-hash`,
        sourceType: "manual",
        status: "processing",
      })
      .returning({ documentId: knowledgeDocument.documentId });

    try {
      await expect(reEmbedDocument(row.documentId)).rejects.toThrow(KnowledgeError);
      await expect(reEmbedDocument(row.documentId)).rejects.toMatchObject({ statusCode: 409 });
    } finally {
      await db.delete(knowledgeChunk).where(eq(knowledgeChunk.documentId, row.documentId));
      await db.delete(knowledgeDocument).where(eq(knowledgeDocument.documentId, row.documentId));
    }
  });

  it("recoverStaleDocuments — resets stale processing docs to failed", async () => {
    const staleDate = new Date(Date.now() - 15 * 60 * 1000); // 15 min ago
    const [row] = await db
      .insert(knowledgeDocument)
      .values({
        title: `${tag}-stale`,
        category: "test",
        tags: [],
        body: "",
        contentHash: `${tag}-stale-hash`,
        sourceType: "manual",
        status: "processing",
        updatedDttm: staleDate,
      })
      .returning({ documentId: knowledgeDocument.documentId });

    try {
      const recovered = await recoverStaleDocuments();
      expect(recovered).toBeGreaterThanOrEqual(1);

      const doc = await getDocument(row.documentId);
      expect(doc?.status).toBe("failed");
      expect(doc?.errorMessage).toContain("server restart");
    } finally {
      await db.delete(knowledgeChunk).where(eq(knowledgeChunk.documentId, row.documentId));
      await db.delete(knowledgeDocument).where(eq(knowledgeDocument.documentId, row.documentId));
    }
  });
});

// SSRF guard tests — no DB required, run in CI
describe("ingestUrl — SSRF validation (no DB)", () => {
  it("rejects private IPv4 addresses", async () => {
    await expect(ingestUrl({ url: "http://192.168.1.1/data", title: "x", category: "test", tags: [] }))
      .rejects.toThrow(KnowledgeError);
    await expect(ingestUrl({ url: "http://192.168.1.1/data", title: "x", category: "test", tags: [] }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects loopback addresses", async () => {
    await expect(ingestUrl({ url: "http://127.0.0.1/secret", title: "x", category: "test", tags: [] }))
      .rejects.toThrow(KnowledgeError);
  });

  it("rejects localhost", async () => {
    await expect(ingestUrl({ url: "http://localhost:3000/api", title: "x", category: "test", tags: [] }))
      .rejects.toThrow(KnowledgeError);
  });

  it("rejects non-http protocols", async () => {
    await expect(ingestUrl({ url: "file:///etc/passwd", title: "x", category: "test", tags: [] }))
      .rejects.toThrow(KnowledgeError);
  });

  it("rejects cloud metadata endpoints", async () => {
    await expect(ingestUrl({ url: "http://169.254.169.254/latest/meta-data", title: "x", category: "test", tags: [] }))
      .rejects.toThrow(KnowledgeError);
  });

  it("rejects 10.x private range", async () => {
    await expect(ingestUrl({ url: "http://10.0.0.1/admin", title: "x", category: "test", tags: [] }))
      .rejects.toThrow(KnowledgeError);
  });

  it("rejects 172.16.x.x private range", async () => {
    await expect(ingestUrl({ url: "http://172.16.0.1/secret", title: "x", category: "test", tags: [] }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects .local suffix", async () => {
    await expect(ingestUrl({ url: "http://server.local/data", title: "x", category: "test", tags: [] }))
      .rejects.toThrow(KnowledgeError);
  });

  it("rejects .internal suffix", async () => {
    await expect(ingestUrl({ url: "http://k8s-api.internal/", title: "x", category: "test", tags: [] }))
      .rejects.toThrow(KnowledgeError);
  });

  it("rejects metadata.google.com", async () => {
    await expect(ingestUrl({ url: "http://metadata.google.com/", title: "x", category: "test", tags: [] }))
      .rejects.toThrow(KnowledgeError);
  });

  it("rejects IPv6 loopback", async () => {
    await expect(ingestUrl({ url: "http://[::1]/secret", title: "x", category: "test", tags: [] }))
      .rejects.toThrow(KnowledgeError);
  });

  it("rejects malformed URL", async () => {
    await expect(ingestUrl({ url: "not-a-url", title: "x", category: "test", tags: [] }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it("SSRF guard still fires when crawl:true", async () => {
    await expect(ingestUrl({ url: "http://192.168.1.1/", title: "x", category: "test", tags: [], crawl: true }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});
