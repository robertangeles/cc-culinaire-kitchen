import { describe, it, expect, vi } from "vitest";

/** Before migration 0009 is applied the Bench must go on working, with nobody blocked. */
const { failure } = vi.hoisted(() => ({ failure: { error: null as unknown } }));
const chain = (): any => new Proxy(() => undefined, { get: (_t, key) => (key === "then" ? (_ok: unknown, fail: (e: unknown) => void) => fail(failure.error) : chain()), apply: () => chain() });
vi.mock("../db/index.js", () => ({ db: { select: () => chain() } }));

import { blockedBy, isBlockedEitherWay } from "./benchBlockService.js";

describe("bench blocks before their table exists", () => {
  it("reads as nobody blocked", async () => {
    failure.error = Object.assign(new Error('relation "bench_blocks" does not exist'), { code: "42P01" });
    expect(await blockedBy(1)).toEqual([]);
    expect(await isBlockedEitherWay(1, 2)).toBe(false);
  });

  it("still fails on any other database error", async () => {
    failure.error = Object.assign(new Error("connection lost"), { code: "57P01" });
    await expect(blockedBy(1)).rejects.toThrow("connection lost");
  });
});
