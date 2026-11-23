/**
 * Catch-handler coverage for purchaseOrderController.
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

vi.mock("../services/purchaseOrderService.js", () => ({
  createPO: vi.fn(),
  listPOs: vi.fn(),
  getPODetail: vi.fn(),
  submitPO: vi.fn(),
  cancelPO: vi.fn(),
  approvePO: vi.fn(),
  rejectPO: vi.fn(),
  clonePO: vi.fn(),
  emailPOToSupplier: vi.fn(),
  withApprovalRights: vi.fn(),
}));

vi.mock("../services/pdfService.js", () => ({
  generatePOPdf: vi.fn(),
}));

vi.mock("../services/brainCaptureService.js", () => ({
  recordOpsEvent: vi.fn(),
}));

import {
  handleSubmitPO,
  handleCancelPO,
  handleApprovePO,
  handleEmailPOToSupplier,
  handleDownloadPOPdf,
} from "./purchaseOrderController.js";
import * as purchaseOrderService from "../services/purchaseOrderService.js";
import * as pdfService from "../services/pdfService.js";
import { validateTransition, PO_TRANSITIONS } from "../utils/stateTransition.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { AppError } from "../utils/appError.js";

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
    setHeader: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

// ponytail: message-gated branches + forward-to-next only; happy-path covered by integration tests.

describe("handleSubmitPO catch handlers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when service throws 'Cannot submit'", async () => {
    vi.mocked(purchaseOrderService.submitPO).mockRejectedValue(
      new Error("Cannot submit a cancelled order"),
    );
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await handleSubmitPO(mockReq({ params: { id: "po-1" } }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Cannot submit a cancelled order" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 when service throws 'not found'", async () => {
    vi.mocked(purchaseOrderService.submitPO).mockRejectedValue(
      new Error("Purchase order not found"),
    );
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await handleSubmitPO(mockReq({ params: { id: "po-1" } }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Purchase order not found" });
    expect(next).not.toHaveBeenCalled();
  });
});

describe("email, PDF and approve answer the service's coded errors through the error handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["email", "ALREADY_EMAILED", () => vi.mocked(purchaseOrderService.emailPOToSupplier), handleEmailPOToSupplier, new AppError(409, "ALREADY_EMAILED", "This order was just emailed")],
    ["email", "NOT_FOUND", () => vi.mocked(purchaseOrderService.emailPOToSupplier), handleEmailPOToSupplier, new AppError(404, "NOT_FOUND", "Purchase order not found")],
    ["pdf", "PDF_TIMEOUT", () => vi.mocked(pdfService.generatePOPdf), handleDownloadPOPdf, new AppError(503, "PDF_TIMEOUT", "The PDF took too long")],
    ["approve", "SELF_APPROVAL_NOT_ALLOWED", () => vi.mocked(purchaseOrderService.approvePO), handleApprovePO, new AppError(403, "SELF_APPROVAL_NOT_ALLOWED", "Another approver must approve it")],
  ] as const)("%s answers %s", async (_name, _code, mock, handler, err) => {
    (mock() as unknown as { mockRejectedValue: (e: Error) => void }).mockRejectedValue(err);
    const res = mockRes();
    (res as unknown as { headersSent: boolean }).headersSent = false;
    const next = ((e: Error) => errorHandler(e, mockReq(), res, vi.fn())) as unknown as NextFunction;
    await handler(mockReq({ params: { id: "po-1" } }), res, next);
    expect(res.status).toHaveBeenCalledWith(err.statusCode);
    expect(res.json).toHaveBeenCalledWith({ error: err.message, code: err.code });
  });
});

describe("PO submit / cancel on an order in the wrong state", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["submit", handleSubmitPO, "submitPO"],
    ["cancel", handleCancelPO, "cancelPO"],
    ["approve", handleApprovePO, "approvePO"],
  ] as const)("%s answers 409 INVALID_STATE through the error handler, not 500", async (_name, handler, serviceFn) => {
    vi.mocked(purchaseOrderService[serviceFn]).mockImplementation(async () => {
      validateTransition("RECEIVED", "CANCELLED", PO_TRANSITIONS, "purchase order");
      return undefined as never;
    });
    const res = mockRes();
    (res as unknown as { headersSent: boolean }).headersSent = false;
    const next = ((err: Error) => errorHandler(err, mockReq(), res, vi.fn())) as unknown as NextFunction;

    await handler(mockReq({ params: { id: "po-1" } }), res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: "Cannot transition purchase order from RECEIVED to CANCELLED",
      code: "INVALID_STATE",
    });
  });
});
