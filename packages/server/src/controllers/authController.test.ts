import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// Mock the auth service before importing the controller
vi.mock("../services/authService.js", () => ({
  registerUser: vi.fn(),
  loginUser: vi.fn(),
  generateTokens: vi.fn(),
  refreshAccessToken: vi.fn(),
  revokeRefreshToken: vi.fn(),
  getUserWithRolesAndPermissions: vi.fn(),
  verifyEmail: vi.fn(),
  resendVerification: vi.fn(),
  getGoogleAuthUrl: vi.fn(() => "https://accounts.google.com/oauth"),
  handleOAuthCallback: vi.fn(),
  generateMfaSecret: vi.fn(),
  enableMfa: vi.fn(),
  disableMfa: vi.fn(),
  completeMfaLogin: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
}));

// Turnstile verification is mocked so no real Cloudflare/DB call is made.
// Default is "passes"; individual tests override to simulate a failed check.
const mockVerifyTurnstile = vi.fn();
vi.mock("../services/turnstileService.js", () => ({
  verifyTurnstileToken: (...args: unknown[]) => mockVerifyTurnstile(...args),
}));
vi.mock("../services/credentialService.js", () => ({
  getCredentialValueWithFallback: vi.fn().mockResolvedValue("site-key"),
}));

import {
  handleRegister,
  handleLogin,
  handleForgotPassword,
  handleTurnstileConfig,
  handleGoogleRedirect,
} from "./authController.js";
import { registerUser, loginUser, generateTokens, requestPasswordReset } from "../services/authService.js";
import { getCredentialValueWithFallback } from "../services/credentialService.js";

// Every test starts with Turnstile passing; failure cases opt in explicitly.
beforeEach(() => {
  mockVerifyTurnstile.mockResolvedValue({ success: true, errorCodes: [] });
});

/** A valid Turnstile token for request bodies. */
const TT = "turnstile-token";
/** Headers that mark a request as browser-originated (Turnstile enforced). */
const WEB = { origin: "http://localhost:5179" };

function mockReq(overrides: Partial<Request> = {}): Request {
  return { body: {}, cookies: {}, query: {}, headers: {}, ...overrides } as unknown as Request;
}

function mockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe("handleRegister", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 with human-readable message for invalid body", async () => {
    const req = mockReq({ body: { name: "", email: "bad", password: "short" } });
    const res = mockRes();
    const next = vi.fn();

    await handleRegister(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    const jsonCall = vi.mocked(res.json).mock.calls[0][0] as { error: string };
    expect(typeof jsonCall.error).toBe("string");
    expect(jsonCall.error).toContain("Password must be at least 8 characters");
  });

  it("returns 201 on successful registration", async () => {
    vi.mocked(registerUser).mockResolvedValue(42);

    const req = mockReq({
      body: { name: "Chef Bob", email: "bob@test.com", password: "Password1", turnstileToken: TT },
    });
    const res = mockRes();
    const next = vi.fn();

    await handleRegister(req, res, next);

    expect(registerUser).toHaveBeenCalledWith("Chef Bob", "bob@test.com", "Password1");
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 42 }),
    );
  });

  it("returns 409 when email already exists", async () => {
    vi.mocked(registerUser).mockRejectedValue(new Error("EMAIL_EXISTS"));

    const req = mockReq({
      body: { name: "Chef Bob", email: "bob@test.com", password: "Password1", turnstileToken: TT },
    });
    const res = mockRes();
    const next = vi.fn();

    await handleRegister(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("returns specific error message for unexpected errors", async () => {
    const err = new Error("DB_DOWN");
    vi.mocked(registerUser).mockRejectedValue(err);

    const req = mockReq({
      body: { name: "Chef Bob", email: "bob@test.com", password: "Password1", turnstileToken: TT },
    });
    const res = mockRes();
    const next = vi.fn();

    await handleRegister(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Registration failed: DB_DOWN",
    });
  });

  it("returns 400 and does not create a user when Turnstile fails (web)", async () => {
    mockVerifyTurnstile.mockResolvedValue({
      success: false,
      errorCodes: ["invalid-input-response"],
    });

    const req = mockReq({
      headers: WEB,
      body: { name: "Chef Bob", email: "bob@test.com", password: "Password1", turnstileToken: "bad" },
    });
    const res = mockRes();
    const next = vi.fn();

    await handleRegister(req, res, next);

    expect(registerUser).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when a web request omits the Turnstile token", async () => {
    const req = mockReq({
      headers: WEB,
      body: { name: "Chef Bob", email: "bob@test.com", password: "Password1" },
    });
    const res = mockRes();

    await handleRegister(req, res, vi.fn());

    expect(registerUser).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockVerifyTurnstile).not.toHaveBeenCalled();
  });

  it("allows a native (mobile) request with no Origin and no token", async () => {
    vi.mocked(registerUser).mockResolvedValue(7);

    // No headers.origin → native client → Turnstile skipped.
    const req = mockReq({
      body: { name: "Mobile Bob", email: "m@test.com", password: "Password1" },
    });
    const res = mockRes();

    await handleRegister(req, res, vi.fn());

    expect(mockVerifyTurnstile).not.toHaveBeenCalled();
    expect(registerUser).toHaveBeenCalledWith("Mobile Bob", "m@test.com", "Password1");
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe("handleLogin", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 for missing credentials", async () => {
    const req = mockReq({ body: { email: "", password: "" } });
    const res = mockRes();
    const next = vi.fn();

    await handleLogin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns user data on successful login", async () => {
    const fakeUser = { userId: 1, userName: "Bob" };
    vi.mocked(loginUser).mockResolvedValue({ requiresMfa: false, user: fakeUser as any });
    vi.mocked(generateTokens).mockResolvedValue({
      accessToken: "at",
      refreshToken: "rt",
    });

    const req = mockReq({
      body: { email: "bob@test.com", password: "Password1", turnstileToken: TT },
    });
    const res = mockRes();
    const next = vi.fn();

    await handleLogin(req, res, next);

    expect(res.cookie).toHaveBeenCalledTimes(2);
    expect(res.json).toHaveBeenCalledWith({
      user: fakeUser,
      // Native mobile clients read tokens from the response body since they
      // don't use the auth cookies. The web client ignores this field.
      tokens: { accessToken: "at", refreshToken: "rt" },
    });
  });

  it("returns 401 for invalid credentials", async () => {
    vi.mocked(loginUser).mockRejectedValue(new Error("INVALID_CREDENTIALS"));

    const req = mockReq({
      body: { email: "bob@test.com", password: "Wrong1234", turnstileToken: TT },
    });
    const res = mockRes();
    const next = vi.fn();

    await handleLogin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns MFA challenge when MFA enabled", async () => {
    vi.mocked(loginUser).mockResolvedValue({
      requiresMfa: true,
      mfaSessionToken: "mfa-token-123",
    });

    const req = mockReq({
      body: { email: "bob@test.com", password: "Password1", turnstileToken: TT },
    });
    const res = mockRes();
    const next = vi.fn();

    await handleLogin(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      requiresMfa: true,
      mfaSessionToken: "mfa-token-123",
    });
  });

  it("returns 400 and does not check credentials when Turnstile fails (web)", async () => {
    mockVerifyTurnstile.mockResolvedValue({
      success: false,
      errorCodes: ["timeout-or-duplicate"],
    });

    const req = mockReq({
      headers: WEB,
      body: { email: "bob@test.com", password: "Password1", turnstileToken: "bad" },
    });
    const res = mockRes();
    const next = vi.fn();

    await handleLogin(req, res, next);

    expect(loginUser).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("allows a native (mobile) login with no Origin and no token", async () => {
    const fakeUser = { userId: 9, userName: "Mob" };
    vi.mocked(loginUser).mockResolvedValue({ requiresMfa: false, user: fakeUser as any });
    vi.mocked(generateTokens).mockResolvedValue({ accessToken: "at", refreshToken: "rt" });

    // No headers.origin → native client → Turnstile skipped.
    const req = mockReq({ body: { email: "m@test.com", password: "Password1" } });
    const res = mockRes();

    await handleLogin(req, res, vi.fn());

    expect(mockVerifyTurnstile).not.toHaveBeenCalled();
    expect(loginUser).toHaveBeenCalledWith("m@test.com", "Password1");
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ user: fakeUser }));
  });
});

describe("handleForgotPassword", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 and sends no reset email when Turnstile fails (web)", async () => {
    mockVerifyTurnstile.mockResolvedValue({ success: false, errorCodes: ["invalid-input-response"] });

    const req = mockReq({ headers: WEB, body: { email: "bob@test.com", turnstileToken: "bad" } });
    const res = mockRes();

    await handleForgotPassword(req, res, vi.fn());

    expect(requestPasswordReset).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("requests a reset when Turnstile passes (web)", async () => {
    const req = mockReq({ headers: WEB, body: { email: "bob@test.com", turnstileToken: TT } });
    const res = mockRes();

    await handleForgotPassword(req, res, vi.fn());

    expect(requestPasswordReset).toHaveBeenCalledWith("bob@test.com");
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it("allows a native (mobile) reset request with no Origin and no token", async () => {
    const req = mockReq({ body: { email: "m@test.com" } });
    const res = mockRes();

    await handleForgotPassword(req, res, vi.fn());

    expect(mockVerifyTurnstile).not.toHaveBeenCalled();
    expect(requestPasswordReset).toHaveBeenCalledWith("m@test.com");
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe("handleTurnstileConfig", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the public site key", async () => {
    vi.mocked(getCredentialValueWithFallback).mockResolvedValue("site-key-123");
    const res = mockRes();

    await handleTurnstileConfig(mockReq(), res, vi.fn());

    expect(res.json).toHaveBeenCalledWith({ siteKey: "site-key-123" });
  });

  it("forwards errors to next", async () => {
    vi.mocked(getCredentialValueWithFallback).mockRejectedValue(new Error("boom"));
    const next = vi.fn();

    await handleTurnstileConfig(mockReq(), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe("OAuth redirect guards", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_ID;
  });

  it("redirects to error when GOOGLE_CLIENT_ID is missing", () => {
    const req = mockReq();
    const res = mockRes();

    handleGoogleRedirect(req, res);

    expect(res.redirect).toHaveBeenCalledWith(
      expect.stringContaining("oauth_not_configured"),
    );
  });

  it("redirects to Google when GOOGLE_CLIENT_ID is set", () => {
    process.env.GOOGLE_CLIENT_ID = "test-google-id";
    const req = mockReq();
    const res = mockRes();

    handleGoogleRedirect(req, res);

    expect(res.redirect).toHaveBeenCalledWith("https://accounts.google.com/oauth");
  });

});
