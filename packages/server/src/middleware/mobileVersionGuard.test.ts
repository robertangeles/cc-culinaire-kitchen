import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { mobileVersionGuard, compareSemver } from "./mobileVersionGuard.js";

function mockReq(headerValue?: string): Request {
  return {
    headers: headerValue ? { "x-mobile-app-version": headerValue } : {},
  } as unknown as Request;
}

function mockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe("compareSemver", () => {
  it("orders major versions correctly", () => {
    expect(compareSemver("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0", "2.0.0")).toBeLessThan(0);
  });

  it("orders minor and patch versions", () => {
    expect(compareSemver("1.3.0", "1.2.99")).toBeGreaterThan(0);
    expect(compareSemver("1.3.0", "1.3.0")).toBe(0);
    expect(compareSemver("1.3.0", "1.3.1")).toBeLessThan(0);
  });

  it("ignores pre-release / build metadata", () => {
    expect(compareSemver("1.3.0-rc.1", "1.3.0")).toBe(0);
  });

  it("throws on malformed input", () => {
    expect(() => compareSemver("not-semver", "1.0.0")).toThrow();
  });
});

describe("mobileVersionGuard", () => {
  it("400s when X-Mobile-App-Version is absent", () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    mobileVersionGuard()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "missing_app_version" });
    expect(next).not.toHaveBeenCalled();
  });

  it("400s on a malformed semver header", () => {
    const req = mockReq("v1.3");
    const res = mockRes();
    const next = vi.fn();
    mobileVersionGuard()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches req.mobileAppVersion and continues when valid", () => {
    const req = mockReq("1.3.0");
    const res = mockRes();
    const next = vi.fn();
    mobileVersionGuard()(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect((req as Request & { mobileAppVersion?: string }).mobileAppVersion).toBe("1.3.0");
  });

  it("does NOT 426 below the min when enforceMin is false (default)", () => {
    // Default MIN_MOBILE_APP_VERSION is "1.3.0" via env.ts.
    const req = mockReq("1.0.0");
    const res = mockRes();
    const next = vi.fn();
    mobileVersionGuard()(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("426s below the min when enforceMin is true", () => {
    const req = mockReq("1.0.0");
    const res = mockRes();
    const next = vi.fn();
    mobileVersionGuard({ enforceMin: true })(req, res, next);
    expect(res.status).toHaveBeenCalledWith(426);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "upgrade_required", minVersion: "1.3.0" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("passes through at exactly the min version", () => {
    const req = mockReq("1.3.0");
    const res = mockRes();
    const next = vi.fn();
    mobileVersionGuard({ enforceMin: true })(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("passes through above the min version", () => {
    const req = mockReq("1.5.2");
    const res = mockRes();
    const next = vi.fn();
    mobileVersionGuard({ enforceMin: true })(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
