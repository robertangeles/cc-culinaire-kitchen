import { describe, expect, it } from "vitest";
import { assertLocalTarget, e2ePrefix } from "./safety";

describe("assertLocalTarget", () => {
  it.each(["http://localhost:5179", "http://127.0.0.1:5179/x"])("allows %s", (url) => {
    expect(() => assertLocalTarget(url)).not.toThrow();
  });

  it.each([
    "https://app.culinaire.kitchen",
    "https://culinaire-kitchen.onrender.com",
    "http://localhost.evil.com",
  ])("refuses %s", (url) => {
    expect(() => assertLocalTarget(url)).toThrow(/Refusing to run E2E/);
  });

  it("refuses a malformed URL", () => {
    expect(() => assertLocalTarget("not a url")).toThrow(/not a valid URL/);
  });
});

describe("e2ePrefix", () => {
  it("scopes rows to the run", () => {
    expect(e2ePrefix("abc123")).toBe("e2e-abc123-");
  });
});
