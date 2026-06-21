import { describe, it, expect, beforeEach, afterAll } from "vitest";
import jwt from "jsonwebtoken";
import { verifyAccessToken } from "./authService.js";

/**
 * Regression for lessons.md #53: JWT secrets must be read at CALL time, not
 * captured at module load. If `authService` ever reverts to a module-level
 * `const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET`, this test fails —
 * because the secret would be frozen at import and changing `process.env`
 * mid-run would have no effect.
 */

const ORIGINAL = process.env.JWT_ACCESS_SECRET;
const payload = { sub: 1, roles: [], permissions: [] };

beforeEach(() => {
  delete process.env.JWT_ACCESS_SECRET;
});
afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.JWT_ACCESS_SECRET;
  else process.env.JWT_ACCESS_SECRET = ORIGINAL;
});

describe("verifyAccessToken reads the secret at call time", () => {
  it("verifies a token signed with the secret set just before the call", () => {
    process.env.JWT_ACCESS_SECRET = "secret-A";
    const token = jwt.sign(payload, "secret-A");
    expect(() => verifyAccessToken(token)).not.toThrow();
  });

  it("picks up a secret CHANGED after import (proves no module-load capture)", () => {
    process.env.JWT_ACCESS_SECRET = "secret-A";
    const tokenA = jwt.sign(payload, "secret-A");
    expect(() => verifyAccessToken(tokenA)).not.toThrow();

    // Rotate the secret. A module-load capture would still verify tokenA.
    process.env.JWT_ACCESS_SECRET = "secret-B";
    expect(() => verifyAccessToken(tokenA)).toThrow(); // signed with the old secret
    const tokenB = jwt.sign(payload, "secret-B");
    expect(() => verifyAccessToken(tokenB)).not.toThrow();
  });

  it("falls back to 'dev-access-secret' only when the env var is unset", () => {
    // env var deleted in beforeEach
    const token = jwt.sign(payload, "dev-access-secret");
    expect(() => verifyAccessToken(token)).not.toThrow();
  });
});
