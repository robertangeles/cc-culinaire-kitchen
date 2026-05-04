/**
 * Unit tests for the mobile feedback controller. Mirrors the testing
 * pattern in `mobilePromptsController.test.ts`: service is mocked, the
 * controller is the unit under test for zod validation and the
 * auth/anon split. The service layer is exercised in feedbackService.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../services/feedbackService.js", () => ({
  saveFeedback: vi.fn(),
}));

import { handlePostMobileFeedback } from "./mobileFeedbackController.js";
import { saveFeedback } from "../services/feedbackService.js";

function mockReq(opts: {
  body?: unknown;
  appVersion?: string | undefined;
  userSub?: number;
}): Request {
  return {
    body: opts.body,
    mobileAppVersion: opts.appVersion,
    user:
      opts.userSub != null
        ? { sub: opts.userSub, roles: [], permissions: [] }
        : undefined,
  } as unknown as Request;
}

function mockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

const VALID_BODY = {
  subject: "Crash on tap",
  body: "Tapping the share button crashes the app.",
  category: "bug" as const,
  device_info: {
    device_model: "Pixel 8",
    os_name: "android" as const,
    os_version: "14",
    locale: "en-AU",
    app_version: "1.3.0",
  },
  screenshot_base64: null,
};

describe("handlePostMobileFeedback — zod validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(saveFeedback).mockResolvedValue({
      id: 42,
      createdDttm: "2026-05-04T12:00:00.000Z",
    });
  });

  it("returns 201 with id + created_dttm on a valid auth submission", async () => {
    const req = mockReq({ body: VALID_BODY, appVersion: "1.3.0", userSub: 7 });
    const res = mockRes();
    await handlePostMobileFeedback(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      id: 42,
      created_dttm: "2026-05-04T12:00:00.000Z",
    });
    expect(saveFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, isAnonymous: false }),
    );
  });

  it("treats a request with no req.user as anonymous", async () => {
    const req = mockReq({ body: VALID_BODY, appVersion: "1.3.0" });
    const res = mockRes();
    await handlePostMobileFeedback(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(201);
    expect(saveFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, isAnonymous: true }),
    );
  });

  it("returns 400 when subject is missing", async () => {
    const req = mockReq({
      body: { ...VALID_BODY, subject: undefined },
      appVersion: "1.3.0",
      userSub: 7,
    });
    const res = mockRes();
    await handlePostMobileFeedback(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(saveFeedback).not.toHaveBeenCalled();
  });

  it("returns 400 when subject exceeds 120 chars", async () => {
    const req = mockReq({
      body: { ...VALID_BODY, subject: "a".repeat(121) },
      appVersion: "1.3.0",
      userSub: 7,
    });
    const res = mockRes();
    await handlePostMobileFeedback(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when body exceeds 4000 chars", async () => {
    const req = mockReq({
      body: { ...VALID_BODY, body: "x".repeat(4001) },
      appVersion: "1.3.0",
      userSub: 7,
    });
    const res = mockRes();
    await handlePostMobileFeedback(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 for an unknown category enum value", async () => {
    const req = mockReq({
      body: { ...VALID_BODY, category: "complaint" },
      appVersion: "1.3.0",
      userSub: 7,
    });
    const res = mockRes();
    await handlePostMobileFeedback(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  // PRIVACY INVARIANT — see schema.ts comments. If this test fails, the
  // device_info schema has been relaxed away from `.strict()`. STOP and do
  // a coordinated mobile + privacy review before merging.
  it("returns 400 when device_info contains an unknown key (privacy invariant)", async () => {
    const req = mockReq({
      body: {
        ...VALID_BODY,
        device_info: { ...VALID_BODY.device_info, advertising_id: "abc" },
      },
      appVersion: "1.3.0",
      userSub: 7,
    });
    const res = mockRes();
    await handlePostMobileFeedback(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(saveFeedback).not.toHaveBeenCalled();
  });

  // PRIVACY INVARIANT — same as above, top-level body is also `.strict()`.
  it("returns 400 when the request body contains an unknown top-level key", async () => {
    const req = mockReq({
      body: { ...VALID_BODY, ip_address: "8.8.8.8" },
      appVersion: "1.3.0",
      userSub: 7,
    });
    const res = mockRes();
    await handlePostMobileFeedback(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(saveFeedback).not.toHaveBeenCalled();
  });

  it("rejects screenshot_base64 with a `data:image/...` prefix", async () => {
    const req = mockReq({
      body: { ...VALID_BODY, screenshot_base64: "data:image/png;base64,iVBORw0KG" },
      appVersion: "1.3.0",
      userSub: 7,
    });
    const res = mockRes();
    await handlePostMobileFeedback(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects screenshot_base64 longer than 700 KB", async () => {
    const req = mockReq({
      body: { ...VALID_BODY, screenshot_base64: "A".repeat(700_001) },
      appVersion: "1.3.0",
      userSub: 7,
    });
    const res = mockRes();
    await handlePostMobileFeedback(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("accepts a valid base64 screenshot", async () => {
    const req = mockReq({
      body: { ...VALID_BODY, screenshot_base64: "iVBORw0KGgoAAAANSUhEUg==" },
      appVersion: "1.3.0",
      userSub: 7,
    });
    const res = mockRes();
    await handlePostMobileFeedback(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("returns 400 when the version-guard didn't run (defensive)", async () => {
    const req = mockReq({ body: VALID_BODY, appVersion: undefined, userSub: 7 });
    const res = mockRes();
    await handlePostMobileFeedback(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "missing_app_version" });
    expect(saveFeedback).not.toHaveBeenCalled();
  });

  it("delegates service errors to next() (not 500-in-controller)", async () => {
    vi.mocked(saveFeedback).mockRejectedValue(new Error("DB exploded"));
    const req = mockReq({ body: VALID_BODY, appVersion: "1.3.0", userSub: 7 });
    const res = mockRes();
    const next = vi.fn();
    await handlePostMobileFeedback(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalledWith(201);
  });
});
