import { describe, it, expect, vi } from "vitest";
import type { Router } from "express";

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

describe.each(["/mfa/setup", "/mfa/enable", "/mfa/disable"])("POST %s", (path) => {
  it("checks the token first, then rate limits, before the handler runs", () => {
    const handlers = handlersFor(path);
    expect(handlers).toHaveLength(3);
    expect(handlers[0]).toBe(authenticate);
    expect(handlers[1]).toBe(authRateLimit);
  });
});
