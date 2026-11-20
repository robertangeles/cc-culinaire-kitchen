import { describe, it, expect, vi } from "vitest";
import { createRunner } from "./runner";

function setup(results: Array<{ sent: number; nextWakeAt: number | null } | Error>) {
  const drain = vi.fn(async () => {
    const next = results.shift() ?? { sent: 0, nextWakeAt: null };
    if (next instanceof Error) throw next;
    return next;
  });
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const clock = { t: 10_000 };
  const runner = createRunner({
    outbox: { drain },
    now: () => clock.t,
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (h) => void ((h as (typeof timers)[number]).cleared = true),
  });
  return { runner, drain, timers, clock };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("outbox runner", () => {
  it("drains when kicked and sets no timer when nothing is waiting", async () => {
    const { runner, drain, timers } = setup([{ sent: 1, nextWakeAt: null }]);
    runner.kick();
    await flush();
    expect(drain).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(0);
  });

  it("comes back when the outbox says to (a backoff or the rate cap), never sooner than a second", async () => {
    const { runner, drain, timers, clock } = setup([{ sent: 20, nextWakeAt: 10_000 + 45_000 }, { sent: 5, nextWakeAt: 10_000 + 200 }]);
    runner.kick();
    await flush();
    expect(timers[0].ms).toBe(45_000);

    clock.t += 45_000;
    timers[0].fn();
    await flush();
    expect(drain).toHaveBeenCalledTimes(2);
    expect(timers[1].ms).toBe(1_000);
  });

  it("a new kick replaces the pending timer instead of stacking them", async () => {
    const { runner, timers } = setup([{ sent: 0, nextWakeAt: 10_000 + 5_000 }, { sent: 0, nextWakeAt: 10_000 + 5_000 }]);
    runner.kick();
    await flush();
    runner.kick();
    await flush();
    expect(timers[0].cleared).toBe(true);
    expect(timers).toHaveLength(2);
  });

  it("tries again in 30 seconds when a drain fails (a database error must not stop all sending for good)", async () => {
    const { runner, drain, timers } = setup([new Error("SQLITE_BUSY")]);
    runner.kick();
    await flush();
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(30_000);
    timers[0].fn();
    await flush();
    expect(drain).toHaveBeenCalledTimes(2);
  });
});
