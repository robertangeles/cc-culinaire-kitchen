import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

const verifyAccessToken = vi.fn();
vi.mock("../services/authService.js", () => ({ verifyAccessToken: (t: string) => verifyAccessToken(t) }));
const getGuestSession = vi.fn();
vi.mock("../services/guestService.js", () => ({ getGuestSession: (t: string) => getGuestSession(t) }));

import { authenticateOrGuest } from "./guestAuth.js";

function run(req: Partial<Request>) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
  const next = vi.fn();
  const full = { headers: {}, cookies: {}, ...req } as Request;
  return authenticateOrGuest(full, res, next).then(() => ({ req: full, res, next }));
}

describe("authenticateOrGuest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyAccessToken.mockImplementation((t: string) => {
      if (t === "good") return { sub: 7, roles: [], permissions: [] };
      throw new Error("bad token");
    });
    getGuestSession.mockResolvedValue(null);
  });

  it("signs in a phone that sends the access token as a Bearer header", async () => {
    const { req, next } = await run({ headers: { authorization: "Bearer good" } });
    expect(req.user).toMatchObject({ sub: 7 });
    expect(next).toHaveBeenCalledOnce();
  });

  it("still signs in a browser with the access_token cookie", async () => {
    const { req, next } = await run({ cookies: { access_token: "good" } });
    expect(req.user).toMatchObject({ sub: 7 });
    expect(next).toHaveBeenCalledOnce();
  });

  it("falls back to the guest token when the Bearer token is bad", async () => {
    getGuestSession.mockResolvedValue({ id: 1 });
    const { req, next } = await run({ headers: { authorization: "Bearer nope", "x-guest-token": "g1" } });
    expect(req.user).toBeUndefined();
    expect(req.guestToken).toBe("g1");
    expect(next).toHaveBeenCalledOnce();
  });

  it("answers 401 when there is no token of either kind", async () => {
    const { res, next } = await run({});
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
