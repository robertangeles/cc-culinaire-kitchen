import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Contract tests for the rate limiter factory configurations.
 *
 * What these tests do: lock down the *configuration* we pass to
 * `express-rate-limit` (`limit`, `windowMs`, `keyGenerator`). If a future
 * refactor silently bumps the chat limit to 200/min or strips the
 * per-user keying, these tests fail.
 *
 * What they don't do: re-test that `express-rate-limit` itself counts
 * correctly. That library is upstream-tested; mirroring its tests here
 * would be brittle (real time-of-day windows, internal in-memory store
 * shared across test cases) without adding signal.
 *
 * The mock pattern intercepts the `rateLimit` factory so we can assert
 * what config it received during module construction. Because the
 * rateLimiter module constructs the limiters at import time, we
 * `vi.resetModules()` before each test and dynamically import inside
 * the test body so a fresh construction is observed.
 */

const mockRateLimit = vi.fn(() => ({ __mock: "limiter" }));

vi.mock("express-rate-limit", () => ({
  rateLimit: mockRateLimit,
}));

describe("rateLimiter — chatRateLimit config", () => {
  beforeEach(() => {
    mockRateLimit.mockClear();
    vi.resetModules();
  });

  it("constructs with 20 requests per 60 seconds", async () => {
    await import("./rateLimiter.js");

    // Four limiters are constructed: chat + mobile prompt + mobile RAG +
    // mobile feedback. Assert call count first so we catch any future
    // limiter being added or removed silently.
    expect(mockRateLimit).toHaveBeenCalledTimes(4);

    const chatConfig = mockRateLimit.mock.calls[0][0] as Record<string, unknown>;
    expect(chatConfig.limit).toBe(20);
    expect(chatConfig.windowMs).toBe(60 * 1000);
  });

  it("uses a per-user/guest/IP keyGenerator (not just IP)", async () => {
    await import("./rateLimiter.js");

    const chatConfig = mockRateLimit.mock.calls[0][0] as {
      keyGenerator: (req: unknown) => string;
    };

    // Authenticated user → user-scoped key. Critical: this means logging
    // in from the same IP doesn't blow your rate budget on a shared NAT.
    expect(
      chatConfig.keyGenerator({ user: { sub: 42 }, ip: "1.2.3.4" }),
    ).toBe("user-42");

    // Guest token → guest-scoped key. Without this, anonymous-mode users
    // on a shared IP would all share one bucket.
    expect(
      chatConfig.keyGenerator({ guestToken: "abc123", ip: "1.2.3.4" }),
    ).toBe("guest-abc123");

    // No auth and no guest → fall back to IP. The `?? "unknown"` clause
    // matters: when running behind a proxy without `trust proxy`, req.ip
    // can be undefined and we don't want a TypeError mid-request.
    expect(chatConfig.keyGenerator({ ip: "1.2.3.4" })).toBe("1.2.3.4");
    expect(chatConfig.keyGenerator({})).toBe("unknown");
  });
});

describe("rateLimiter — mobilePromptRateLimit config", () => {
  beforeEach(() => {
    mockRateLimit.mockClear();
    vi.resetModules();
  });

  it("constructs with 30 requests per 60 seconds", async () => {
    // Locks the per-route override: mobile prompt fetch should be looser
    // than chat (20/min) but well below the global default (60/min).
    // 30/min lets a busy mobile client refresh its prompt cache after
    // version bumps without ever brushing the limit.
    await import("./rateLimiter.js");

    const mobileConfig = mockRateLimit.mock.calls[1][0] as Record<string, unknown>;
    expect(mobileConfig.limit).toBe(30);
    expect(mobileConfig.windowMs).toBe(60 * 1000);
  });

  it("uses a per-user keyGenerator with IP fallback for unauthenticated requests", async () => {
    await import("./rateLimiter.js");

    const mobileConfig = mockRateLimit.mock.calls[1][0] as {
      keyGenerator: (req: unknown) => string;
    };

    // Authenticated user → user bucket. (The route requires authenticate
    // middleware upstream, so unauthenticated requests would never reach
    // the limiter in normal operation. The IP fallback is a defence in
    // depth in case someone moves the middleware order.)
    expect(
      mobileConfig.keyGenerator({ user: { sub: 7 }, ip: "1.2.3.4" }),
    ).toBe("user-7");
    expect(mobileConfig.keyGenerator({ ip: "1.2.3.4" })).toBe("1.2.3.4");
    expect(mobileConfig.keyGenerator({})).toBe("unknown");
  });

  it("returns standardised draft-8 rate limit headers", async () => {
    // Mobile clients should be able to introspect `RateLimit-Remaining`
    // to back off proactively. Locking the header format prevents a future
    // refactor from accidentally returning the older deprecated format.
    await import("./rateLimiter.js");

    const mobileConfig = mockRateLimit.mock.calls[1][0] as Record<string, unknown>;
    expect(mobileConfig.standardHeaders).toBe("draft-8");
    expect(mobileConfig.legacyHeaders).toBe(false);
  });
});

describe("rateLimiter — mobileRagRateLimit config", () => {
  beforeEach(() => {
    mockRateLimit.mockClear();
    vi.resetModules();
  });

  it("constructs with 60 requests per 60 seconds", async () => {
    // Locks the per-route override: mobile RAG retrieval is looser than
    // both chat (20/min) and the prompt-fetch route (30/min). RAG fires
    // on every chat message in the mobile app, so 60/min = 1 query per
    // second sustained — comfortably above any human typing pace.
    await import("./rateLimiter.js");

    const ragConfig = mockRateLimit.mock.calls[2][0] as Record<string, unknown>;
    expect(ragConfig.limit).toBe(60);
    expect(ragConfig.windowMs).toBe(60 * 1000);
  });

  it("uses a per-user keyGenerator with IP fallback", async () => {
    await import("./rateLimiter.js");

    const ragConfig = mockRateLimit.mock.calls[2][0] as {
      keyGenerator: (req: unknown) => string;
    };
    expect(
      ragConfig.keyGenerator({ user: { sub: 99 }, ip: "1.2.3.4" }),
    ).toBe("user-99");
    expect(ragConfig.keyGenerator({ ip: "1.2.3.4" })).toBe("1.2.3.4");
    expect(ragConfig.keyGenerator({})).toBe("unknown");
  });

  it("returns standardised draft-8 rate limit headers", async () => {
    await import("./rateLimiter.js");

    const ragConfig = mockRateLimit.mock.calls[2][0] as Record<string, unknown>;
    expect(ragConfig.standardHeaders).toBe("draft-8");
    expect(ragConfig.legacyHeaders).toBe(false);
  });
});

describe("rateLimiter — feedbackRateLimit config", () => {
  beforeEach(() => {
    mockRateLimit.mockClear();
    vi.resetModules();
  });

  it("constructs with a 1-hour window", async () => {
    // Per `needs-frontend.md` 2026-05-04: 10/hr/user (auth), 3/hr/IP (anon).
    // The window is locked to 1 hour; the per-request `limit` function is
    // exercised separately below.
    await import("./rateLimiter.js");

    const config = mockRateLimit.mock.calls[3][0] as Record<string, unknown>;
    expect(config.windowMs).toBe(60 * 60 * 1000);
  });

  it("returns 10 for authenticated requests, 3 for anonymous (limit fn)", async () => {
    await import("./rateLimiter.js");

    const config = mockRateLimit.mock.calls[3][0] as {
      limit: (req: unknown) => number;
    };
    expect(config.limit({ user: { sub: 1 } })).toBe(10);
    expect(config.limit({})).toBe(3);
  });

  it("hashes the IP for anonymous keying (privacy invariant)", async () => {
    // The privacy contract: the rate-limiter store must not hold a
    // recoverable IP. We assert the key shape includes `feedback-ip-` and
    // is NOT the raw IP. This catches a future refactor that swaps in
    // `req.ip` directly.
    await import("./rateLimiter.js");

    const config = mockRateLimit.mock.calls[3][0] as {
      keyGenerator: (req: unknown) => string;
    };
    const key = config.keyGenerator({ ip: "1.2.3.4" });
    expect(key.startsWith("feedback-ip-")).toBe(true);
    expect(key).not.toContain("1.2.3.4");

    // Auth path uses user-keyed bucket.
    expect(config.keyGenerator({ user: { sub: 7 } })).toBe("feedback-user-7");
  });

  it("returns standardised draft-8 rate limit headers (Retry-After on 429)", async () => {
    // Mobile parses Retry-After for the cooldown countdown UX
    // (`ApiError.retryAfter`). draft-8 includes Retry-After automatically.
    await import("./rateLimiter.js");

    const config = mockRateLimit.mock.calls[3][0] as Record<string, unknown>;
    expect(config.standardHeaders).toBe("draft-8");
    expect(config.legacyHeaders).toBe(false);
  });
});
