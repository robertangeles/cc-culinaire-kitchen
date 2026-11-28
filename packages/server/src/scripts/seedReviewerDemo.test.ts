import { describe, it, expect } from "vitest";
import { assertDemoSeedAllowed, DEMO_AREAS, DEMO_BENCH_MESSAGES, DEMO_FIRST_BENCH_MESSAGES, demoAccountsFrom } from "./seedReviewerDemo.js";

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

describe("demoAccountsFrom", () => {
  const env = {
    REVIEWER_DEMO_EMAIL: "r@x.test",
    REVIEWER_DEMO_PASSWORD: "a-long-enough-password",
    REVIEWER_DEMO_EMAIL_2: "r2@x.test",
    REVIEWER_DEMO_PASSWORD_2: "another-long-password",
  };

  it("reads both accounts", () => {
    expect(demoAccountsFrom(env)).toEqual([
      { email: "r@x.test", password: "a-long-enough-password" },
      { email: "r2@x.test", password: "another-long-password" },
    ]);
  });

  it.each(["", "_2"])("needs an email address and a password of at least 12 characters for account %#", (n) => {
    expect(() => demoAccountsFrom({ ...env, [`REVIEWER_DEMO_EMAIL${n}`]: undefined })).toThrow(`REVIEWER_DEMO_EMAIL${n} must`);
    expect(() => demoAccountsFrom({ ...env, [`REVIEWER_DEMO_EMAIL${n}`]: "not-an-email" })).toThrow(`REVIEWER_DEMO_EMAIL${n} must`);
    expect(() => demoAccountsFrom({ ...env, [`REVIEWER_DEMO_PASSWORD${n}`]: "short" })).toThrow(`REVIEWER_DEMO_PASSWORD${n} must be at least 12 characters`);
    expect(() => demoAccountsFrom({ ...env, [`REVIEWER_DEMO_PASSWORD${n}`]: undefined })).toThrow(`REVIEWER_DEMO_PASSWORD${n} must be at least 12 characters`);
  });

  it("refuses the same address twice", () => {
    expect(() => demoAccountsFrom({ ...env, REVIEWER_DEMO_EMAIL_2: "R@x.test" })).toThrow(/must differ/);
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

describe("the demo Bench messages", () => {
  it("are a few short, distinct posts (a rerun tells them apart by their text)", () => {
    const all = [...DEMO_FIRST_BENCH_MESSAGES, ...DEMO_BENCH_MESSAGES];
    expect(DEMO_FIRST_BENCH_MESSAGES.length).toBeGreaterThanOrEqual(1);
    expect(DEMO_BENCH_MESSAGES.length).toBeGreaterThanOrEqual(2);
    expect(new Set(all).size).toBe(all.length);
    for (const m of all) expect(m.length).toBeLessThan(120);
  });
});
