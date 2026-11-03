import { describe, it, expect, vi } from "vitest";
import express, { type Router } from "express";
import type { AddressInfo } from "node:net";

vi.mock("../services/authService.js", () => ({ AuthError: class extends Error {} }));
vi.mock("../services/turnstileService.js", () => ({}));
vi.mock("../services/credentialService.js", () => ({}));
vi.mock("../services/guestService.js", () => ({}));

import authRouter from "./auth.js";
import { authenticate } from "../middleware/auth.js";
import { authRateLimit } from "../middleware/rateLimiter.js";

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

// /mfa/verify takes no session (the MFA session token is the credential), so the rate limit is its
// only brake on someone guessing the 6-digit login code during the token's 5 minutes.
describe("POST /mfa/verify", () => {
  it("rate limits before the handler runs", () => {
    const handlers = handlersFor("/mfa/verify");
    expect(handlers).toHaveLength(2);
    expect(handlers[0]).toBe(authRateLimit);
  });
});

// The wiring test above only proves the limiter is in the stack. This one sends real requests
// through the real router and real limiter, so a broken limit or key shows up as no 429.
describe("POST /mfa/verify over HTTP", () => {
  it("answers 429 on the 21st attempt from one address inside a minute", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/auth", authRouter);
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const statuses: number[] = [];
      for (let i = 0; i < 21; i++) {
        const res = await fetch(`http://127.0.0.1:${port}/api/auth/mfa/verify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 20)).not.toContain(429);
      expect(statuses[20]).toBe(429);
    } finally {
      server.close();
    }
  });
});

describe.each(["/mfa/setup", "/mfa/enable", "/mfa/disable"])("POST %s", (path) => {
  it("checks the token first, then rate limits, before the handler runs", () => {
    const handlers = handlersFor(path);
    expect(handlers).toHaveLength(3);
    expect(handlers[0]).toBe(authenticate);
    expect(handlers[1]).toBe(authRateLimit);
  });
});
