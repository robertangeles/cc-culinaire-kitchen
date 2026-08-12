import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../services/authService.js", () => ({
  verifyAccessToken: vi.fn(),
}));

import { authenticate, authenticateOptional, hasPermission, requirePermission } from "./auth.js";
import { verifyAccessToken } from "../services/authService.js";

function mockReq(opts: { authHeader?: string; cookieToken?: string } = {}): Request {
  return {
    headers: opts.authHeader ? { authorization: opts.authHeader } : {},
    cookies: opts.cookieToken ? { access_token: opts.cookieToken } : {},
  } as unknown as Request;
}

function mockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe("authenticateOptional", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls next() with req.user undefined when no token is present", () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    authenticateOptional(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("attaches req.user when a valid Bearer token is present", () => {
    vi.mocked(verifyAccessToken).mockReturnValue({
      sub: 7,
      roles: ["User"],
      permissions: [],
    });
    const req = mockReq({ authHeader: "Bearer valid.jwt.here" });
    const res = mockRes();
    const next = vi.fn();
    authenticateOptional(req, res, next);
    expect(verifyAccessToken).toHaveBeenCalledWith("valid.jwt.here");
    expect(req.user).toEqual({ sub: 7, roles: ["User"], permissions: [] });
    expect(next).toHaveBeenCalled();
  });

  // Critical: an invalid token must NOT silently downgrade to anonymous.
  // That would let attackers bypass per-user rate limits by sending forged
  // tokens — they'd be classified as anon (3/hr per IP) instead of being
  // rejected outright.
  it("401s on a malformed/expired Bearer token (no silent downgrade)", () => {
    vi.mocked(verifyAccessToken).mockImplementation(() => {
      throw new Error("jwt expired");
    });
    const req = mockReq({ authHeader: "Bearer bogus" });
    const res = mockRes();
    const next = vi.fn();
    authenticateOptional(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches req.user when a valid cookie token is present", () => {
    vi.mocked(verifyAccessToken).mockReturnValue({
      sub: 12,
      roles: ["Administrator"],
      permissions: ["admin:users"],
    });
    const req = mockReq({ cookieToken: "cookie.jwt.here" });
    const res = mockRes();
    const next = vi.fn();
    authenticateOptional(req, res, next);
    expect(verifyAccessToken).toHaveBeenCalledWith("cookie.jwt.here");
    expect(req.user?.sub).toBe(12);
    expect(next).toHaveBeenCalled();
  });
});

/**
 * CRITICAL REGRESSION SUITE.
 *
 * `hasPermission` was extracted out of `requirePermission` so that non-HTTP
 * callers (the Antoine compliance tools) can ask the same authorization question
 * instead of reimplementing the Administrator bypass. Every gated route in the
 * app now routes its decision through this function, so a regression here is an
 * app-wide authorization failure — either locking everyone out or letting
 * everyone in.
 *
 * The route-level matrix is covered by navPermissions.test.ts and
 * storageAreaPermissions.test.ts; this asserts the decision itself.
 */
describe("hasPermission (extracted authorization decision)", () => {
  it("Administrator passes with an EMPTY permission list (superuser bypass)", () => {
    expect(hasPermission({ roles: ["Administrator"], permissions: [] }, "compliance:read-all")).toBe(
      true,
    );
  });

  it("Administrator passes even for a permission that does not exist yet", () => {
    expect(
      hasPermission({ roles: ["Administrator"], permissions: [] }, "not:seeded:yet"),
    ).toBe(true);
  });

  it("returns true when the principal holds the required permission", () => {
    expect(
      hasPermission({ roles: ["Subscriber"], permissions: ["compliance:read-own"] }, "compliance:read-own"),
    ).toBe(true);
  });

  it("returns true when the principal holds ANY of several accepted permissions", () => {
    expect(
      hasPermission(
        { roles: ["Subscriber"], permissions: ["compliance:verify"] },
        "compliance:read-all",
        "compliance:verify",
      ),
    ).toBe(true);
  });

  it("returns false when the principal holds none of them", () => {
    expect(
      hasPermission({ roles: ["Subscriber"], permissions: ["waste:read"] }, "compliance:read-all"),
    ).toBe(false);
  });

  it("returns false for an empty principal", () => {
    expect(hasPermission({ roles: [], permissions: [] }, "compliance:read-all")).toBe(false);
  });

  // A non-Administrator role name must never be treated as a superuser.
  it("does not treat other role names as superusers", () => {
    expect(
      hasPermission({ roles: ["Admin", "administrator"], permissions: [] }, "compliance:read-all"),
    ).toBe(false);
  });
});

describe("requirePermission (thin wrapper — HTTP status contract unchanged)", () => {
  function gateReq(user?: { roles: string[]; permissions: string[] }): Request {
    return { user: user ? { sub: 1, ...user } : undefined } as unknown as Request;
  }

  it("401s with no authenticated user", () => {
    const res = mockRes();
    const next = vi.fn();
    requirePermission("compliance:read-all")(gateReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("403s when authenticated but unauthorized", () => {
    const res = mockRes();
    const next = vi.fn();
    requirePermission("compliance:read-all")(
      gateReq({ roles: ["Subscriber"], permissions: [] }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when authorized", () => {
    const res = mockRes();
    const next = vi.fn();
    requirePermission("compliance:read-all")(
      gateReq({ roles: ["Subscriber"], permissions: ["compliance:read-all"] }),
      res,
      next,
    );
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next() for an Administrator with no explicit permission", () => {
    const res = mockRes();
    const next = vi.fn();
    requirePermission("compliance:read-all")(
      gateReq({ roles: ["Administrator"], permissions: [] }),
      res,
      next,
    );
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("authenticate (regression — required-auth path unchanged)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401s when no token is present", () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    authenticate(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches req.user on a valid Bearer token", () => {
    vi.mocked(verifyAccessToken).mockReturnValue({
      sub: 1,
      roles: [],
      permissions: [],
    });
    const req = mockReq({ authHeader: "Bearer x" });
    const res = mockRes();
    const next = vi.fn();
    authenticate(req, res, next);
    expect(req.user?.sub).toBe(1);
    expect(next).toHaveBeenCalled();
  });
});
