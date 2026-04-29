import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// Mock the service layer before importing the controller. The controller
// only owns slug validation, error-to-status mapping, and structured logs;
// the service is the unit-under-test elsewhere.
vi.mock("../services/promptService.js", () => ({
  getDevicePromptForMobile: vi.fn(),
}));

import { handleGetMobilePrompt } from "./mobilePromptsController.js";
import { getDevicePromptForMobile } from "../services/promptService.js";
import {
  PromptNotFoundError,
  PromptNotDeviceRuntimeError,
} from "../errors/promptErrors.js";

function mockReq(slug: string, userSub?: number): Request {
  return {
    params: { slug },
    user: userSub != null ? { sub: userSub, roles: [], permissions: [] } : undefined,
  } as unknown as Request;
}

function mockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe("handleGetMobilePrompt — slug validation (Zod)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 for slugs containing path-traversal characters", async () => {
    const req = mockReq("..%2Fetc-passwd", 1);
    const res = mockRes();
    const next = vi.fn();

    await handleGetMobilePrompt(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Invalid prompt slug." }),
    );
    // Service must never be invoked for an invalid slug — the regex is the
    // boundary that prevents user-controlled strings from reaching the DB query.
    expect(getDevicePromptForMobile).not.toHaveBeenCalled();
  });

  it("returns 400 for slugs containing uppercase letters", async () => {
    const req = mockReq("Antoine-System-Prompt", 1);
    const res = mockRes();
    const next = vi.fn();

    await handleGetMobilePrompt(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(getDevicePromptForMobile).not.toHaveBeenCalled();
  });

  it("returns 400 for empty slugs", async () => {
    const req = mockReq("", 1);
    const res = mockRes();
    const next = vi.fn();

    await handleGetMobilePrompt(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(getDevicePromptForMobile).not.toHaveBeenCalled();
  });

  it("accepts valid slugs (lowercase, digits, hyphens)", async () => {
    vi.mocked(getDevicePromptForMobile).mockResolvedValue({
      promptKey: "antoine-system-prompt",
      promptBody: "body",
      runtime: "device",
      modelId: null,
      version: 2,
      updatedAtDttm: new Date("2026-04-28T13:08:57Z"),
    });

    const req = mockReq("antoine-system-prompt", 1);
    const res = mockRes();
    const next = vi.fn();

    await handleGetMobilePrompt(req, res, next);

    expect(getDevicePromptForMobile).toHaveBeenCalledWith("antoine-system-prompt");
    expect(res.json).toHaveBeenCalled();
  });
});

describe("handleGetMobilePrompt — error-to-status mapping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps PromptNotFoundError to 404 with generic message", async () => {
    vi.mocked(getDevicePromptForMobile).mockRejectedValue(
      new PromptNotFoundError("does-not-exist"),
    );

    const req = mockReq("does-not-exist", 1);
    const res = mockRes();
    const next = vi.fn();

    await handleGetMobilePrompt(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Prompt not found." });
    expect(next).not.toHaveBeenCalled();
  });

  it("maps PromptNotDeviceRuntimeError to 404 with the SAME generic message", async () => {
    // Critical security invariant: server-runtime prompts and missing slugs
    // must be indistinguishable to the caller. If this drifts (e.g. the
    // controller starts returning a different message or status for the
    // server-runtime case), an authenticated caller can enumerate which
    // slugs are server-only — exactly the reconnaissance vector this guard
    // closes.
    vi.mocked(getDevicePromptForMobile).mockRejectedValue(
      new PromptNotDeviceRuntimeError("system-prompt"),
    );

    const req = mockReq("system-prompt", 1);
    const res = mockRes();
    const next = vi.fn();

    await handleGetMobilePrompt(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    // EXACTLY the same body as the not-found case — no leak.
    expect(res.json).toHaveBeenCalledWith({ error: "Prompt not found." });
    expect(next).not.toHaveBeenCalled();
  });

  it("forwards unrecognised errors to next() (so errorHandler maps them to 500)", async () => {
    const unknown = new Error("DB connection lost");
    vi.mocked(getDevicePromptForMobile).mockRejectedValue(unknown);

    const req = mockReq("antoine-system-prompt", 1);
    const res = mockRes();
    const next = vi.fn();

    await handleGetMobilePrompt(req, res, next);

    expect(next).toHaveBeenCalledWith(unknown);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("handleGetMobilePrompt — happy path response shape", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with promptKey, body, runtime, modelId, version, updatedAtDttm", async () => {
    const stamp = new Date("2026-04-28T13:08:57Z");
    vi.mocked(getDevicePromptForMobile).mockResolvedValue({
      promptKey: "antoine-system-prompt",
      promptBody: "# Antoine — body",
      runtime: "device",
      modelId: null,
      version: 2,
      updatedAtDttm: stamp,
    });

    const req = mockReq("antoine-system-prompt", 42);
    const res = mockRes();
    const next = vi.fn();

    await handleGetMobilePrompt(req, res, next);

    // The mobile client caches by `version` and refetches when its cached
    // value is below the server's. If `version` ever stops being a number
    // here (e.g. someone refactors the join and forgets to coerce), the
    // mobile cache logic silently breaks.
    expect(res.json).toHaveBeenCalledWith({
      promptKey: "antoine-system-prompt",
      promptBody: "# Antoine — body",
      runtime: "device",
      modelId: null,
      version: 2,
      updatedAtDttm: stamp,
    });
    expect(next).not.toHaveBeenCalled();
  });
});
