import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../services/authService.js", () => {
  class AuthError extends Error {
    constructor(message: string, public readonly code: string, public readonly statusCode: number) {
      super(message);
      this.name = "AuthError";
    }
  }
  return { AuthError, generateTokens: vi.fn(), getSignInTime: vi.fn() };
});
vi.mock("../services/appleSignInService.js", () => ({ signInWithApple: vi.fn(), linkAppleToUser: vi.fn() }));
vi.mock("./authController.js", () => ({ setAuthCookies: vi.fn() }));

import { AuthError, generateTokens, getSignInTime } from "../services/authService.js";
import { linkAppleToUser, signInWithApple } from "../services/appleSignInService.js";
import { handleAppleIdToken, handleAppleLink } from "./appleAuthController.js";

const body = { identityToken: "tok", nonce: "n-0123456789abcdef0123456789abcdef" };
const req = (b: unknown, extra: Partial<Request> = {}) => ({ body: b, cookies: {}, headers: {}, ...extra }) as unknown as Request;
const res = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), cookie: vi.fn().mockReturnThis() }) as unknown as Response;

beforeEach(() => vi.clearAllMocks());

describe("handleAppleIdToken", () => {
  it("answers 200 with the user and the token pair, the same shape as the other sign-ins", async () => {
    const authUser = { userId: 7, userName: "Ada" };
    vi.mocked(signInWithApple).mockResolvedValue(authUser as never);
    vi.mocked(generateTokens).mockResolvedValue({ accessToken: "A", refreshToken: "R" } as never);
    const r = res();
    await handleAppleIdToken(req({ ...body, givenName: "Ada" }), r, vi.fn());
    expect(signInWithApple).toHaveBeenCalledWith({ ...body, givenName: "Ada" });
    expect(r.json).toHaveBeenCalledWith({ user: authUser, tokens: { accessToken: "A", refreshToken: "R" } });
  });

  it.each([
    ["no body", undefined],
    ["no token", { nonce: body.nonce }],
    ["no nonce", { identityToken: "tok" }],
    ["a short nonce (a guessable one defeats the replay check)", { identityToken: "tok", nonce: "abc" }],
    ["an oversized token", { identityToken: "x".repeat(5000), nonce: body.nonce }],
  ])("answers 400 VALIDATION for %s, without calling the service", async (_name, b) => {
    const r = res();
    await handleAppleIdToken(req(b), r, vi.fn());
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ code: "VALIDATION", error: expect.any(String) }));
    expect(signInWithApple).not.toHaveBeenCalled();
  });

  it.each([
    ["APPLE_TOKEN_INVALID", 401],
    ["APPLE_NOT_CONFIGURED", 503],
    ["APPLE_UNAVAILABLE", 503],
    ["APPLE_EMAIL_MISSING", 400],
    ["APPLE_EMAIL_NOT_VERIFIED", 403],
    ["ACCOUNT_EMAIL_UNVERIFIED", 409],
    ["APPLE_ALREADY_LINKED", 409],
    ["ACCOUNT_SUSPENDED", 403],
    ["ACCOUNT_CANCELLED", 403],
  ])("answers %s as %i with { error, code }", async (code, status) => {
    vi.mocked(signInWithApple).mockRejectedValue(new AuthError("Sentence for people.", code, status));
    const r = res();
    await handleAppleIdToken(req(body), r, vi.fn());
    expect(r.status).toHaveBeenCalledWith(status);
    expect(r.json).toHaveBeenCalledWith({ error: "Sentence for people.", code });
  });

  it("hands an unexpected failure to the error middleware instead of leaking it", async () => {
    vi.mocked(signInWithApple).mockRejectedValue(new Error("db exploded"));
    const next = vi.fn();
    const r = res();
    await handleAppleIdToken(req(body), r, next);
    expect(next).toHaveBeenCalled();
    expect(r.json).not.toHaveBeenCalled();
  });
});

describe("handleAppleLink", () => {
  const authed = (b: unknown) => req(b, { user: { sub: 9 } } as Partial<Request>);

  it("links with the proof from the body, the sign-in time of the presented session, and answers { linked: true }", async () => {
    const at = new Date();
    vi.mocked(getSignInTime).mockResolvedValue(at);
    const r = res();
    await handleAppleLink(authed({ ...body, password: "pw", mfaCode: "123456" }), r, vi.fn());
    expect(linkAppleToUser).toHaveBeenCalledWith(9, body, { password: "pw", mfaCode: "123456" }, at);
    expect(r.json).toHaveBeenCalledWith({ linked: true });
  });

  it("answers 400 VALIDATION for a bad body and 401 without a session", async () => {
    const r = res();
    await handleAppleLink(authed({ identityToken: "tok" }), r, vi.fn());
    expect(r.status).toHaveBeenCalledWith(400);
    const anon = res();
    await handleAppleLink(req(body), anon, vi.fn());
    expect(anon.status).toHaveBeenCalledWith(401);
    expect(anon.json).toHaveBeenCalledWith({ error: "Not authenticated.", code: "UNAUTHENTICATED" });
    expect(linkAppleToUser).not.toHaveBeenCalled();
  });

  it("passes the proof refusals through with their codes", async () => {
    vi.mocked(linkAppleToUser).mockRejectedValue(new AuthError("Incorrect password.", "INVALID_CREDENTIALS", 403));
    const r = res();
    await handleAppleLink(authed(body), r, vi.fn());
    expect(r.status).toHaveBeenCalledWith(403);
    expect(r.json).toHaveBeenCalledWith({ error: "Incorrect password.", code: "INVALID_CREDENTIALS" });
  });
});
