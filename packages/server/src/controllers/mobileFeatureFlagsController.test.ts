import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

vi.mock("../services/featureFlagsService.js", () => ({
  getMobileFeatureFlags: vi.fn(),
}));

import { handleGetMobileFeatureFlags } from "./mobileFeatureFlagsController.js";
import { getMobileFeatureFlags } from "../services/featureFlagsService.js";

const mockGet = getMobileFeatureFlags as unknown as ReturnType<typeof vi.fn>;

function mockReq(): Request {
  return { user: { sub: 1, roles: [], permissions: [] } } as unknown as Request;
}

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

beforeEach(() => vi.clearAllMocks());

describe("handleGetMobileFeatureFlags", () => {
  it("returns the flags payload from the service", async () => {
    mockGet.mockResolvedValueOnce({ languages_enabled: ["en", "fr"] });
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await handleGetMobileFeatureFlags(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ languages_enabled: ["en", "fr"] });
    expect(next).not.toHaveBeenCalled();
  });

  it("sets a 1-hour public Cache-Control header so edge caches can serve it", async () => {
    mockGet.mockResolvedValueOnce({ languages_enabled: ["en"] });
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await handleGetMobileFeatureFlags(req, res, next);

    expect(res.set).toHaveBeenCalledWith("Cache-Control", "public, max-age=3600");
  });

  it("forwards service errors to next() rather than swallowing them", async () => {
    const boom = new Error("DB unreachable");
    mockGet.mockRejectedValueOnce(boom);
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await handleGetMobileFeatureFlags(req, res, next);

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.json).not.toHaveBeenCalled();
  });
});
