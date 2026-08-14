import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

let mockSettings: Record<string, string> = {};
let mockRejects = false;
vi.mock("../services/settingsService.js", () => ({
  getAllSettings: vi.fn(async () => {
    if (mockRejects) throw new Error("site_setting unreadable");
    return mockSettings;
  }),
}));

function mockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe("requireFlag", () => {
  beforeEach(() => {
    mockSettings = {};
    mockRejects = false;
  });

  it("calls next() when the flag is exactly \"true\"", async () => {
    const { requireFlag } = await import("./requireFlag.js");
    mockSettings = { roster_enabled: "true" };
    const next = vi.fn() as unknown as NextFunction;
    await requireFlag("roster_enabled")({} as Request, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("404s with no body when the flag is \"false\"", async () => {
    const { requireFlag } = await import("./requireFlag.js");
    mockSettings = { roster_enabled: "false" };
    const next = vi.fn() as unknown as NextFunction;
    const res = mockRes();
    await requireFlag("roster_enabled")({} as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.end).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });

  it("404s when the key is absent entirely, not just \"false\"", async () => {
    const { requireFlag } = await import("./requireFlag.js");
    mockSettings = {};
    const next = vi.fn() as unknown as NextFunction;
    const res = mockRes();
    await requireFlag("roster_enabled")({} as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  // Fails closed: a route this middleware guards is DB-backed anyway, so a
  // settings-read failure would fail the request regardless. 404 here costs
  // nothing and never turns a DB blip into a flag-off bypass.
  it("404s (fails closed) when the settings read itself throws", async () => {
    const { requireFlag } = await import("./requireFlag.js");
    mockRejects = true;
    const next = vi.fn() as unknown as NextFunction;
    const res = mockRes();
    await requireFlag("roster_enabled")({} as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("checks the exact key passed, not a substring or a different flag", async () => {
    const { requireFlag } = await import("./requireFlag.js");
    mockSettings = { compliance_enabled: "true" };
    const next = vi.fn() as unknown as NextFunction;
    const res = mockRes();
    await requireFlag("roster_enabled")({} as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });
});
