import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRateLimit = vi.fn(() => ({ __mock: "limiter" }));
vi.mock("express-rate-limit", () => ({ rateLimit: mockRateLimit }));

const mockVerify = vi.fn();
vi.mock("../services/authService.js", () => ({ verifyAccessToken: mockVerify }));
vi.mock("./auth.js", () => ({
  extractAccessToken: (req: { cookies?: { access_token?: string } }) => req.cookies?.access_token ?? null,
}));

type Config = {
  windowMs: number;
  limit: (req: unknown) => number;
  keyGenerator: (req: unknown) => string;
  skip: (req: { path: string }) => boolean;
};

async function load(): Promise<Config> {
  vi.resetModules();
  mockRateLimit.mockClear();
  await import("./globalRateLimit.js");
  expect(mockRateLimit).toHaveBeenCalledTimes(1);
  return mockRateLimit.mock.calls[0][0] as unknown as Config;
}

const signedIn = { cookies: { access_token: "good" }, ip: "1.2.3.4" };

describe("globalApiRateLimit", () => {
  beforeEach(() => {
    mockVerify.mockReset();
    mockVerify.mockImplementation((t: string) => {
      if (t !== "good") throw new Error("bad token");
      return { sub: 42 };
    });
    delete process.env.RATE_LIMIT_PER_MINUTE;
  });

  it("buckets a signed-in user by user id, not IP, so a shared IP does not share a budget", async () => {
    const cfg = await load();
    expect(cfg.keyGenerator(signedIn)).toBe("user-42");
    expect(cfg.keyGenerator({ ...signedIn, ip: "9.9.9.9" })).toBe("user-42");
  });

  it("gives a signed-in user 300/min by default", async () => {
    const cfg = await load();
    expect(cfg.limit(signedIn)).toBe(300);
  });

  it("reads the signed-in limit from RATE_LIMIT_PER_MINUTE", async () => {
    process.env.RATE_LIMIT_PER_MINUTE = "500";
    const cfg = await load();
    expect(cfg.limit(signedIn)).toBe(500);
  });

  it("falls back to the default when RATE_LIMIT_PER_MINUTE is not a positive integer", async () => {
    for (const bad of ["abc", "0", "-5", ""]) {
      process.env.RATE_LIMIT_PER_MINUTE = bad;
      const cfg = await load();
      expect(cfg.limit(signedIn)).toBe(300);
    }
  });

  it("keeps anonymous traffic on the IP at 60/min", async () => {
    const cfg = await load();
    const anon = { cookies: {}, ip: "1.2.3.4" };
    expect(cfg.keyGenerator(anon)).toBe("1.2.3.4");
    expect(cfg.limit(anon)).toBe(60);
    expect(cfg.keyGenerator({ cookies: {} })).toBe("unknown");
  });

  it("treats a forged or expired token as anonymous, so it cannot mint fresh buckets", async () => {
    const cfg = await load();
    const forged = { cookies: { access_token: "forged" }, ip: "1.2.3.4" };
    expect(cfg.keyGenerator(forged)).toBe("1.2.3.4");
    expect(cfg.limit(forged)).toBe(60);
  });

  it("uses a 60s window and skips /api/auth/", async () => {
    const cfg = await load();
    expect(cfg.windowMs).toBe(60_000);
    expect(cfg.skip({ path: "/api/auth/login" })).toBe(true);
    expect(cfg.skip({ path: "/api/inventory" })).toBe(false);
  });
});
