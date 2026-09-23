import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

/**
 * Controller-level tests for POST /api/compliance/documents/venue (CV-E) —
 * the manager-only upload for a document whose subject is a venue, not a
 * staff member. compliance.integration.test.ts already proves
 * complianceService.createDocument's real-DB behaviour for a venue subject
 * (exactly-one-subject validation, cross-org 404), but it calls that service
 * function directly and never goes through handleCreateVenueDocument itself
 * — so the controller's own job (schema validation, forcing userId to null,
 * and never trusting a client-supplied subject) had zero coverage before
 * this file. Same mocked-service pattern as complianceDocumentEdit.test.ts:
 * hermetic, no DB, runs in the main CI job.
 */

vi.mock("../services/locationContextService.js", () => ({
  getUserLocationContext: vi.fn(),
}));

vi.mock("../services/complianceService.js", () => ({
  createDocument: vi.fn(),
  ComplianceError: class ComplianceError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.name = "ComplianceError";
      this.statusCode = statusCode;
    }
  },
}));

import { handleCreateVenueDocument } from "../controllers/complianceController.js";
import { getUserLocationContext } from "../services/locationContextService.js";
import { createDocument, ComplianceError } from "../services/complianceService.js";

function mockReq(opts: { user?: { sub: number }; body?: unknown }): Request {
  return {
    user: opts.user ? { sub: opts.user.sub, roles: [], permissions: [] } : undefined,
    body: opts.body ?? {},
  } as unknown as Request;
}

function mockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

const CALLER = { sub: 7 };
const VALID_BODY = {
  documentType: "Liquor Licence",
  storeLocationId: "11111111-1111-1111-1111-111111111111",
  storagePublicId: "culinaire/compliance/org-2/user-7/abc",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserLocationContext).mockResolvedValue({ organisationId: 2 } as never);
});

describe("handleCreateVenueDocument — POST /api/compliance/documents/venue", () => {
  it("forces userId to null and passes the venue as subjectStoreLocationId — never trusts a client-supplied staff subject", async () => {
    vi.mocked(createDocument).mockResolvedValue({ complianceDocumentId: "doc-1" } as never);
    // A malicious or buggy client tries to smuggle a staff userId in too —
    // the schema has no userId field, so it must be stripped, not forwarded.
    const req = mockReq({ user: CALLER, body: { ...VALID_BODY, userId: 999 } });
    const res = mockRes();
    await handleCreateVenueDocument(req, res, vi.fn());

    expect(createDocument).toHaveBeenCalledWith(2, {
      documentType: "Liquor Licence",
      storagePublicId: "culinaire/compliance/org-2/user-7/abc",
      subjectStoreLocationId: "11111111-1111-1111-1111-111111111111",
      userId: null,
      uploadedBy: 7,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ complianceDocumentId: "doc-1" });
  });

  it("400s when storeLocationId is missing — never reaches the service", async () => {
    const { storeLocationId: _omit, ...withoutVenue } = VALID_BODY;
    const req = mockReq({ user: CALLER, body: withoutVenue });
    const res = mockRes();
    await handleCreateVenueDocument(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("400s when storeLocationId is not a valid uuid — never reaches the service", async () => {
    const req = mockReq({ user: CALLER, body: { ...VALID_BODY, storeLocationId: "not-a-uuid" } });
    const res = mockRes();
    await handleCreateVenueDocument(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("400s when documentType is empty — never reaches the service", async () => {
    const req = mockReq({ user: CALLER, body: { ...VALID_BODY, documentType: "" } });
    const res = mockRes();
    await handleCreateVenueDocument(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("a cross-org venue id surfaces the service's 404, not a 500 or 403", async () => {
    vi.mocked(createDocument).mockRejectedValue(new ComplianceError("Location not found", 404));
    const req = mockReq({ user: CALLER, body: VALID_BODY });
    const res = mockRes();
    await handleCreateVenueDocument(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Location not found" });
  });

  it("400s when the caller has no organisation — never reaches the service", async () => {
    vi.mocked(getUserLocationContext).mockResolvedValue({ organisationId: null } as never);
    const req = mockReq({ user: CALLER, body: VALID_BODY });
    const res = mockRes();
    await handleCreateVenueDocument(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(createDocument).not.toHaveBeenCalled();
  });
});
