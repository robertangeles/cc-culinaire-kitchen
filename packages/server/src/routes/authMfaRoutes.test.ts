import { describe, it, expect, vi } from "vitest";
import express, { type Router } from "express";
import type { AddressInfo } from "node:net";

// "tok-<id>" stands in for a verified MFA session token for that user.
vi.mock("../services/authService.js", () => ({
  AuthError: class extends Error {},
  mfaSessionUserId: (t: unknown) => (typeof t === "string" && t.startsWith("tok-") ? Number(t.slice(4)) : null),
}));
vi.mock("../services/turnstileService.js", () => ({}));
vi.mock("../services/credentialService.js", () => ({}));
vi.mock("../services/guestService.js", () => ({}));

import authRouter from "./auth.js";
import { authenticate } from "../middleware/auth.js";
import { mfaVerifyRateLimit, mfaAccountRateLimit } from "../middleware/rateLimiter.js";

/**
 * Changing MFA needs proof, and the proof can be guessed, so these three routes must keep their
 * token check and their rate limit, in that order. The controller tests mock the services and the
 * integration tests skip the HTTP layer, so a dropped or reordered middleware fails only here.
 * Reads the middleware actually wired onto the router, as navPermissions.test.ts does.
 */
function handlersFor(path: string): unknown[] {
  const layer = (authRouter as Router).stack.find((l: any) => l.route?.path === path && l.route.methods.post);
  if (!layer) throw new Error(`no POST ${path} on the auth router`);
  return (layer as any).route.stack.map((l: any) => l.handle);
}

// /mfa/verify takes no session (the MFA session token is the credential), so the rate limits are
// its only brake on someone guessing the 6-digit login code during the token's 5 minutes.
describe("POST /mfa/verify", () => {
  it("rate limits per address, then per account, before the handler runs", () => {
    const handlers = handlersFor("/mfa/verify");
    expect(handlers).toHaveLength(3);
    expect(handlers[0]).toBe(mfaVerifyRateLimit);
    expect(handlers[1]).toBe(mfaAccountRateLimit);
  });
});

// The wiring test above only proves the limiter is in the stack. This one sends real requests
// through the real router and real limiter, so a broken limit or key shows up as no 429.
// Each test loads a fresh router so it gets fresh limiter counters.
async function postVerify(attempts: number, body: object): Promise<number[]> {
  vi.resetModules();
  const { default: freshRouter } = await import("./auth.js");
  const app = express();
  app.use(express.json());
  app.use("/api/auth", freshRouter);
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const statuses: number[] = [];
    for (let i = 0; i < attempts; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/mfa/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      statuses.push(res.status);
    }
    return statuses;
  } finally {
    server.close();
  }
}

describe("POST /mfa/verify over HTTP", () => {
  it("answers 429 on the 21st failed attempt from one address inside a minute", async () => {
    const statuses = await postVerify(21, {});
    expect(statuses.slice(0, 20)).not.toContain(429);
    expect(statuses[20]).toBe(429);
  });

  it("answers 429 on the 6th failed attempt against one account, well under the address limit", async () => {
    // Incomplete body -> 400, which counts as a failure. "tok-7" is a verified token for user 7.
    const statuses = await postVerify(6, { mfaSessionToken: "tok-7" });
    expect(statuses.slice(0, 5)).not.toContain(429);
    expect(statuses[5]).toBe(429);
  });

  it("does not let a forged token spend a real account's attempts", async () => {
    // Forged tokens name no account, so they hit only the per-address limit: 6 are not blocked.
    const statuses = await postVerify(6, { mfaSessionToken: "forged-for-7" });
    expect(statuses).not.toContain(429);
  });
});

describe.each(["/mfa/setup", "/mfa/enable", "/mfa/disable"])("POST %s", (path) => {
  it("checks the token first, then rate limits, before the handler runs", () => {
    const handlers = handlersFor(path);
    expect(handlers).toHaveLength(3);
    expect(handlers[0]).toBe(authenticate);
    expect(handlers[1]).toBe(mfaAccountRateLimit);
  });
});
