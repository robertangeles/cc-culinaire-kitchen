import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

/**
 * Controller-level tests for the award-rule CSV import routes:
 * POST /roster/award-rules/import/preview and .../import/commit.
 * awardRuleCsvImport.ts's own unit tests already prove the CSV parsing and
 * commit behaviour; this file covers the controller's own job (req.file
 * presence, request-body schema validation, and mapping AwardRuleError via
 * handleServiceError) which had zero coverage before. Same hermetic
 * mocked-service pattern as complianceVenueDocument.test.ts.
 */

vi.mock("../services/awardRuleCsvImport.js", () => ({
  previewAwardRuleCsv: vi.fn(),
  commitAwardRuleCsvImport: vi.fn(),
}));

vi.mock("../services/awardRuleService.js", () => ({
  AwardRuleError: class AwardRuleError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.name = "AwardRuleError";
      this.statusCode = statusCode;
    }
  },
}));

import { handleAwardRuleCsvPreview, handleAwardRuleCsvCommit } from "../controllers/rosterController.js";
import { previewAwardRuleCsv, commitAwardRuleCsvImport } from "../services/awardRuleCsvImport.js";
import { AwardRuleError } from "../services/awardRuleService.js";

function mockReq(opts: {
  user?: { sub: number };
  file?: { buffer: Buffer };
  body?: unknown;
}): Request {
  return {
    user: opts.user ? { sub: opts.user.sub, roles: [], permissions: [] } : undefined,
    file: opts.file,
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
const VALID_ROW = {
  rowIndex: 1,
  awardCode: "MA000009",
  ruleType: "max_ordinary_hours",
  jurisdiction: "VIC",
  thresholdValue: 4,
  effectiveFrom: "2020-01-01",
  sourceCitation: "MA000009 cl 32",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleAwardRuleCsvPreview — POST /roster/award-rules/import/preview", () => {
  it("400s when no file is attached — never reaches the service", async () => {
    const req = mockReq({ user: CALLER });
    const res = mockRes();
    await handleAwardRuleCsvPreview(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(previewAwardRuleCsv).not.toHaveBeenCalled();
  });

  it("parses the uploaded buffer as utf-8 and returns the service's result, on success", async () => {
    const preview = { valid: [VALID_ROW], invalid: [] };
    vi.mocked(previewAwardRuleCsv).mockReturnValue(preview as never);
    const req = mockReq({ user: CALLER, file: { buffer: Buffer.from("award,rule\nMA000009,max_ordinary_hours") } });
    const res = mockRes();
    await handleAwardRuleCsvPreview(req, res, vi.fn());

    expect(previewAwardRuleCsv).toHaveBeenCalledWith("award,rule\nMA000009,max_ordinary_hours");
    expect(res.json).toHaveBeenCalledWith(preview);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("an AwardRuleError from previewAwardRuleCsv surfaces as its own statusCode/message, not a generic 500", async () => {
    vi.mocked(previewAwardRuleCsv).mockImplementation(() => {
      throw new AwardRuleError("The CSV file has no data rows", 400);
    });
    const req = mockReq({ user: CALLER, file: { buffer: Buffer.from("") } });
    const res = mockRes();
    const next = vi.fn();
    await handleAwardRuleCsvPreview(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "The CSV file has no data rows" });
    expect(next).not.toHaveBeenCalled();
  });
});

describe("handleAwardRuleCsvCommit — POST /roster/award-rules/import/commit", () => {
  it("400s when rows is empty — never reaches the service", async () => {
    const req = mockReq({ user: CALLER, body: { rows: [] } });
    const res = mockRes();
    await handleAwardRuleCsvCommit(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(commitAwardRuleCsvImport).not.toHaveBeenCalled();
  });

  it("400s when a row is missing a required field — never reaches the service", async () => {
    const { awardCode: _omit, ...withoutAwardCode } = VALID_ROW;
    const req = mockReq({ user: CALLER, body: { rows: [withoutAwardCode] } });
    const res = mockRes();
    await handleAwardRuleCsvCommit(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(commitAwardRuleCsvImport).not.toHaveBeenCalled();
  });

  it("commits the parsed rows with the caller as actor, and returns the service's result, on success", async () => {
    const result = { imported: 1, skipped: 0, errors: [] };
    vi.mocked(commitAwardRuleCsvImport).mockResolvedValue(result as never);
    const req = mockReq({ user: CALLER, body: { rows: [VALID_ROW] } });
    const res = mockRes();
    await handleAwardRuleCsvCommit(req, res, vi.fn());

    expect(commitAwardRuleCsvImport).toHaveBeenCalledWith([VALID_ROW], 7);
    expect(res.json).toHaveBeenCalledWith(result);
    expect(res.status).not.toHaveBeenCalled();
  });
});
