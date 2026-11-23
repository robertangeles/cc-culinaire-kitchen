import { describe, it, expect } from "vitest";
import { assertDemoCredentials, assertDemoSeedAllowed, DEMO_AREAS } from "./seedReviewerDemo.js";

describe("assertDemoSeedAllowed", () => {
  it("refuses a missing DATABASE_URL", () => {
    expect(() => assertDemoSeedAllowed(undefined, undefined)).toThrow(/DATABASE_URL/);
  });

  it.each(["localhost", "127.0.0.1"])("allows %s with no confirmation", (host) => {
    expect(assertDemoSeedAllowed(`postgresql://ci:ci@${host}:5432/x`, undefined)).toBe(host);
  });

  it("refuses a remote host unless its own name is given, so production is never seeded by accident", () => {
    const url = "postgresql://u:p@dpg-abc.oregon-postgres.render.com/db";
    expect(() => assertDemoSeedAllowed(url, undefined)).toThrow(/--confirm-host dpg-abc\.oregon-postgres\.render\.com/);
    expect(() => assertDemoSeedAllowed(url, "some-other-host")).toThrow(/not local/);
    expect(assertDemoSeedAllowed(url, "dpg-abc.oregon-postgres.render.com")).toBe("dpg-abc.oregon-postgres.render.com");
  });
});

describe("assertDemoCredentials", () => {
  it("needs an email address and a password of at least 12 characters", () => {
    expect(() => assertDemoCredentials(undefined, "a-long-enough-password")).toThrow(/EMAIL/);
    expect(() => assertDemoCredentials("not-an-email", "a-long-enough-password")).toThrow(/EMAIL/);
    expect(() => assertDemoCredentials("r@x.test", "short")).toThrow(/12 characters/);
    expect(() => assertDemoCredentials("r@x.test", undefined)).toThrow(/12 characters/);
    expect(() => assertDemoCredentials("r@x.test", "a-long-enough-password")).not.toThrow();
  });
});

describe("the demo kitchen", () => {
  it("has areas of real items, one item in two areas (the phone marks those), and valid categories", () => {
    const names = DEMO_AREAS.flatMap((a) => a.items.map((i) => i[0]));
    expect(DEMO_AREAS).toHaveLength(3);
    expect(new Set(names).size).toBeLessThan(names.length);
    const valid = ["proteins", "produce", "dairy", "dry_goods", "beverages", "spirits", "frozen", "bakery", "condiments", "other"];
    for (const a of DEMO_AREAS) for (const [, category] of a.items) expect(valid).toContain(category);
  });
});
