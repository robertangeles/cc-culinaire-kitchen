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
}));

import {
  handleRegister,
  handleLogin,
  handleGoogleRedirect,
} from "./authController.js";
import { registerUser, loginUser, generateTokens } from "../services/authService.js";

function mockReq(overrides: Partial<Request> = {}): Request {
  return { body: {}, cookies: {}, query: {}, ...overrides } as unknown as Request;
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
      body: { name: "Chef Bob", email: "bob@test.com", password: "Password1" },
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
      body: { name: "Chef Bob", email: "bob@test.com", password: "Password1" },
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
      body: { name: "Chef Bob", email: "bob@test.com", password: "Password1" },
    });
    const res = mockRes();
    const next = vi.fn();

    await handleRegister(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Registration failed: DB_DOWN",
    });
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
      body: { email: "bob@test.com", password: "Password1" },
    });
    const res = mockRes();
    const next = vi.fn();

    await handleLogin(req, res, next);

    expect(res.cookie).toHaveBeenCalledTimes(2);
    expect(res.json).toHaveBeenCalledWith({ user: fakeUser });
  });

  it("returns 401 for invalid credentials", async () => {
    vi.mocked(loginUser).mockRejectedValue(new Error("INVALID_CREDENTIALS"));

    const req = mockReq({
      body: { email: "bob@test.com", password: "Wrong1234" },
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
      body: { email: "bob@test.com", password: "Password1" },
    });
    const res = mockRes();
    const next = vi.fn();

    await handleLogin(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      requiresMfa: true,
      mfaSessionToken: "mfa-token-123",
    });
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
