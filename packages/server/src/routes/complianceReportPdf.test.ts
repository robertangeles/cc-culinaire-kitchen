import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

/**
 * Boundary tests for `GET /api/compliance/report.pdf`.
 *
 * Permission-gate assertions drive the ACTUAL middleware Express wired onto
 * the route (not `requirePermission` in isolation) — copied structurally
 * from compliancePermissions.test.ts's `layerFor`/`runGates` pattern, scoped
 * to just this one route so this file stays independent of that one.
 *
 * The controller-level assertions (cross-org 404, success returns a PDF)
 * mock the service and PDF renderer so they stay fast and hermetic — no DB,
 * no real @react-pdf/renderer render.
 */

vi.mock("../services/locationContextService.js", () => ({
  getUserLocationContext: vi.fn(),
}));

vi.mock("../services/complianceService.js", async () => {
  const actual = await vi.importActual<typeof import("../services/complianceService.js")>(
    "../services/complianceService.js",
  );
  return { ...actual, getComplianceReportData: vi.fn() };
});

vi.mock("../services/compliancePdfService.js", () => ({
  generateComplianceReportPdf: vi.fn(),
}));

import complianceRouter from "./compliance.js";
import { handleDownloadComplianceReportPdf } from "../controllers/complianceController.js";
import { getUserLocationContext } from "../services/locationContextService.js";
import { getComplianceReportData, ComplianceError } from "../services/complianceService.js";
import { generateComplianceReportPdf } from "../services/compliancePdfService.js";

// ─── Permission gate ────────────────────────────────────────────────

type Handler = (req: Request, res: Response, next: () => void) => void;

/** The middleware stack Express actually wired for `GET /report.pdf`. */
function reportGates(): Handler[] {
  const layer = (complianceRouter as any).stack.find(
    (l: any) => l.route?.path === "/report.pdf" && l.route?.methods?.get,
  );
  if (!layer) throw new Error("no route wired for GET /report.pdf");
  return layer.route.stack.map((s: any) => s.handle);
}

/** Drive every gate (never the controller) with this user and report what happened. */
function runGates(handlers: Handler[], user: unknown): { status: number | null } {
  const req = { user, params: {}, query: {}, body: {}, headers: {} } as unknown as Request;
  let status: number | null = null;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;

  for (const handler of handlers.slice(0, -1)) {
    let advanced = false;
    handler(req, res, () => {
      advanced = true;
    });
    if (!advanced) return { status };
  }
  return { status };
}

describe("GET /report.pdf — permission boundary", () => {
  it("is wired (a path typo would silently 404 in prod)", () => {
    expect(() => reportGates()).not.toThrow();
  });

  it("401 without a token", () => {
    expect(runGates(reportGates(), undefined).status).toBe(401);
  });

  it("403 with no permissions", () => {
    expect(
      runGates(reportGates(), { sub: 1, roles: ["Subscriber"], permissions: [] }).status,
    ).toBe(403);
  });

  it("403 for compliance:read-own alone (viewing your own docs isn't the org export)", () => {
    expect(
      runGates(reportGates(), {
        sub: 1,
        roles: ["Subscriber"],
        permissions: ["compliance:read-own"],
      }).status,
    ).toBe(403);
  });

  it("passes with compliance:read-all", () => {
    expect(
      runGates(reportGates(), {
        sub: 1,
        roles: ["Subscriber"],
        permissions: ["compliance:read-all"],
      }).status,
    ).toBeNull();
  });

  it("Administrator bypasses the gate", () => {
    expect(
      runGates(reportGates(), { sub: 1, roles: ["Administrator"], permissions: [] }).status,
    ).toBeNull();
  });
});

// ─── Controller ─────────────────────────────────────────────────────

function mockReq(query: Record<string, unknown> = {}): Request {
  return { user: { sub: 1 }, query } as unknown as Request;
}

function mockRes() {
  const headers: Record<string, string> = {};
  return {
    statusCode: 200 as number,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json: vi.fn(),
    setHeader: vi.fn(function (this: any, key: string, value: string) {
      headers[key] = value;
    }),
    send: vi.fn(),
    headers,
  };
}

describe("handleDownloadComplianceReportPdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserLocationContext).mockResolvedValue({
      locations: [],
      selectedLocationId: null,
      organisationId: 5,
      isOrgAdmin: false,
      hasLocationAccess: false,
    });
  });

  it("a storeLocationId belonging to another org is 404, never 403", async () => {
    vi.mocked(getComplianceReportData).mockRejectedValue(
      new ComplianceError("Location not found", 404),
    );
    const req = mockReq({ storeLocationId: "11111111-1111-1111-1111-111111111111" });
    const res = mockRes();

    await handleDownloadComplianceReportPdf(req, res as unknown as Response, vi.fn());

    expect(res.statusCode).toBe(404);
    expect(generateComplianceReportPdf).not.toHaveBeenCalled();
  });

  it("returns a PDF with the right headers on the success path (org-wide, no storeLocationId)", async () => {
    vi.mocked(getComplianceReportData).mockResolvedValue({
      organisationName: "Almost French Pâtisserie",
      venueName: null,
      documentTypes: ["RSA"],
      staff: [],
    });
    const buffer = Buffer.from("%PDF-fake");
    vi.mocked(generateComplianceReportPdf).mockResolvedValue(buffer);
    const req = mockReq();
    const res = mockRes();

    await handleDownloadComplianceReportPdf(req, res as unknown as Response, vi.fn());

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("application/pdf");
    expect(res.headers["Content-Disposition"]).toContain("attachment");
    expect(res.headers["Content-Disposition"]).toContain(".pdf");
    expect(res.send).toHaveBeenCalledWith(buffer);
    expect(getComplianceReportData).toHaveBeenCalledWith(5, undefined);
  });

  it("a malformed storeLocationId is a 400, not a raw DB error", async () => {
    const req = mockReq({ storeLocationId: "not-a-uuid" });
    const res = mockRes();

    await handleDownloadComplianceReportPdf(req, res as unknown as Response, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(getComplianceReportData).not.toHaveBeenCalled();
  });

  it("a PDF render timeout maps to a plain-language 500, not a raw stack", async () => {
    vi.mocked(getComplianceReportData).mockResolvedValue({
      organisationName: "Almost French Pâtisserie",
      venueName: null,
      documentTypes: [],
      staff: [],
    });
    vi.mocked(generateComplianceReportPdf).mockRejectedValue(
      new Error("PDF generation timed out"),
    );
    const req = mockReq();
    const res = mockRes();

    await handleDownloadComplianceReportPdf(req, res as unknown as Response, vi.fn());

    expect(res.statusCode).toBe(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("timed out") }),
    );
  });
});
