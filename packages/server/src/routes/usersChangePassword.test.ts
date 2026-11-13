import { describe, it, expect } from "vitest";
import type { Router } from "express";

import usersRouter from "./users.js";
import { authRateLimit } from "../middleware/rateLimiter.js";

/**
 * Changing the password takes the current password, and that can be guessed by anyone holding a
 * session, so the route must keep its rate limit. Reads the middleware actually wired onto the
 * router, as authMfaRoutes.test.ts does.
 */
describe("POST /change-password", () => {
  it("rate limits before the handler runs", () => {
    const layer = (usersRouter as Router).stack.find(
      (l: any) => l.route?.path === "/change-password" && l.route.methods.post
    );
    const handlers = (layer as any).route.stack.map((l: any) => l.handle);
    expect(handlers).toHaveLength(2);
    expect(handlers[0]).toBe(authRateLimit);
  });
});
