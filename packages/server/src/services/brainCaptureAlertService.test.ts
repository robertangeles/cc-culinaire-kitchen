import { describe, it, expect } from "vitest";
import { shouldAlertCaptureError } from "./brainCaptureAlertService.js";

/**
 * The trigger must fire only when capture is genuinely broken (errors dominate
 * over a window), never on transient blips, first-boot baselines, or counter
 * resets. Pure function → exhaustively testable without DB/notifications.
 */
describe("brainCaptureAlertService — shouldAlertCaptureError", () => {
  it("does not fire on the first tick (no baseline)", () => {
    expect(shouldAlertCaptureError(null, { recorded: 5, skipped: 0, errors: 9 })).toBe(false);
  });

  it("fires when errors clear the floor AND dominate successes", () => {
    const prev = { recorded: 10, skipped: 0, errors: 0 };
    const curr = { recorded: 10, skipped: 0, errors: 5 }; // +5 errors, +0 recorded
    expect(shouldAlertCaptureError(prev, curr)).toBe(true);
  });

  it("does NOT fire on a few transient errors below the floor", () => {
    const prev = { recorded: 10, skipped: 0, errors: 0 };
    const curr = { recorded: 20, skipped: 0, errors: 2 }; // +2 errors < floor
    expect(shouldAlertCaptureError(prev, curr)).toBe(false);
  });

  it("does NOT fire when successes outpace errors (healthy with noise)", () => {
    const prev = { recorded: 100, skipped: 0, errors: 0 };
    const curr = { recorded: 150, skipped: 0, errors: 4 }; // +4 errors, +50 recorded
    expect(shouldAlertCaptureError(prev, curr)).toBe(false);
  });

  it("fires at the boundary where errors equal recorded (>= floor)", () => {
    const prev = { recorded: 0, skipped: 0, errors: 0 };
    const curr = { recorded: 3, skipped: 0, errors: 3 }; // +3 == +3, >= floor
    expect(shouldAlertCaptureError(prev, curr)).toBe(true);
  });

  it("does NOT fire on a counter reset (process restart → negative delta)", () => {
    const prev = { recorded: 100, skipped: 0, errors: 40 };
    const curr = { recorded: 2, skipped: 0, errors: 1 }; // counters reset on restart
    expect(shouldAlertCaptureError(prev, curr)).toBe(false);
  });

  it("respects a custom minErrors floor", () => {
    const prev = { recorded: 0, skipped: 0, errors: 0 };
    const curr = { recorded: 0, skipped: 0, errors: 5 };
    expect(shouldAlertCaptureError(prev, curr, 10)).toBe(false);
    expect(shouldAlertCaptureError(prev, curr, 5)).toBe(true);
  });
});
