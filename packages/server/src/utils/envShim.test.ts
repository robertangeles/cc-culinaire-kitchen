import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isProductionProcess } from "./envShim.js";

/**
 * `isProductionProcess()` gates scheduled background jobs (index.ts) AND the
 * prod-database hard rail (assertSafeDbHost). Getting it wrong in one direction
 * silently stops every production job; in the other it lets a dev process race
 * the test suite. Both directions are asserted here.
 */

const saved = { NODE_ENV: process.env.NODE_ENV, APP_ENV: process.env.APP_ENV };

beforeEach(() => {
  delete process.env.NODE_ENV;
  delete process.env.APP_ENV;
});

afterEach(() => {
  if (saved.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = saved.NODE_ENV;
  if (saved.APP_ENV === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = saved.APP_ENV;
});

describe("isProductionProcess", () => {
  it("is true when NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    expect(isProductionProcess()).toBe(true);
  });

  it("is true when APP_ENV=prod, case-insensitively", () => {
    for (const v of ["prod", "PROD", "Prod"]) {
      process.env.APP_ENV = v;
      expect(isProductionProcess(), `APP_ENV=${v}`).toBe(true);
    }
  });

  // The reason production can be gated safely: assertSafeDbHost refuses to let a
  // non-production process reach the prod database host, so a prod deploy that
  // satisfied NEITHER variable could not connect at all. Either signal alone is
  // therefore sufficient, and both must keep working.
  it("is true when either signal is set independently", () => {
    process.env.NODE_ENV = "production";
    expect(isProductionProcess()).toBe(true);
    delete process.env.NODE_ENV;
    process.env.APP_ENV = "prod";
    expect(isProductionProcess()).toBe(true);
  });

  it("is false for a plain dev process — the case that must NOT run timed jobs", () => {
    expect(isProductionProcess()).toBe(false);
  });

  it("is false for near-miss values that must not be mistaken for production", () => {
    for (const [k, v] of [
      ["NODE_ENV", "development"],
      ["NODE_ENV", "test"],
      ["NODE_ENV", "prod"], // NODE_ENV=prod is NOT production
      ["APP_ENV", "dev"],
      ["APP_ENV", "production"], // APP_ENV=production is NOT the prod token
      ["APP_ENV", ""],
    ] as const) {
      delete process.env.NODE_ENV;
      delete process.env.APP_ENV;
      process.env[k] = v;
      expect(isProductionProcess(), `${k}=${v}`).toBe(false);
    }
  });
});
