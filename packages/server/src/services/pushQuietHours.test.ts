import { describe, it, expect } from "vitest";
import { isQuietNow, minutesOf } from "./pushQuietHours.js";

const SYDNEY = "Australia/Sydney";

describe("minutesOf", () => {
  it("reads HH:MM as minutes after midnight", () => {
    expect(minutesOf("00:00")).toBe(0);
    expect(minutesOf("07:30")).toBe(450);
    expect(minutesOf("23:59")).toBe(1439);
  });
});

describe("isQuietNow", () => {
  // 2026-07-01 is winter: Sydney is UTC+10, so 12:00Z is 22:00 there.
  const at = (iso: string) => new Date(iso);

  it("is quiet inside a same-day window and not outside it", () => {
    const q = { startMinute: 13 * 60, endMinute: 15 * 60, timeZone: "UTC" };
    expect(isQuietNow(at("2026-07-01T13:00:00Z"), q)).toBe(true);
    expect(isQuietNow(at("2026-07-01T14:59:00Z"), q)).toBe(true);
    expect(isQuietNow(at("2026-07-01T15:00:00Z"), q)).toBe(false);
    expect(isQuietNow(at("2026-07-01T12:59:00Z"), q)).toBe(false);
  });

  it("handles a window that crosses midnight", () => {
    const q = { startMinute: 22 * 60, endMinute: 7 * 60, timeZone: "UTC" };
    expect(isQuietNow(at("2026-07-01T22:00:00Z"), q)).toBe(true);
    expect(isQuietNow(at("2026-07-01T23:59:00Z"), q)).toBe(true);
    expect(isQuietNow(at("2026-07-02T00:00:00Z"), q)).toBe(true);
    expect(isQuietNow(at("2026-07-02T06:59:00Z"), q)).toBe(true);
    expect(isQuietNow(at("2026-07-02T07:00:00Z"), q)).toBe(false);
    expect(isQuietNow(at("2026-07-02T12:00:00Z"), q)).toBe(false);
  });

  it("reads the window in the person's own time zone", () => {
    const q = { startMinute: 22 * 60, endMinute: 7 * 60, timeZone: SYDNEY };
    expect(isQuietNow(at("2026-07-01T12:00:00Z"), q)).toBe(true); // 22:00 in Sydney
    expect(isQuietNow(at("2026-07-01T22:00:00Z"), q)).toBe(false); // 08:00 in Sydney
    expect(isQuietNow(at("2026-07-01T20:59:00Z"), q)).toBe(true); // 06:59 in Sydney
    expect(isQuietNow(at("2026-07-01T21:00:00Z"), q)).toBe(false); // 07:00 in Sydney: the window has ended
  });

  it("follows daylight saving: the same UTC hour is a different local hour in January", () => {
    const q = { startMinute: 22 * 60, endMinute: 7 * 60, timeZone: SYDNEY };
    expect(isQuietNow(at("2026-01-01T11:00:00Z"), q)).toBe(true); // 22:00 AEDT (UTC+11)
    expect(isQuietNow(at("2026-01-01T10:59:00Z"), q)).toBe(false); // 21:59 AEDT
  });

  it("is not quiet, and does not throw, for a time zone this server does not know", () => {
    expect(isQuietNow(at("2026-07-01T23:00:00Z"), { startMinute: 0, endMinute: 1439, timeZone: "Not/AZone" })).toBe(false);
  });
});
