import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import jwt from "jsonwebtoken";
import type { AddressInfo, Server } from "node:net";
import { generate } from "otplib";

/**
 * A used or malformed authenticator code over HTTP: the real router, limiters, controller, service and otplib, with only the
 * database mocked. It is answered like any wrong code and counts toward the per-account limit. The clock is fixed, and every
 * test is a new user, so each starts with no used code and no failed attempt.
 */
const state = vi.hoisted(() => ({ row: {} as Record<string, unknown> }));

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [state.row] }) }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  },
}));
vi.mock("../services/emailService.js", () => ({}));
vi.mock("../services/settingsService.js", () => ({}));
vi.mock("../services/turnstileService.js", () => ({}));
vi.mock("../services/credentialService.js", () => ({}));
vi.mock("../services/guestService.js", () => ({}));

import authRouter from "./auth.js";
import { createMfaSessionToken } from "../services/authService.js";

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const NOW = Date.UTC(2025, 10, 25, 17, 1, 30) / 1000;
let userId = 0;
let server: Server;

async function post(path: string, body: object) {
  const token = jwt.sign({ sub: userId, roles: [], permissions: [] }, process.env.JWT_ACCESS_SECRET ?? "dev-access-secret");
  const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, code: ((await res.json()) as { code?: string }).code };
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW * 1000 });
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  server = app.listen(0);
});
afterAll(() => {
  server.close();
  vi.useRealTimers();
});
beforeEach(() => {
  state.row = { userId: ++userId, mfaEnabledInd: false, mfaSecret: SECRET };
});

describe("a used authenticator code over HTTP", () => {
  it("is refused as a wrong code, and each refusal counts toward the account's five", async () => {
    const token = await generate({ secret: SECRET, epoch: NOW });
    expect((await post("/mfa/enable", { token })).status).toBe(200);
    for (let i = 0; i < 5; i++) expect(await post("/mfa/enable", { token })).toEqual({ status: 400, code: "INVALID_MFA_CODE" });
    expect(await post("/mfa/enable", { token })).toEqual({ status: 429, code: "RATE_LIMITED" });
  });

  it("is refused at sign-in after it turned two-step on", async () => {
    const code = await generate({ secret: SECRET, epoch: NOW });
    expect((await post("/mfa/enable", { token: code })).status).toBe(200);
    expect(await post("/mfa/verify", { mfaSessionToken: createMfaSessionToken(userId), code })).toEqual({ status: 400, code: "INVALID_MFA_CODE" });
  });
});

describe("a malformed authenticator code over HTTP", () => {
  it.each(["12345", "1234567", "abcdef", "123 456", 123456, ["123456"], { a: 1 }])("%j at sign-in is refused as a wrong code, not a server error", async (code) => {
    expect(await post("/mfa/verify", { mfaSessionToken: createMfaSessionToken(userId), code })).toEqual({ status: 400, code: "INVALID_MFA_CODE" });
  });

  it.each(["12345", "abcdef"])("%j when turning two-step on is refused as a wrong code", async (token) => {
    expect(await post("/mfa/enable", { token })).toEqual({ status: 400, code: "INVALID_MFA_CODE" });
  });

  it("counts toward the account's five", async () => {
    for (let i = 0; i < 5; i++) expect((await post("/mfa/enable", { token: "12345" })).status).toBe(400);
    expect((await post("/mfa/enable", { token: "12345" })).status).toBe(429);
  });
});
