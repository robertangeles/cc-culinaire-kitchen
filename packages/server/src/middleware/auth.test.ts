import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../services/authService.js", () => ({
  verifyAccessToken: vi.fn(),
}));

import { authenticate, authenticateOptional } from "./auth.js";
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
