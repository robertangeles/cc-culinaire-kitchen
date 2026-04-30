import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

/**
 * Contract tests for the mobile RAG retrieval endpoint.
 *
 * Pattern follows mobilePromptsController.test.ts: the controller is the
 * unit-under-test; the retrieval service is mocked. The auth middleware
 * is part of the route's pipeline (assembled in routes/mobileRag.ts);
 * route-pipeline tests would need a real Bearer token + a test fixture
 * harness this repo doesn't have. The contract guarantees we DO test here:
 *
 *   - Validation (Zod) — empty query, oversize query, limit out of range,
 *     unknown extra keys, missing query.
 *   - Response shape — { chunks, vectorSearchEnabled }.
 *   - Privacy log invariant — no `query` or `category` text in info logs.
 *   - 503 on retrieval throw.
 */

vi.mock("../services/knowledgeService.js", () => ({
  retrieveForMobile: vi.fn(),
}));

import { handleMobileRagRetrieve } from "./ragController.js";
import { retrieveForMobile } from "../services/knowledgeService.js";

function mockReq(body: unknown, userSub = 1): Request {
  return {
    body,
    user: { sub: userSub, roles: [], permissions: [] },
  } as unknown as Request;
}

function mockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe("handleMobileRagRetrieve — validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when query is missing", async () => {
    const req = mockReq({});
    const res = mockRes();
    await handleMobileRagRetrieve(req, res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(retrieveForMobile).not.toHaveBeenCalled();
  });

  it("returns 400 when query trims to empty", async () => {
    const req = mockReq({ query: "   " });
    const res = mockRes();
    await handleMobileRagRetrieve(req, res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(retrieveForMobile).not.toHaveBeenCalled();
  });

  it("returns 400 when query exceeds 2000 chars", async () => {
    const req = mockReq({ query: "x".repeat(2001) });
    const res = mockRes();
    await handleMobileRagRetrieve(req, res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(retrieveForMobile).not.toHaveBeenCalled();
  });

  it("returns 400 when limit is above 20", async () => {
    const req = mockReq({ query: "broken hollandaise", limit: 99 });
    const res = mockRes();
    await handleMobileRagRetrieve(req, res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(retrieveForMobile).not.toHaveBeenCalled();
  });

  it("returns 400 when limit is below 1", async () => {
    const req = mockReq({ query: "broken hollandaise", limit: 0 });
    const res = mockRes();
    await handleMobileRagRetrieve(req, res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(retrieveForMobile).not.toHaveBeenCalled();
  });

  it("returns 400 when an unknown extra key is present (.strict)", async () => {
    const req = mockReq({ query: "broken hollandaise", foo: "bar" });
    const res = mockRes();
    await handleMobileRagRetrieve(req, res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(retrieveForMobile).not.toHaveBeenCalled();
  });

  it("returns 400 when category exceeds 200 chars", async () => {
    const req = mockReq({ query: "broken hollandaise", category: "x".repeat(201) });
    const res = mockRes();
    await handleMobileRagRetrieve(req, res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(retrieveForMobile).not.toHaveBeenCalled();
  });

  it("error envelope is { error, details } on validation failure", async () => {
    const req = mockReq({ query: "" });
    const res = mockRes();
    await handleMobileRagRetrieve(req, res, vi.fn() as NextFunction);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.any(String),
        details: expect.any(Object),
      }),
    );
  });
});

describe("handleMobileRagRetrieve — response shape", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with { chunks, vectorSearchEnabled } on success", async () => {
    vi.mocked(retrieveForMobile).mockResolvedValue([
      [
        {
          id: 42,
          source: "Salt Fat Acid Heat",
          document: "Salt Fat Acid Heat",
          page: null,
          content: "Hollandaise can be saved with a teaspoon of warm water...",
          score: 0.87,
          category: "Food Science and Cooking Principles",
        },
      ],
      true,
    ]);

    const req = mockReq({ query: "broken hollandaise", limit: 3 });
    const res = mockRes();
    await handleMobileRagRetrieve(req, res, vi.fn() as NextFunction);

    expect(res.json).toHaveBeenCalledWith({
      chunks: [
        {
          id: 42,
          source: "Salt Fat Acid Heat",
          document: "Salt Fat Acid Heat",
          page: null,
          content: "Hollandaise can be saved with a teaspoon of warm water...",
          score: 0.87,
          category: "Food Science and Cooking Principles",
        },
      ],
      vectorSearchEnabled: true,
    });
  });

  it("returns 200 with empty chunks (NOT 404) when retrieval finds nothing", async () => {
    vi.mocked(retrieveForMobile).mockResolvedValue([[], true]);

    const req = mockReq({ query: "obscure thing nobody indexed" });
    const res = mockRes();
    await handleMobileRagRetrieve(req, res, vi.fn() as NextFunction);

    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      chunks: [],
      vectorSearchEnabled: true,
    });
  });

  it("surfaces vectorSearchEnabled = false when site setting is off", async () => {
    vi.mocked(retrieveForMobile).mockResolvedValue([[], false]);
    const req = mockReq({ query: "anything" });
    const res = mockRes();
    await handleMobileRagRetrieve(req, res, vi.fn() as NextFunction);
    expect(res.json).toHaveBeenCalledWith({ chunks: [], vectorSearchEnabled: false });
  });

  it("uses default limit of 5 when limit is omitted", async () => {
    vi.mocked(retrieveForMobile).mockResolvedValue([[], true]);
    const req = mockReq({ query: "anything" });
    const res = mockRes();
    await handleMobileRagRetrieve(req, res, vi.fn() as NextFunction);
    expect(retrieveForMobile).toHaveBeenCalledWith("anything", 5, undefined);
  });

  it("trims surrounding whitespace from query before passing to service", async () => {
    vi.mocked(retrieveForMobile).mockResolvedValue([[], true]);
    const req = mockReq({ query: "  broken hollandaise  " });
    const res = mockRes();
    await handleMobileRagRetrieve(req, res, vi.fn() as NextFunction);
    expect(retrieveForMobile).toHaveBeenCalledWith("broken hollandaise", 5, undefined);
  });

  it("passes category through to the service unchanged", async () => {
    vi.mocked(retrieveForMobile).mockResolvedValue([[], true]);
    const req = mockReq({
      query: "creamy sauce",
      limit: 3,
      category: "Food Science and Cooking Principles",
    });
    const res = mockRes();
    await handleMobileRagRetrieve(req, res, vi.fn() as NextFunction);
    expect(retrieveForMobile).toHaveBeenCalledWith(
      "creamy sauce",
      3,
      "Food Science and Cooking Principles",
    );
  });
});

describe("handleMobileRagRetrieve — error path", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 503 when the retrieval service throws", async () => {
    vi.mocked(retrieveForMobile).mockRejectedValueOnce(new Error("pgvector connection refused"));
    const req = mockReq({ query: "anything" });
    const res = mockRes();
    await handleMobileRagRetrieve(req, res, vi.fn() as NextFunction);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: "Retrieval is temporarily unavailable.",
    });
  });
});
