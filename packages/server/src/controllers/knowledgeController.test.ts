import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

vi.mock("../services/knowledgeManagementService.js", () => {
  class KnowledgeError extends Error {
    constructor(message: string, public readonly statusCode: number) {
      super(message);
      this.name = "KnowledgeError";
    }
  }
  return {
    KnowledgeError,
    ingestFile: vi.fn(),
    ingestUrl: vi.fn(),
    ingestManual: vi.fn(),
    reEmbedDocument: vi.fn(),
    deleteDocument: vi.fn(),
    listDocuments: vi.fn(),
    getDocument: vi.fn(),
  };
});

import { handleSubmitUrl, handleReEmbed } from "./knowledgeController.js";
import { ingestUrl, reEmbedDocument, KnowledgeError } from "../services/knowledgeManagementService.js";

function mockReq(overrides: Partial<Request> = {}): Request {
  return { body: {}, params: {}, query: {}, headers: {}, ...overrides } as unknown as Request;
}

function mockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe("handleSubmitUrl", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns KnowledgeError statusCode and message", async () => {
    vi.mocked(ingestUrl).mockRejectedValue(
      new KnowledgeError("URL not allowed: private or reserved address", 400),
    );

    const req = mockReq({
      body: { url: "http://169.254.169.254/", title: "Meta", category: "General" },
    });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await handleSubmitUrl(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "URL not allowed: private or reserved address" });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next for non-KnowledgeError", async () => {
    vi.mocked(ingestUrl).mockRejectedValue(new Error("unexpected"));

    const req = mockReq({
      body: { url: "https://example.com", title: "Page", category: "General" },
    });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await handleSubmitUrl(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe("handleReEmbed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 with human message for DOCUMENT_NOT_FOUND", async () => {
    vi.mocked(reEmbedDocument).mockRejectedValue(new KnowledgeError("DOCUMENT_NOT_FOUND", 404));

    const req = mockReq({ params: { id: "99" } });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await handleReEmbed(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Document not found." });
  });

  it("returns 409 with human message for ALREADY_PROCESSING", async () => {
    vi.mocked(reEmbedDocument).mockRejectedValue(new KnowledgeError("ALREADY_PROCESSING", 409));

    const req = mockReq({ params: { id: "5" } });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await handleReEmbed(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "Document is already being processed." });
  });

  it("calls next for non-KnowledgeError", async () => {
    vi.mocked(reEmbedDocument).mockRejectedValue(new Error("db down"));

    const req = mockReq({ params: { id: "1" } });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await handleReEmbed(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
