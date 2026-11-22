/**
 * Receiving confirm / cancel on a session in the wrong state: the illegal transition must reach the
 * error handler as 409 INVALID_STATE (what the phone's offline queue branches on), not a bare 400.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

vi.mock("../services/locationContextService.js", () => ({
  getUserLocationContext: vi.fn(async () => ({ locations: [{ organisationId: 7 }], organisationId: 7 })),
  assertLocationAccess: vi.fn(),
}));

vi.mock("../services/receivingService.js", () => ({
  getSessionLocationId: vi.fn(async () => null),
  confirmReceipt: vi.fn(),
  cancelSession: vi.fn(),
}));

vi.mock("../services/creditNoteService.js", () => ({}));

import { handleConfirmReceipt, handleCancelSession } from "./receivingController.js";
import * as receivingService from "../services/receivingService.js";
import { validateTransition, RECEIVING_SESSION_TRANSITIONS } from "../utils/stateTransition.js";
import { errorHandler } from "../middleware/errorHandler.js";

function mockReq(): Request {
  return { body: {}, params: { sessionId: "s-1" }, query: {}, headers: {}, user: { sub: 1 } } as unknown as Request;
}

function mockRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), headersSent: false } as unknown as Response;
}

describe("receiving session in the wrong state", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["confirm", handleConfirmReceipt, "confirmReceipt", "CANCELLED", "COMPLETED"],
    ["cancel", handleCancelSession, "cancelSession", "COMPLETED", "CANCELLED"],
  ] as const)("%s answers 409 INVALID_STATE through the error handler", async (_name, handler, serviceFn, from, to) => {
    vi.mocked(receivingService[serviceFn]).mockImplementation(async () => {
      validateTransition(from, to, RECEIVING_SESSION_TRANSITIONS, "receiving session");
      return undefined as never;
    });
    const res = mockRes();
    const next = ((err: Error) => errorHandler(err, mockReq(), res, vi.fn())) as unknown as NextFunction;

    await handler(mockReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: `Cannot transition receiving session from ${from} to ${to}`,
      code: "INVALID_STATE",
    });
  });

  it("still answers 400 for a session that does not exist", async () => {
    vi.mocked(receivingService.confirmReceipt).mockRejectedValue(new Error("Receiving session not found"));
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await handleConfirmReceipt(mockReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
