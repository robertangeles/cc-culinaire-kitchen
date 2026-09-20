import { describe, it, expect } from "vitest";
import {
  evaluateAwardRules,
  AWARD_CHECKED_RULE_TYPES,
  AWARD_NOT_CHECKED_RULE_TYPES,
  ALL_AWARD_RULE_TYPES,
  upsertAwardRule,
  AwardRuleError,
} from "./awardRuleService.js";

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

/**
 * upsertAwardRule's validation runs BEFORE any DB call — every case here
 * rejects synchronously on bad input, so these are real unit tests, not
 * integration tests in disguise. The write path itself (auto-supersede,
 * same-day-edit guard, concurrency) is covered against a real DB in
 * awardRuleService.integration.test.ts, matching upsertExpiryRule's split.
 */
describe("upsertAwardRule — input validation (no DB)", () => {
  const validInput = {
    awardCode: "MA000009",
    ruleType: "max_ordinary_hours",
    jurisdiction: null,
    thresholdValue: 38,
    effectiveFrom: "2026-07-01",
    sourceCitation: null,
  };

  it("rejects an empty award code", async () => {
    await expect(upsertAwardRule({ ...validInput, awardCode: "  " }, 1)).rejects.toThrow(AwardRuleError);
    await expect(upsertAwardRule({ ...validInput, awardCode: "  " }, 1)).rejects.toThrow(/award code/i);
  });

  it("rejects an unrecognized rule type", async () => {
    await expect(upsertAwardRule({ ...validInput, ruleType: "made_up_type" }, 1)).rejects.toThrow(
      /Unrecognized rule type/,
    );
  });

  it("accepts every one of the 9 documented rule types, not just the 2 currently evaluated", () => {
    expect(ALL_AWARD_RULE_TYPES).toHaveLength(9);
  });

  it("rejects a jurisdiction that isn't a real AU state/territory code", async () => {
    await expect(upsertAwardRule({ ...validInput, jurisdiction: "NWS" }, 1)).rejects.toThrow(
      /Unrecognized jurisdiction code/,
    );
  });

  it("rejects a zero threshold", async () => {
    await expect(upsertAwardRule({ ...validInput, thresholdValue: 0 }, 1)).rejects.toThrow(/positive number/);
  });

  it("rejects a negative threshold", async () => {
    await expect(upsertAwardRule({ ...validInput, thresholdValue: -5 }, 1)).rejects.toThrow(/positive number/);
  });

  it("rejects a missing effectiveFrom", async () => {
    await expect(upsertAwardRule({ ...validInput, effectiveFrom: "" }, 1)).rejects.toThrow(/effective-from/i);
  });
});
