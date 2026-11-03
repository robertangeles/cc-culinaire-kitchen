import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";

// Mock the auth service before importing the controller
vi.mock("../services/authService.js", () => {
  class AuthError extends Error {
    constructor(message: string, public readonly code: string, public readonly statusCode: number) {
      super(message);
      this.name = "AuthError";
    }
  }
  return {
  AuthError,
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
  getSignInTime: vi.fn(),
  completeMfaLogin: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  verifyGoogleIdToken: vi.fn(),
  findOrCreateOAuthUser: vi.fn(),
  };
});

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
  handleRefresh,
  handleVerifyEmail,
  handleResendVerification,
  handleResetPassword,
  handleGoogleIdToken,
  handleMfaSetup,
  handleMfaEnable,
  handleMfaDisable,
  handleMfaVerify,
} from "./authController.js";
import {
  registerUser,
  loginUser,
  generateTokens,
  requestPasswordReset,
  refreshAccessToken,
  verifyEmail,
  resendVerification,
  resetPassword,
  enableMfa,
  generateMfaSecret,
  disableMfa,
  getSignInTime,
  completeMfaLogin,
  verifyGoogleIdToken,
  findOrCreateOAuthUser,
  AuthError,
} from "../services/authService.js";
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
    vi.mocked(registerUser).mockRejectedValue(new AuthError("EMAIL_EXISTS", "EMAIL_EXISTS", 409));

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
    vi.mocked(loginUser).mockRejectedValue(new AuthError("INVALID_CREDENTIALS", "INVALID_CREDENTIALS", 401));

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

describe("handleRefresh", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when no refresh token is provided", async () => {
    const req = mockReq({ cookies: {}, body: {} });
    const res = mockRes();
    await handleRefresh(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 401 for INVALID_REFRESH_TOKEN", async () => {
    vi.mocked(refreshAccessToken).mockRejectedValue(
      new AuthError("INVALID_REFRESH_TOKEN", "INVALID_REFRESH_TOKEN", 401),
    );
    const req = mockReq({ cookies: { refresh_token: "bad-token" } });
    const res = mockRes();
    await handleRefresh(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("expired") }));
  });

  it("returns 401 for REFRESH_TOKEN_EXPIRED", async () => {
    vi.mocked(refreshAccessToken).mockRejectedValue(
      new AuthError("REFRESH_TOKEN_EXPIRED", "REFRESH_TOKEN_EXPIRED", 401),
    );
    const req = mockReq({ cookies: { refresh_token: "old-token" } });
    const res = mockRes();
    await handleRefresh(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("forwards unexpected errors to next", async () => {
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error("DB down"));
    const req = mockReq({ cookies: { refresh_token: "tok" } });
    const res = mockRes();
    const next = vi.fn();
    await handleRefresh(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe("handleVerifyEmail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 with no token", async () => {
    const req = mockReq({ query: {} });
    const res = mockRes();
    await handleVerifyEmail(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 for INVALID_TOKEN", async () => {
    vi.mocked(verifyEmail).mockRejectedValue(new AuthError("INVALID_TOKEN", "INVALID_TOKEN", 400));
    const req = mockReq({ query: { token: "bad" } });
    const res = mockRes();
    await handleVerifyEmail(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "Invalid verification token." }));
  });

  it("returns 400 for TOKEN_ALREADY_USED", async () => {
    vi.mocked(verifyEmail).mockRejectedValue(new AuthError("TOKEN_ALREADY_USED", "TOKEN_ALREADY_USED", 400));
    const req = mockReq({ query: { token: "used" } });
    const res = mockRes();
    await handleVerifyEmail(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("already been used") }));
  });

  it("returns 400 for TOKEN_EXPIRED", async () => {
    vi.mocked(verifyEmail).mockRejectedValue(new AuthError("TOKEN_EXPIRED", "TOKEN_EXPIRED", 400));
    const req = mockReq({ query: { token: "expired" } });
    const res = mockRes();
    await handleVerifyEmail(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("expired") }));
  });

  it("returns success on valid token", async () => {
    vi.mocked(verifyEmail).mockResolvedValue(undefined);
    const req = mockReq({ query: { token: "valid-token" } });
    const res = mockRes();
    await handleVerifyEmail(req, res, vi.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("verified") }));
  });
});

describe("handleResendVerification", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 with no email", async () => {
    const req = mockReq({ body: {} });
    const res = mockRes();
    await handleResendVerification(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 for ALREADY_VERIFIED", async () => {
    vi.mocked(resendVerification).mockRejectedValue(new AuthError("ALREADY_VERIFIED", "ALREADY_VERIFIED", 400));
    const req = mockReq({ body: { email: "bob@test.com" } });
    const res = mockRes();
    await handleResendVerification(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "This email is already verified." }));
  });

  it("returns success message", async () => {
    vi.mocked(resendVerification).mockResolvedValue(undefined);
    const req = mockReq({ body: { email: "bob@test.com" } });
    const res = mockRes();
    await handleResendVerification(req, res, vi.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("verification link") }));
  });
});

describe("handleResetPassword", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 for invalid body", async () => {
    const req = mockReq({ body: { token: "", newPassword: "short" } });
    const res = mockRes();
    await handleResetPassword(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 for INVALID_RESET_TOKEN", async () => {
    vi.mocked(resetPassword).mockRejectedValue(new AuthError("INVALID_RESET_TOKEN", "INVALID_RESET_TOKEN", 400));
    const req = mockReq({ body: { token: "bad-tok", newPassword: "NewPass1234" } });
    const res = mockRes();
    await handleResetPassword(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "Invalid or expired reset token" }));
  });

  it("returns success on valid reset", async () => {
    vi.mocked(resetPassword).mockResolvedValue(undefined);
    const req = mockReq({ body: { token: "valid-tok", newPassword: "NewPass1234" } });
    const res = mockRes();
    await handleResetPassword(req, res, vi.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe("handleGoogleIdToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 for missing idToken", async () => {
    const req = mockReq({ body: {} });
    const res = mockRes();
    await handleGoogleIdToken(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 500 for OAUTH_NOT_CONFIGURED", async () => {
    vi.mocked(verifyGoogleIdToken).mockRejectedValue(
      new AuthError("OAUTH_NOT_CONFIGURED", "OAUTH_NOT_CONFIGURED", 503),
    );
    const req = mockReq({ body: { idToken: "tok" } });
    const res = mockRes();
    await handleGoogleIdToken(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("returns 401 for INVALID_ID_TOKEN", async () => {
    vi.mocked(verifyGoogleIdToken).mockRejectedValue(
      new AuthError("INVALID_ID_TOKEN", "INVALID_ID_TOKEN", 401),
    );
    const req = mockReq({ body: { idToken: "bad" } });
    const res = mockRes();
    await handleGoogleIdToken(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "Invalid Google ID token." }));
  });

  it("returns 401 for EMAIL_NOT_VERIFIED_BY_GOOGLE", async () => {
    vi.mocked(verifyGoogleIdToken).mockRejectedValue(
      new AuthError("EMAIL_NOT_VERIFIED_BY_GOOGLE", "EMAIL_NOT_VERIFIED_BY_GOOGLE", 403),
    );
    const req = mockReq({ body: { idToken: "unverified" } });
    const res = mockRes();
    await handleGoogleIdToken(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns user and tokens on success", async () => {
    const fakeUser = { userId: 5, userName: "Google User" };
    vi.mocked(verifyGoogleIdToken).mockResolvedValue({ email: "g@test.com", name: "Google User", sub: "gsub" } as any);
    vi.mocked(findOrCreateOAuthUser).mockResolvedValue(fakeUser as any);
    vi.mocked(generateTokens).mockResolvedValue({ accessToken: "at", refreshToken: "rt" });
    const req = mockReq({ body: { idToken: "valid-tok" } });
    const res = mockRes();
    await handleGoogleIdToken(req, res, vi.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ user: fakeUser }));
  });
});

describe("handleMfaEnable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    const req = mockReq({ body: { token: "123456" } });
    const res = mockRes();
    await handleMfaEnable(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 400 when token is missing", async () => {
    const req = { ...mockReq({ body: {} }), user: { sub: 1 } } as any;
    const res = mockRes();
    await handleMfaEnable(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 400 for INVALID_MFA_CODE", async () => {
    vi.mocked(enableMfa).mockRejectedValue(new AuthError("INVALID_MFA_CODE", "INVALID_MFA_CODE", 401));
    const req = { ...mockReq({ body: { token: "000000" } }), user: { sub: 1 } } as any;
    const res = mockRes();
    await handleMfaEnable(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "Invalid code. Please try again." }));
  });

  it("returns success on valid TOTP code", async () => {
    vi.mocked(enableMfa).mockResolvedValue(undefined);
    const req = { ...mockReq({ body: { token: "123456" } }), user: { sub: 1 } } as any;
    const res = mockRes();
    await handleMfaEnable(req, res, vi.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("enabled") }));
  });
});

describe.each([
  ["handleMfaSetup", handleMfaSetup, generateMfaSecret],
  ["handleMfaDisable", handleMfaDisable, disableMfa],
] as const)("%s", (_name, handler, service) => {
  beforeEach(() => vi.clearAllMocks());
  const authed = (body: unknown = {}) =>
    ({ ...mockReq({ body, cookies: { refresh_token: "rt-cookie" } as any }), user: { sub: 7 } }) as any;

  it("returns 401 when not authenticated", async () => {
    const res = mockRes();
    await handler(mockReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(service).not.toHaveBeenCalled();
  });

  it("hands the service the proof from the body and the time of the current sign-in", async () => {
    const signedInAt = new Date("2026-10-26T10:00:00Z");
    vi.mocked(getSignInTime).mockResolvedValue(signedInAt);
    vi.mocked(service as any).mockResolvedValue({ secret: "s", qrCodeDataUrl: "q" });
    await handler(authed({ password: "pw", mfaCode: "123456", extra: "ignored" }), mockRes(), vi.fn());
    expect(getSignInTime).toHaveBeenCalledWith("rt-cookie", 7);
    expect(service).toHaveBeenCalledWith(7, { password: "pw", mfaCode: "123456" }, signedInAt);
  });

  it("ignores a password or code that is not a string", async () => {
    vi.mocked(getSignInTime).mockResolvedValue(null);
    vi.mocked(service as any).mockResolvedValue({ secret: "s", qrCodeDataUrl: "q" });
    await handler(authed({ password: { $ne: "" }, mfaCode: 123456 }), mockRes(), vi.fn());
    expect(service).toHaveBeenCalledWith(7, { password: undefined, mfaCode: undefined }, null);
  });

  it.each([
    ["INVALID_CREDENTIALS", 403],
    ["RECENT_SIGN_IN_REQUIRED", 403],
    ["MFA_REQUIRED", 403],
    ["INVALID_MFA_CODE", 403],
    ["MFA_ALREADY_ENABLED", 409],
  ])("answers %s with its status and code, so the client can say what to do", async (code, status) => {
    vi.mocked(service as any).mockRejectedValue(new AuthError("Say what to do.", code, status));
    const res = mockRes();
    const next = vi.fn();
    await handler(authed(), res, next);
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith({ error: "Say what to do.", code });
    expect(next).not.toHaveBeenCalled();
  });

  it("answers 401 when the account no longer exists, not a raw 404", async () => {
    vi.mocked(service as any).mockRejectedValue(new AuthError("USER_NOT_FOUND", "USER_NOT_FOUND", 404));
    const res = mockRes();
    const next = vi.fn();
    await handler(authed(), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Not authenticated." });
    expect(next).not.toHaveBeenCalled();
  });

  it("passes an unexpected failure on to the error handler", async () => {
    const boom = new Error("db down");
    vi.mocked(service as any).mockRejectedValue(boom);
    const next = vi.fn();
    await handler(authed(), mockRes(), next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe("handleMfaVerify", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 when mfaSessionToken or code is missing", async () => {
    const req = mockReq({ body: { mfaSessionToken: "tok" } });
    const res = mockRes();
    await handleMfaVerify(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 401 for INVALID_MFA_SESSION", async () => {
    vi.mocked(completeMfaLogin).mockRejectedValue(
      new AuthError("INVALID_MFA_SESSION", "INVALID_MFA_SESSION", 401),
    );
    const req = mockReq({ body: { mfaSessionToken: "expired-sess", code: "123456" } });
    const res = mockRes();
    await handleMfaVerify(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining("expired") }));
  });

  it("returns 400 for INVALID_MFA_CODE", async () => {
    vi.mocked(completeMfaLogin).mockRejectedValue(
      new AuthError("INVALID_MFA_CODE", "INVALID_MFA_CODE", 401),
    );
    const req = mockReq({ body: { mfaSessionToken: "sess", code: "000000" } });
    const res = mockRes();
    await handleMfaVerify(req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "Invalid code. Please try again." }));
  });

  it("returns user and tokens on success", async () => {
    const fakeUser = { userId: 3, userName: "MFA User" };
    vi.mocked(completeMfaLogin).mockResolvedValue(fakeUser as any);
    vi.mocked(generateTokens).mockResolvedValue({ accessToken: "at", refreshToken: "rt" });
    const req = mockReq({ body: { mfaSessionToken: "valid-sess", code: "123456" } });
    const res = mockRes();
    await handleMfaVerify(req, res, vi.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ user: fakeUser }));
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

  // originalEnv was captured for this restore, which was never written: the
  // suite deletes and sets OAuth env vars and left process.env mutated for
  // whatever ran next. Put it back.
  afterEach(() => {
    process.env = { ...originalEnv };
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
