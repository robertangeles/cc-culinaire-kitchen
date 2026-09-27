import { describe, it, expect } from "vitest";
import * as roster from "./useRoster.js";

describe("useRoster barrel", () => {
  const expectedHooks = [
    "useRosterRoles",
    "useOrgMembers",
    "useShifts",
    "useRosterTemplates",
    "useRosterCalendar",
    "usePublish",
    "useMyShifts",
    "useMyAvailability",
  ];

  it.each(expectedHooks)("exports %s as a function", (name) => {
    expect(typeof (roster as Record<string, unknown>)[name]).toBe("function");
  });
});
