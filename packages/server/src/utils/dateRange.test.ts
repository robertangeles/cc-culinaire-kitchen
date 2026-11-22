import { describe, it, expect } from "vitest";
import { dayBounds } from "./dateRange.js";

describe("dayBounds", () => {
  it("a date-only string covers that whole UTC day, end included", () => {
    expect(dayBounds("2026-03-05")).toEqual({
      start: new Date("2026-03-05T00:00:00.000Z"),
      end: new Date("2026-03-05T23:59:59.999Z"),
    });
  });

  it("a full timestamp means exactly that moment at both ends", () => {
    const t = "2026-03-05T12:30:00.000Z";
    expect(dayBounds(t)).toEqual({ start: new Date(t), end: new Date(t) });
  });
});
