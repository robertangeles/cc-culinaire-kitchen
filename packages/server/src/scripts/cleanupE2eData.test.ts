import { describe, it, expect } from "vitest";
import { assertCleanupAllowed, cutoffFrom } from "./cleanupE2eData.js";

describe("assertCleanupAllowed", () => {
  it("refuses a production process", () => {
    expect(() => assertCleanupAllowed(true)).toThrow(/production/i);
  });

  it("allows a non-production process", () => {
    expect(() => assertCleanupAllowed(false)).not.toThrow();
  });
});

describe("cutoffFrom", () => {
  it("is exactly maxAgeMinutes before now", () => {
    const now = new Date("2026-10-04T12:00:00Z");
    expect(cutoffFrom(now, 60).toISOString()).toBe("2026-10-04T11:00:00.000Z");
  });
});
