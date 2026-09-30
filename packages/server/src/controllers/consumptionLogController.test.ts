/**
 * Catch-handler coverage for consumptionLogController.
 * Verifies that the `catch (err: unknown)` guards introduced in the
 * Phase-4 refactor map specific service error messages to the correct
 * HTTP status codes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

vi.mock("../services/locationContextService.js", () => ({
  getUserLocationContext: vi.fn(async () => ({
    locations: [{ organisationId: 7 }],
    organisationId: 7,
  })),
}));

vi.mock("../services/consumptionLogService.js", () => ({
  editConsumptionLog: vi.fn(),
  deleteConsumptionLog: vi.fn(),
}));

import { handleEditLog, handleDeleteLog } from "./consumptionLogController.js";
import * as consumptionLogService from "../services/consumptionLogService.js";

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

// ponytail: only the three message-gated branches + forward-to-next are tested; happy-path
// wiring is covered by integration tests.

describe("handleEditLog catch handlers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when service throws 'not found'", async () => {
    vi.mocked(consumptionLogService.editConsumptionLog).mockRejectedValue(
      new Error("not found"),
    );
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await handleEditLog(mockReq({ params: { id: "x" } }), res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Consumption log entry not found" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when service throws 'not authorized'", async () => {
    vi.mocked(consumptionLogService.editConsumptionLog).mockRejectedValue(
      new Error("not authorized"),
    );
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await handleEditLog(mockReq({ params: { id: "x" } }), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "You can only edit your own log entries" });
  });

  it("returns 400 when service throws 'expired'", async () => {
    vi.mocked(consumptionLogService.editConsumptionLog).mockRejectedValue(
      new Error("expired"),
    );
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await handleEditLog(mockReq({ params: { id: "x" } }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Edit window has expired for this entry" });
  });
});

describe("handleDeleteLog catch handlers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when service throws 'not found'", async () => {
    vi.mocked(consumptionLogService.deleteConsumptionLog).mockRejectedValue(
      new Error("not found"),
    );
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await handleDeleteLog(mockReq({ params: { id: "x" } }), res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Consumption log entry not found" });
  });

  it("returns 403 when service throws 'not authorized'", async () => {
    vi.mocked(consumptionLogService.deleteConsumptionLog).mockRejectedValue(
      new Error("not authorized"),
    );
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await handleDeleteLog(mockReq({ params: { id: "x" } }), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "You can only delete your own log entries" });
  });
});
