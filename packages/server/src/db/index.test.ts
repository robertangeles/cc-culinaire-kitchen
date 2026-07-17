import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assertSafeDbHost } from "./index.js";

/**
 * Guards the dev→DB connection rules. This is a security rail (a dev process
 * must never touch prod), so every branch gets an explicit case.
 */
const ENV_KEYS = ["NODE_ENV", "APP_ENV", "PROD_DATABASE_URL", "ALLOW_REMOTE_DEV_DB"] as const;

const LOCAL = "postgresql://u:p@localhost:5432/dev";
const NEON = "postgresql://u:p@ep-cool-dev.ap-southeast-1.aws.neon.tech/dev?sslmode=require";
const PROD = "postgresql://u:p@ep-prod-xyz.ap-southeast-1.aws.neon.tech/prod?sslmode=require";

describe("assertSafeDbHost", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("allows a local host in dev", () => {
    expect(() => assertSafeDbHost(LOCAL)).not.toThrow();
  });

  it("rejects a remote host in dev without the opt-in", () => {
    expect(() => assertSafeDbHost(NEON)).toThrow(/remote database/i);
  });

  it("allows a remote dev DB with ALLOW_REMOTE_DEV_DB=1", () => {
    process.env.ALLOW_REMOTE_DEV_DB = "1";
    expect(() => assertSafeDbHost(NEON)).not.toThrow();
  });

  it("NEVER allows the prod host in dev — even with the remote opt-in set", () => {
    process.env.PROD_DATABASE_URL = PROD;
    process.env.ALLOW_REMOTE_DEV_DB = "1";
    expect(() => assertSafeDbHost(PROD)).toThrow(/PROD database host/i);
  });

  it("allows any host when APP_ENV=prod", () => {
    process.env.APP_ENV = "prod";
    process.env.PROD_DATABASE_URL = PROD;
    expect(() => assertSafeDbHost(PROD)).not.toThrow();
  });

  it("allows any host when NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    expect(() => assertSafeDbHost(NEON)).not.toThrow();
  });

  it("ignores an unparseable URL (lets the driver surface the real error)", () => {
    expect(() => assertSafeDbHost("not-a-url")).not.toThrow();
  });
});
