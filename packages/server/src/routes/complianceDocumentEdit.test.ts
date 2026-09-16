import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

/**
 * Controller-level tests for PUT/DELETE /api/compliance/documents/:id — the
 * self-service edit/delete that lets a staff member fix or remove their own
 * Pending/Rejected upload without a manager. Same pattern as
 * complianceDocumentAccess.test.ts: every service call mocked, so this is
 * hermetic (no DB, no Cloudinary) and runs in the main CI job. The
 * Pending/Rejected-only guard and the ownership 404 both live in
 * complianceService.updateDocument/deleteDocument, which is a DB-backed
 * function — this file only proves the controller forwards the caller,
 * validates input, and maps ComplianceError to the right status.
 */

vi.mock("../services/locationContextService.js", () => ({
  getUserLocationContext: vi.fn(),
}));

vi.mock("../services/complianceService.js", () => ({
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
  ComplianceError: class ComplianceError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.name = "ComplianceError";
      this.statusCode = statusCode;
    }
  },
}));

import { handleUpdateDocument, handleDeleteDocument } from "../controllers/complianceController.js";
import { getUserLocationContext } from "../services/locationContextService.js";
import { updateDocument, deleteDocument, ComplianceError } from "../services/complianceService.js";

function mockReq(opts: {
  user?: { sub: number };
  params?: Record<string, string>;
  body?: unknown;
}): Request {
  return {
    user: opts.user ? { sub: opts.user.sub, roles: [], permissions: [] } : undefined,
    params: opts.params ?? {},
    body: opts.body ?? {},
  } as unknown as Request;
}

function mockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserLocationContext).mockResolvedValue({ organisationId: 2 });
});

describe("handleUpdateDocument — PUT /api/compliance/documents/:id", () => {
  const CALLER = { sub: 7 };

  it("forwards the caller's org and id, and the validated body, to updateDocument", async () => {
    vi.mocked(updateDocument).mockResolvedValue({ complianceDocumentId: "doc-1" } as never);
    const req = mockReq({
      user: CALLER,
      params: { id: "doc-1" },
      body: { documentNumber: "ABC123", expiryDate: "2027-01-01" },
    });
    const res = mockRes();
    await handleUpdateDocument(req, res, vi.fn());
    expect(updateDocument).toHaveBeenCalledWith(2, "doc-1", 7, {
      documentNumber: "ABC123",
      expiryDate: "2027-01-01",
    });
    expect(res.json).toHaveBeenCalledWith({ complianceDocumentId: "doc-1" });
  });

  it("400s on a field over its length limit — never reaches the service", async () => {
    const req = mockReq({
      user: CALLER,
      params: { id: "doc-1" },
      body: { documentNumber: "x".repeat(101) },
    });
    const res = mockRes();
    await handleUpdateDocument(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(updateDocument).not.toHaveBeenCalled();
  });

  it("a Verified document's 409 from the service passes through as-is", async () => {
    vi.mocked(updateDocument).mockRejectedValue(new ComplianceError("Can't edit a document that is verified", 409));
    const req = mockReq({ user: CALLER, params: { id: "doc-1" }, body: {} });
    const res = mockRes();
    await handleUpdateDocument(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "Can't edit a document that is verified" });
  });

  it("a colleague's document is a 404, not a 403 — mirrors handleGetDocument", async () => {
    vi.mocked(updateDocument).mockRejectedValue(new ComplianceError("Document not found", 404));
    const req = mockReq({ user: CALLER, params: { id: "doc-x" }, body: {} });
    const res = mockRes();
    await handleUpdateDocument(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("handleDeleteDocument — DELETE /api/compliance/documents/:id", () => {
  const CALLER = { sub: 7 };

  it("deletes and responds 204 with no body", async () => {
    vi.mocked(deleteDocument).mockResolvedValue(undefined);
    const req = mockReq({ user: CALLER, params: { id: "doc-1" } });
    const res = mockRes();
    await handleDeleteDocument(req, res, vi.fn());
    expect(deleteDocument).toHaveBeenCalledWith(2, "doc-1", 7);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("a Verified document's 409 from the service passes through as-is", async () => {
    vi.mocked(deleteDocument).mockRejectedValue(
      new ComplianceError("Can't delete a document that is verified", 409),
    );
    const req = mockReq({ user: CALLER, params: { id: "doc-1" } });
    const res = mockRes();
    await handleDeleteDocument(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "Can't delete a document that is verified" });
  });
});
