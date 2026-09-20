import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

/**
 * Controller-level tests for POST /api/compliance/documents/:id/nudge
 * (CV-C7) — the staff-side "remind HQ to verify this" action.
 * compliance.integration.test.ts already proves nudgeVerifier's real-DB
 * behaviour (48h eligibility, 24h throttle, ownership 404, non-Pending 409),
 * but it calls that service function directly and never goes through
 * handleNudgeDocument itself — so the controller's own job (resolving org
 * context, reading the id param, mapping ComplianceError) had zero coverage
 * before this file. Same hermetic mocked-service pattern as
 * complianceVenueDocument.test.ts.
 */

vi.mock("../services/locationContextService.js", () => ({
  getUserLocationContext: vi.fn(),
}));

vi.mock("../services/complianceService.js", () => ({
  nudgeVerifier: vi.fn(),
  ComplianceError: class ComplianceError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.name = "ComplianceError";
      this.statusCode = statusCode;
    }
  },
}));

import { handleNudgeDocument } from "../controllers/complianceController.js";
import { getUserLocationContext } from "../services/locationContextService.js";
import { nudgeVerifier, ComplianceError } from "../services/complianceService.js";

function mockReq(opts: { user?: { sub: number }; params?: Record<string, string> }): Request {
  return {
    user: opts.user ? { sub: opts.user.sub, roles: [], permissions: [] } : undefined,
    params: opts.params ?? {},
  } as unknown as Request;
}

function mockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

const CALLER = { sub: 7 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserLocationContext).mockResolvedValue({ organisationId: 2 } as never);
});

describe("handleNudgeDocument — POST /api/compliance/documents/:id/nudge", () => {
  it("nudges with the resolved org, the param id, and the caller as the nudger, on success", async () => {
    vi.mocked(nudgeVerifier).mockResolvedValue(undefined as never);
    const req = mockReq({ user: CALLER, params: { id: "doc-1" } });
    const res = mockRes();
    await handleNudgeDocument(req, res, vi.fn());

    expect(nudgeVerifier).toHaveBeenCalledWith(2, "doc-1", 7);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it("a ComplianceError from nudgeVerifier surfaces as its own statusCode/message, not a 500", async () => {
    vi.mocked(nudgeVerifier).mockRejectedValue(new ComplianceError("Already nudged in the last 24 hours", 409));
    const req = mockReq({ user: CALLER, params: { id: "doc-1" } });
    const res = mockRes();
    const next = vi.fn();
    await handleNudgeDocument(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "Already nudged in the last 24 hours" });
    expect(next).not.toHaveBeenCalled();
  });

  it("400s when the caller has no organisation — never reaches the service", async () => {
    vi.mocked(getUserLocationContext).mockResolvedValue({ organisationId: null } as never);
    const req = mockReq({ user: CALLER, params: { id: "doc-1" } });
    const res = mockRes();
    await handleNudgeDocument(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(nudgeVerifier).not.toHaveBeenCalled();
  });
});
