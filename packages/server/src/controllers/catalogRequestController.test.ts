/**
 * Catch-handler coverage for catalogRequestController.
 * Verifies that the `catch (err: unknown)` guards introduced in the
 * Phase-4 refactor map specific service error messages to the correct
 * HTTP status codes.
 *
 * Value: protects=handleApproveRequest and handleRejectRequest map "Request not found" → 404,
 *   "Request already reviewed" → 409, and unknown errors → next(err);
 *   fails_when=the message-match guards are removed, swapped, or the status codes change;
 *   why_new=no tests existed for these catch branches prior to Phase 4;
 *   seam=none
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

vi.mock("../services/locationContextService.js", () => ({
  getUserLocationContext: vi.fn(async () => ({
    locations: [{ organisationId: 7 }],
    organisationId: 7,
  })),
}));

vi.mock("../services/catalogRequestService.js", () => ({
  requestNewItem: vi.fn(),
  listPendingRequests: vi.fn(),
  approveRequest: vi.fn(),
  rejectRequest: vi.fn(),
}));

import { handleApproveRequest, handleRejectRequest } from "./catalogRequestController.js";
import * as catalogRequestService from "../services/catalogRequestService.js";

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    user: { sub: 1 },
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

// ponytail: only the three message-gated branches + forward-to-next are tested;
// happy-path wiring is covered by integration tests.

describe("handleApproveRequest catch handlers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when service throws 'Request not found'", async () => {
    vi.mocked(catalogRequestService.approveRequest).mockRejectedValue(
      new Error("Request not found"),
    );
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await handleApproveRequest(mockReq({ params: { id: "req-1" } }), res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Request not found" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 409 when service throws 'Request already reviewed'", async () => {
    vi.mocked(catalogRequestService.approveRequest).mockRejectedValue(
      new Error("Request already reviewed"),
    );
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await handleApproveRequest(mockReq({ params: { id: "req-1" } }), res, next);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "Request already reviewed" });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next(err) for unknown errors", async () => {
    const boom = new Error("DB connection lost");
    vi.mocked(catalogRequestService.approveRequest).mockRejectedValue(boom);
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await handleApproveRequest(mockReq({ params: { id: "req-1" } }), res, next);
    expect(next).toHaveBeenCalledWith(boom);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("handleRejectRequest catch handlers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when service throws 'Request not found'", async () => {
    vi.mocked(catalogRequestService.rejectRequest).mockRejectedValue(
      new Error("Request not found"),
    );
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await handleRejectRequest(
      mockReq({ params: { id: "req-1" }, body: { reason: "duplicate" } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Request not found" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 409 when service throws 'Request already reviewed'", async () => {
    vi.mocked(catalogRequestService.rejectRequest).mockRejectedValue(
      new Error("Request already reviewed"),
    );
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await handleRejectRequest(
      mockReq({ params: { id: "req-1" }, body: { reason: "duplicate" } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "Request already reviewed" });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next(err) for unknown errors", async () => {
    const boom = new Error("DB connection lost");
    vi.mocked(catalogRequestService.rejectRequest).mockRejectedValue(boom);
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await handleRejectRequest(
      mockReq({ params: { id: "req-1" }, body: { reason: "duplicate" } }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledWith(boom);
    expect(res.status).not.toHaveBeenCalled();
  });
});
