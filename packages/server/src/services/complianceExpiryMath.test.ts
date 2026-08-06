import { describe, it, expect } from "vitest";
import { computeExpiryActions } from "./complianceExpiryMath.js";

const RULE = {
  alertDays: [90, 60, 30, 7],
  effectiveFrom: "2020-01-01",
  effectiveTo: null,
};

describe("Formula F-CE-01: computeExpiryActions", () => {
  describe("No expiry date", () => {
    it("never expires — gating falls back to verificationStatus alone", () => {
      const doc = { expiryDate: null, verificationStatus: "Verified" };
      expect(computeExpiryActions(doc, RULE, "2026-08-06")).toEqual([{ kind: "none" }]);
    });

    it("still none even with an expired-sounding status and a matching rule", () => {
      const doc = { expiryDate: null, verificationStatus: "Pending" };
      expect(computeExpiryActions(doc, RULE, "2026-08-06")).toEqual([{ kind: "none" }]);
    });
  });

  describe("Dead statuses — Archived / Rejected", () => {
    it("Archived document is never chased even if past its expiry date", () => {
      const doc = { expiryDate: "2020-01-01", verificationStatus: "Archived" };
      expect(computeExpiryActions(doc, RULE, "2026-08-06")).toEqual([{ kind: "none" }]);
    });

    it("Rejected document is never chased even if within an alert window", () => {
      const doc = { expiryDate: "2026-09-05", verificationStatus: "Rejected" };
      expect(computeExpiryActions(doc, RULE, "2026-08-06")).toEqual([{ kind: "none" }]);
    });

    it("Pending and Verified are NOT dead statuses — normal processing applies", () => {
      const doc = { expiryDate: "2020-01-01", verificationStatus: "Pending" };
      expect(computeExpiryActions(doc, RULE, "2026-08-06")).toEqual([{ kind: "expired" }]);
    });
  });

  describe("Rule lookup", () => {
    it("rule null (no rule for this type+jurisdiction) -> none, caller warns", () => {
      const doc = { expiryDate: "2026-09-05", verificationStatus: "Verified" };
      expect(computeExpiryActions(doc, null, "2026-08-06")).toEqual([{ kind: "none" }]);
    });

    it("rule not yet effective as of today -> none", () => {
      const rule = { alertDays: [30], effectiveFrom: "2027-01-01", effectiveTo: null };
      const doc = { expiryDate: "2027-01-31", verificationStatus: "Verified" };
      expect(computeExpiryActions(doc, rule, "2026-08-06")).toEqual([{ kind: "none" }]);
    });

    it("rule already ended before today -> none", () => {
      const rule = { alertDays: [30], effectiveFrom: "2020-01-01", effectiveTo: "2025-12-31" };
      const doc = { expiryDate: "2026-09-05", verificationStatus: "Verified" };
      expect(computeExpiryActions(doc, rule, "2026-08-06")).toEqual([{ kind: "none" }]);
    });

    it("effectiveFrom === today is in effect (inclusive)", () => {
      const rule = { alertDays: [30], effectiveFrom: "2026-08-06", effectiveTo: null };
      const doc = { expiryDate: "2026-09-05", verificationStatus: "Verified" };
      expect(computeExpiryActions(doc, rule, "2026-08-06")).toEqual([
        { kind: "alert", daysBefore: 30, daysRemaining: 30 },
      ]);
    });

    it("effectiveTo === today is still in effect (inclusive)", () => {
      const rule = { alertDays: [30], effectiveFrom: "2020-01-01", effectiveTo: "2026-08-06" };
      const doc = { expiryDate: "2026-09-05", verificationStatus: "Verified" };
      expect(computeExpiryActions(doc, rule, "2026-08-06")).toEqual([
        { kind: "alert", daysBefore: 30, daysRemaining: 30 },
      ]);
    });
  });

  describe("Expired", () => {
    it("expiryDate strictly before today -> expired", () => {
      const doc = { expiryDate: "2026-08-01", verificationStatus: "Verified" };
      expect(computeExpiryActions(doc, RULE, "2026-08-06")).toEqual([{ kind: "expired" }]);
    });

    it("expiryDate === today -> expired (not valid-until-end-of-day)", () => {
      const doc = { expiryDate: "2026-08-06", verificationStatus: "Verified" };
      expect(computeExpiryActions(doc, RULE, "2026-08-06")).toEqual([{ kind: "expired" }]);
    });

    it("expired takes priority over any alertDays match", () => {
      const rule = { alertDays: [0], effectiveFrom: "2020-01-01", effectiveTo: null };
      const doc = { expiryDate: "2026-08-06", verificationStatus: "Verified" };
      expect(computeExpiryActions(doc, rule, "2026-08-06")).toEqual([{ kind: "expired" }]);
    });
  });

  describe("Alerts — exact daysRemaining match only", () => {
    it("daysRemaining exactly matches an alertDay -> fires that alert", () => {
      const doc = { expiryDate: "2026-09-05", verificationStatus: "Verified" };
      // 2026-08-06 -> 2026-09-05 is 30 days remaining.
      expect(computeExpiryActions(doc, RULE, "2026-08-06")).toEqual([
        { kind: "alert", daysBefore: 30, daysRemaining: 30 },
      ]);
    });

    it("one day before the alertDay -> no alert (fires exactly once)", () => {
      const doc = { expiryDate: "2026-09-06", verificationStatus: "Verified" };
      // 31 days remaining — one more than the 30-day alertDay.
      expect(computeExpiryActions(doc, RULE, "2026-08-06")).toEqual([{ kind: "none" }]);
    });

    it("one day after the alertDay -> no alert (fires exactly once)", () => {
      const doc = { expiryDate: "2026-09-04", verificationStatus: "Verified" };
      // 29 days remaining — one less than the 30-day alertDay.
      expect(computeExpiryActions(doc, RULE, "2026-08-06")).toEqual([{ kind: "none" }]);
    });

    it("multiple alertDays configured, only the matching one fires", () => {
      const doc = { expiryDate: "2026-10-05", verificationStatus: "Verified" };
      // 2026-08-06 -> 2026-10-05 is 60 days remaining; alertDays has 90/60/30/7.
      expect(computeExpiryActions(doc, RULE, "2026-08-06")).toEqual([
        { kind: "alert", daysBefore: 60, daysRemaining: 60 },
      ]);
    });

    it("daysRemaining that matches none of the alertDays -> none", () => {
      const doc = { expiryDate: "2026-10-20", verificationStatus: "Verified" };
      // 75 days remaining — between the 90 and 60 alertDays, matches neither.
      expect(computeExpiryActions(doc, RULE, "2026-08-06")).toEqual([{ kind: "none" }]);
    });
  });

  describe("Invariants", () => {
    it("result is always a non-empty array", () => {
      const cases: Array<[{ expiryDate: string | null; verificationStatus: string }, typeof RULE | null]> = [
        [{ expiryDate: null, verificationStatus: "Verified" }, RULE],
        [{ expiryDate: "2020-01-01", verificationStatus: "Archived" }, RULE],
        [{ expiryDate: "2026-09-05", verificationStatus: "Verified" }, null],
        [{ expiryDate: "2026-08-06", verificationStatus: "Verified" }, RULE],
      ];
      for (const [doc, rule] of cases) {
        expect(computeExpiryActions(doc, rule, "2026-08-06").length).toBeGreaterThan(0);
      }
    });
  });
});
