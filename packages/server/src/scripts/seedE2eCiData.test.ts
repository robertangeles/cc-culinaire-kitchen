import { describe, it, expect } from "vitest";
import { assertSeedAllowed } from "./seedE2eCiData.js";

describe("assertSeedAllowed", () => {
  it("refuses a production process", () => {
    expect(() => assertSeedAllowed(true, "postgresql://ci:ci@localhost:5432/x")).toThrow(/production/i);
  });

  it("refuses a missing DATABASE_URL", () => {
    expect(() => assertSeedAllowed(false, undefined)).toThrow(/DATABASE_URL/);
  });

  it("refuses a remote database host", () => {
    expect(() => assertSeedAllowed(false, "postgresql://u:p@dpg-abc.oregon-postgres.render.com/db")).toThrow(/non-local/);
  });

  it.each(["localhost", "127.0.0.1"])("allows %s", (host) => {
    expect(() => assertSeedAllowed(false, `postgresql://ci:ci@${host}:5432/culinaire_it`)).not.toThrow();
  });
});
