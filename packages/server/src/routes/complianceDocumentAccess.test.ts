import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

/**
 * Controller-level tests for the two Compliance Vault document-access routes
 * that shipped with no route-level tests: POST /documents/upload and
 * GET /documents/:id/view-url.
 *
 * compliancePermissions.test.ts's harness walks middleware gates only and
 * deliberately never invokes the controller (the last handler in the stack)
 * — correct for proving a permission gate is wired, but it cannot express
 * the ownership decision inside handleGetDocumentViewUrl, the
 * DocumentStorageError -> status mapping inside handleUploadDocument, or
 * that signedUrlForDocument (which writes document_access_log for BOTH
 * outcomes) is actually called on a denial. This file drives the controller
 * functions directly with every service mocked — same pattern as
 * mobileFeedbackController.test.ts. New file (not an extension of
 * compliancePermissions.test.ts) because that harness's bare req/res stub
 * and gate-only walk genuinely cannot express these cases; kept under
 * routes/ alongside it per the brief.
 *
 * Hermetic: no DB, no Cloudinary, no local disk. Runs in the default suite.
 */

vi.mock("../services/locationContextService.js", () => ({
  getUserLocationContext: vi.fn(),
}));

vi.mock("../services/documentOcrService.js", () => ({
  extractCertificateFields: vi.fn().mockResolvedValue(null),
}));

// middleware/upload.ts's uploadFileBuffer is the local-disk fallback that
// documentStorageService.ts's header comment says must NEVER be reached from
// this flow (it silently writes world-readable files when Cloudinary creds
// are missing). The controller doesn't import it today; mocking it here
// means a future edit that reaches for it "because it looked reusable" fails
// this suite instead of shipping a silent, unauthenticated disk write of a
// police check or Medicare card.
vi.mock("../middleware/upload.js", () => ({
  uploadFileBuffer: vi.fn(),
}));

vi.mock("../services/complianceService.js", () => ({
  getDocument: vi.fn(),
  // Real, simple ownership check — isOwnDocument itself is already covered
  // directly by compliancePermissions.test.ts, so it is fine to trust the
  // known truth table here rather than pull in the real db-backed module.
  isOwnDocument: (doc: { userId: number | null }, callerUserId: number) =>
    doc.userId === callerUserId,
  ComplianceError: class ComplianceError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.name = "ComplianceError";
      this.statusCode = statusCode;
    }
  },
}));

vi.mock("../services/documentStorageService.js", () => ({
  storeDocument: vi.fn(),
  signedUrlForDocument: vi.fn(),
  DocumentStorageError: class DocumentStorageError extends Error {
    status: number;
    code: string;
    constructor(message: string, status: number, code: string) {
      super(message);
      this.name = "DocumentStorageError";
      this.status = status;
      this.code = code;
    }
  },
}));

import { handleUploadDocument, handleGetDocumentViewUrl } from "../controllers/complianceController.js";
import { getUserLocationContext } from "../services/locationContextService.js";
import { uploadFileBuffer } from "../middleware/upload.js";
import { getDocument, ComplianceError } from "../services/complianceService.js";
import { storeDocument, signedUrlForDocument, DocumentStorageError } from "../services/documentStorageService.js";

function mockReq(opts: {
  user?: { sub: number; roles?: string[]; permissions?: string[] };
  params?: Record<string, string>;
  file?: { buffer: Buffer };
}): Request {
  return {
    user: opts.user
      ? { sub: opts.user.sub, roles: opts.user.roles ?? [], permissions: opts.user.permissions ?? [] }
      : undefined,
    params: opts.params ?? {},
    file: opts.file,
  } as unknown as Request;
}

function mockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserLocationContext).mockResolvedValue({ organisationId: 2 });
});

describe("handleUploadDocument — POST /api/compliance/documents/upload", () => {
  const CALLER = { sub: 7, permissions: ["compliance:read-own"] };

  it("400s when no file is attached — never reaches storage", async () => {
    const req = mockReq({ user: CALLER });
    const res = mockRes();
    await handleUploadDocument(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(storeDocument).not.toHaveBeenCalled();
    expect(uploadFileBuffer).not.toHaveBeenCalled();
  });

  it("missing Cloudinary credentials surface as the storage error's own 503, not a generic 500 — and nothing falls back to disk", async () => {
    vi.mocked(storeDocument).mockRejectedValue(
      new DocumentStorageError("Can't accept uploads right now.", 503, "STORAGE_UNCONFIGURED"),
    );
    const req = mockReq({ user: CALLER, file: { buffer: Buffer.from("x") } });
    const res = mockRes();
    const next = vi.fn();
    await handleUploadDocument(req, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: "Can't accept uploads right now." });
    // Handled explicitly by the DocumentStorageError branch, not dropped
    // into Express's generic error handler as a 500.
    expect(next).not.toHaveBeenCalled();
    expect(uploadFileBuffer).not.toHaveBeenCalled();
  });

  it("stores a valid file and echoes back the storage format the server sniffed, on success", async () => {
    vi.mocked(storeDocument).mockResolvedValue({
      publicId: "culinaire/compliance/org-2/abc",
      mime: "image/jpeg",
    });
    const req = mockReq({ user: CALLER, file: { buffer: Buffer.from("x") } });
    const res = mockRes();
    await handleUploadDocument(req, res, vi.fn());
    expect(res.json).toHaveBeenCalledWith({
      storagePublicId: "culinaire/compliance/org-2/abc",
      storageFormat: "jpg",
      ocr: null,
    });
    expect(res.status).not.toHaveBeenCalled();
    expect(uploadFileBuffer).not.toHaveBeenCalled();
  });
});

describe("handleGetDocumentViewUrl — GET /api/compliance/documents/:id/view-url", () => {
  const DOC = { complianceDocumentId: "doc-1", storagePublicId: "pub-1", storageFormat: "pdf", userId: 42 };

  it("a cross-org id is 404, never 403 — a guessed id must not confirm the document exists", async () => {
    vi.mocked(getDocument).mockRejectedValue(new ComplianceError("Document not found", 404));
    const req = mockReq({
      user: { sub: 7, permissions: ["compliance:read-all"] },
      params: { id: "doc-x" },
    });
    const res = mockRes();
    await handleGetDocumentViewUrl(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    // Never even reaches the point of deciding grant/deny for a document
    // that isn't in this org — nothing to log.
    expect(signedUrlForDocument).not.toHaveBeenCalled();
  });

  it("a staff member requesting a colleague's document with only read-own is denied 403 — and the denial is still logged", async () => {
    vi.mocked(getDocument).mockResolvedValue(DOC); // owned by userId 42
    vi.mocked(signedUrlForDocument).mockResolvedValue(null);
    const req = mockReq({
      user: { sub: 7, permissions: ["compliance:read-own"] }, // not the owner, no read-all/verify
      params: { id: "doc-1" },
    });
    const res = mockRes();
    await handleGetDocumentViewUrl(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    // signedUrlForDocument is what writes the document_access_log row for
    // BOTH outcomes (documentStorageService.ts) — a denial that skips this
    // call is the exact failure this design exists to prevent.
    expect(signedUrlForDocument).toHaveBeenCalledWith(
      expect.objectContaining({ complianceDocumentId: "doc-1", actorUserId: 7, granted: false }),
    );
  });

  it("a manager holding compliance:read-all can view a colleague's document — granted and logged", async () => {
    vi.mocked(getDocument).mockResolvedValue(DOC);
    vi.mocked(signedUrlForDocument).mockResolvedValue("https://signed.example/doc");
    const req = mockReq({
      user: { sub: 99, permissions: ["compliance:read-all"] },
      params: { id: "doc-1" },
    });
    const res = mockRes();
    await handleGetDocumentViewUrl(req, res, vi.fn());
    expect(res.json).toHaveBeenCalledWith({ url: "https://signed.example/doc" });
    expect(signedUrlForDocument).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 99, granted: true }),
    );
  });

  it("a verifier holding compliance:verify (but not read-all) can also view a colleague's document", async () => {
    vi.mocked(getDocument).mockResolvedValue(DOC);
    vi.mocked(signedUrlForDocument).mockResolvedValue("https://signed.example/doc");
    const req = mockReq({
      user: { sub: 55, permissions: ["compliance:verify"] },
      params: { id: "doc-1" },
    });
    const res = mockRes();
    await handleGetDocumentViewUrl(req, res, vi.fn());
    expect(res.json).toHaveBeenCalledWith({ url: "https://signed.example/doc" });
  });

  it("the document owner views their own document via ownership, holding only read-own", async () => {
    vi.mocked(getDocument).mockResolvedValue(DOC); // userId 42
    vi.mocked(signedUrlForDocument).mockResolvedValue("https://signed.example/doc");
    const req = mockReq({
      user: { sub: 42, permissions: ["compliance:read-own"] },
      params: { id: "doc-1" },
    });
    const res = mockRes();
    await handleGetDocumentViewUrl(req, res, vi.fn());
    expect(res.json).toHaveBeenCalledWith({ url: "https://signed.example/doc" });
  });

  it("an Administrator can view a colleague's document with no compliance permission granted explicitly (superuser bypass)", async () => {
    vi.mocked(getDocument).mockResolvedValue(DOC);
    vi.mocked(signedUrlForDocument).mockResolvedValue("https://signed.example/doc");
    const req = mockReq({
      user: { sub: 1, roles: ["Administrator"], permissions: [] },
      params: { id: "doc-1" },
    });
    const res = mockRes();
    await handleGetDocumentViewUrl(req, res, vi.fn());
    expect(res.json).toHaveBeenCalledWith({ url: "https://signed.example/doc" });
  });
});
