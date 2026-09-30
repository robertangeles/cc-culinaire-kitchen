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
  receiveLine: vi.fn(),
  cancelPO: vi.fn(),
  approvePO: vi.fn(),
  rejectPO: vi.fn(),
  clonePO: vi.fn(),
  emailPOToSupplier: vi.fn(),
}));

vi.mock("../services/pdfService.js", () => ({
  generatePOPdf: vi.fn(),
}));

vi.mock("../services/brainCaptureService.js", () => ({
  recordOpsEvent: vi.fn(),
}));

import {
  handleSubmitPO,
  handleEmailPOToSupplier,
  handleDownloadPOPdf,
} from "./purchaseOrderController.js";
import * as purchaseOrderService from "../services/purchaseOrderService.js";
import * as pdfService from "../services/pdfService.js";

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

describe("handleEmailPOToSupplier catch handlers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when service throws 'not found'", async () => {
    vi.mocked(purchaseOrderService.emailPOToSupplier).mockRejectedValue(
      new Error("Purchase order not found"),
    );
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await handleEmailPOToSupplier(mockReq({ params: { id: "po-1" } }), res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Purchase order not found" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 when service throws 'Only a sent'", async () => {
    vi.mocked(purchaseOrderService.emailPOToSupplier).mockRejectedValue(
      new Error("Only a sent PO can be emailed again"),
    );
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await handleEmailPOToSupplier(mockReq({ params: { id: "po-1" } }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Only a sent PO can be emailed again" });
    expect(next).not.toHaveBeenCalled();
  });
});

describe("handleDownloadPOPdf catch handlers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 500 when pdf service throws 'timed out'", async () => {
    vi.mocked(pdfService.generatePOPdf).mockRejectedValue(
      new Error("PDF generation timed out"),
    );
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await handleDownloadPOPdf(mockReq({ params: { id: "po-1" } }), res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "PDF generation timed out — please try again",
    });
    expect(next).not.toHaveBeenCalled();
  });
});
