import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const stored = vi.hoisted(() => ({ value: undefined as string | undefined, reads: 0 }));
const logged = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn() }));

vi.mock("pino", () => ({ default: () => logged }));
vi.mock("../db/index.js", () => {
  const chain = { from: () => chain, where: () => chain, limit: async () => (stored.reads++, stored.value === undefined ? [] : [{ value: stored.value }]) };
  return { db: { select: () => chain } };
});

import { blockedTerms, refuseBlockedTerms, __test } from "./benchFilterService.js";
import { AppError } from "../utils/appError.js";

// Made-up placeholder terms only.
beforeEach(() => {
  __test.reset();
  stored.value = "zorp\nblim flam";
  stored.reads = 0;
  logged.warn.mockClear();
  logged.info.mockClear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("refuseBlockedTerms", () => {
  it("lets a post without a listed term through", async () => {
    await expect(refuseBlockedTerms("Lunch at two?")).resolves.toBeUndefined();
  });

  it("refuses a post with a listed term with POST_NOT_ALLOWED and the neutral sentence", async () => {
    const err = await refuseBlockedTerms("well z0rp").catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ statusCode: 422, code: "POST_NOT_ALLOWED", message: "This message can't be posted." });
  });

  it("logs only how many terms matched: never the text or the term", async () => {
    await refuseBlockedTerms("such a blim flam zorp day").catch(() => {});
    const everything = JSON.stringify([...logged.info.mock.calls, ...logged.warn.mock.calls]);
    expect(logged.info).toHaveBeenCalledWith({ matched: 2 }, expect.any(String));
    expect(everything).not.toMatch(/zorp|blim|flam|such a/);
  });

  it.each([["missing", undefined], ["empty", ""], ["blank", " \n \n"]])("filters nothing when the list is %s, and warns on the read", async (_, value) => {
    stored.value = value;
    await expect(refuseBlockedTerms("zorp")).resolves.toBeUndefined();
    expect(logged.warn).toHaveBeenCalledTimes(1);
  });

  it("does not warn when the list has terms", async () => {
    await blockedTerms();
    expect(logged.warn).not.toHaveBeenCalled();
  });
});

describe("blockedTerms cache", () => {
  it("reads the list once a minute at most, and once for posts arriving together", async () => {
    await Promise.all([blockedTerms(), blockedTerms(), refuseBlockedTerms("hi")]);
    vi.advanceTimersByTime(59_000);
    await blockedTerms();
    expect(stored.reads).toBe(1);
  });

  it("sees a changed list once the minute is over", async () => {
    await expect(refuseBlockedTerms("quux")).resolves.toBeUndefined();
    stored.value = "quux";
    vi.advanceTimersByTime(60_000);
    await expect(refuseBlockedTerms("quux")).rejects.toMatchObject({ code: "POST_NOT_ALLOWED" });
    expect(stored.reads).toBe(2);
  });

  it("warns again on each read while the list stays empty", async () => {
    stored.value = "";
    await blockedTerms();
    vi.advanceTimersByTime(60_000);
    await blockedTerms();
    expect(logged.warn).toHaveBeenCalledTimes(2);
  });
});
