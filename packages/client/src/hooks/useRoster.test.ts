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

  const expectedFns = [
    "parseError",
    "getRoleDocuments",
    "setRoleDocuments",
    "fetchShiftAssignments",
    "requestConsent",
    "listPublicHolidays",
    "createPublicHoliday",
    "deletePublicHoliday",
    "listAwardRules",
    "upsertAwardRule",
    "previewAwardRuleCsv",
    "commitAwardRuleCsvImport",
  ];

  it.each(expectedHooks)("exports %s as a function", (name) => {
    expect(typeof (roster as Record<string, unknown>)[name]).toBe("function");
  });

  it.each(expectedFns)("exports standalone function %s", (name) => {
    expect(typeof (roster as Record<string, unknown>)[name]).toBe("function");
  });

  it("exports AWARD_RULE_TYPES as a non-empty array", () => {
    expect(Array.isArray((roster as Record<string, unknown>)["AWARD_RULE_TYPES"])).toBe(true);
  });

  it("exports AWARD_CHECKED_RULE_TYPES as a non-empty array", () => {
    expect(Array.isArray((roster as Record<string, unknown>)["AWARD_CHECKED_RULE_TYPES"])).toBe(true);
  });

  it("exports AU_JURISDICTIONS as a non-empty array", () => {
    expect(Array.isArray((roster as Record<string, unknown>)["AU_JURISDICTIONS"])).toBe(true);
  });
});
