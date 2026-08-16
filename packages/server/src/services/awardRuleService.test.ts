import { describe, it, expect } from "vitest";
import { evaluateAwardRules, AWARD_CHECKED_RULE_TYPES, AWARD_NOT_CHECKED_RULE_TYPES } from "./awardRuleService.js";

const NOW = "2026-08-01T00:00:00.000Z";

describe("Formula F-AR-01: evaluateAwardRules", () => {
  describe("the ship-empty case", () => {
    it("zero active rules -> empty warnings, but coverage is still fully populated", () => {
      const shift = { startDatetime: "2026-08-10T09:00:00.000Z", endDatetime: "2026-08-10T17:00:00.000Z" };
      const result = evaluateAwardRules(shift, [], NOW, "VIC");
      expect(result.warnings).toEqual([]);
      expect(result.coverage).toEqual({
        checked: [...AWARD_CHECKED_RULE_TYPES],
        notChecked: [...AWARD_NOT_CHECKED_RULE_TYPES],
        ruleVersionsInScope: [],
        jurisdiction: "VIC",
      });
    });

    it("coverage.checked and notChecked never overlap and together are non-trivial", () => {
      const overlap = AWARD_CHECKED_RULE_TYPES.filter((t) => (AWARD_NOT_CHECKED_RULE_TYPES as readonly string[]).includes(t));
      expect(overlap).toEqual([]);
      expect(AWARD_CHECKED_RULE_TYPES.length).toBeGreaterThan(0);
      expect(AWARD_NOT_CHECKED_RULE_TYPES.length).toBeGreaterThan(0);
    });
  });

  describe("max_ordinary_hours", () => {
    const rule = { ruleType: "max_ordinary_hours", thresholdValue: 8, ruleVersion: "v1", sourceCitation: "MA000009 cl 32" };

    it("shift under the threshold -> no warning", () => {
      const shift = { startDatetime: "2026-08-10T09:00:00.000Z", endDatetime: "2026-08-10T16:00:00.000Z" }; // 7h
      expect(evaluateAwardRules(shift, [rule], NOW, "VIC").warnings).toEqual([]);
    });

    it("shift exactly at the threshold -> no warning (only exceeding triggers)", () => {
      const shift = { startDatetime: "2026-08-10T09:00:00.000Z", endDatetime: "2026-08-10T17:00:00.000Z" }; // 8h
      expect(evaluateAwardRules(shift, [rule], NOW, "VIC").warnings).toEqual([]);
    });

    it("shift over the threshold -> one advisory warning naming the rule version and citation", () => {
      const shift = { startDatetime: "2026-08-10T09:00:00.000Z", endDatetime: "2026-08-10T20:00:00.000Z" }; // 11h
      const result = evaluateAwardRules(shift, [rule], NOW, "VIC");
      expect(result.warnings).toEqual([
        {
          severity: "advisory",
          message: "This shift is 11 hours long, exceeding the Award's 8-hour ordinary-hours limit.",
          ruleVersion: "v1",
          sourceCitation: "MA000009 cl 32",
        },
      ]);
    });
  });

  describe("publish_notice", () => {
    const rule = { ruleType: "publish_notice", thresholdValue: 168, ruleVersion: "v1", sourceCitation: null };

    it("plenty of notice -> no warning", () => {
      const shift = { startDatetime: "2026-09-01T09:00:00.000Z", endDatetime: "2026-09-01T17:00:00.000Z" };
      expect(evaluateAwardRules(shift, [rule], NOW, "VIC").warnings).toEqual([]);
    });

    it("less than the required notice -> one advisory warning", () => {
      const shift = { startDatetime: "2026-08-02T00:00:00.000Z", endDatetime: "2026-08-02T08:00:00.000Z" }; // 24h notice, needs 168
      const result = evaluateAwardRules(shift, [rule], NOW, "VIC");
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].message).toBe(
        "This shift starts in 24 hours, less than the Award's required 168 hours' notice.",
      );
    });

    it("shift already in the past (negative notice) -> still a warning, not a crash", () => {
      const shift = { startDatetime: "2026-07-30T00:00:00.000Z", endDatetime: "2026-07-30T08:00:00.000Z" };
      const result = evaluateAwardRules(shift, [rule], NOW, "VIC");
      expect(result.warnings).toHaveLength(1);
    });
  });

  describe("multiple active rules", () => {
    it("both rule types can fire independently on the same shift", () => {
      const hoursRule = { ruleType: "max_ordinary_hours", thresholdValue: 8, ruleVersion: "v1", sourceCitation: null };
      const noticeRule = { ruleType: "publish_notice", thresholdValue: 168, ruleVersion: "v1", sourceCitation: null };
      const shift = { startDatetime: "2026-08-02T00:00:00.000Z", endDatetime: "2026-08-02T12:00:00.000Z" }; // 12h shift, 24h notice
      const result = evaluateAwardRules(shift, [hoursRule, noticeRule], NOW, "VIC");
      expect(result.warnings).toHaveLength(2);
    });

    it("ruleVersionsInScope dedupes across rules sharing a version", () => {
      const hoursRule = { ruleType: "max_ordinary_hours", thresholdValue: 8, ruleVersion: "2026-07-01", sourceCitation: null };
      const noticeRule = { ruleType: "publish_notice", thresholdValue: 168, ruleVersion: "2026-07-01", sourceCitation: null };
      const shift = { startDatetime: "2026-08-10T09:00:00.000Z", endDatetime: "2026-08-10T17:00:00.000Z" };
      const result = evaluateAwardRules(shift, [hoursRule, noticeRule], NOW, "VIC");
      expect(result.coverage.ruleVersionsInScope).toEqual(["2026-07-01"]);
    });

    it("an unrecognised ruleType in activeRules is silently ignored, not thrown", () => {
      const unknownRule = { ruleType: "some_future_rule_type", thresholdValue: 1, ruleVersion: "v1", sourceCitation: null };
      const shift = { startDatetime: "2026-08-10T09:00:00.000Z", endDatetime: "2026-08-10T17:00:00.000Z" };
      expect(() => evaluateAwardRules(shift, [unknownRule], NOW, "VIC")).not.toThrow();
      expect(evaluateAwardRules(shift, [unknownRule], NOW, "VIC").warnings).toEqual([]);
    });
  });

  describe("jurisdiction passthrough", () => {
    it("null jurisdiction (national) passes through to coverage unchanged", () => {
      const shift = { startDatetime: "2026-08-10T09:00:00.000Z", endDatetime: "2026-08-10T17:00:00.000Z" };
      expect(evaluateAwardRules(shift, [], NOW, null).coverage.jurisdiction).toBeNull();
    });
  });
});
