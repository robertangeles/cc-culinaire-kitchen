import { describe, it, expect } from "vitest";
import { canAssign, type HeldDocument, type AssignmentRequirement } from "./rosterAssignmentRules.js";

const TODAY = "2026-08-06";

function requirement(blockOnExpiry: boolean): AssignmentRequirement {
  return { documentType: "RSA", blockOnExpiry };
}

describe("Formula F-RA-01: canAssign", () => {
  describe("ten-case truth table — status x blockOnExpiry", () => {
    const VERIFIED_FUTURE: HeldDocument = { documentType: "RSA", verificationStatus: "Verified", expiryDate: "2027-01-01" };
    const VERIFIED_EXPIRED: HeldDocument = { documentType: "RSA", verificationStatus: "Verified", expiryDate: "2026-08-01" };
    const REJECTED: HeldDocument = { documentType: "RSA", verificationStatus: "Rejected", expiryDate: "2027-01-01" };
    const PENDING: HeldDocument = { documentType: "RSA", verificationStatus: "Pending", expiryDate: "2027-01-01" };

    it("ok + blockOnExpiry=true -> allowed", () => {
      expect(canAssign([VERIFIED_FUTURE], [requirement(true)], TODAY)).toEqual({ allowed: true });
    });
    it("ok + blockOnExpiry=false -> allowed", () => {
      expect(canAssign([VERIFIED_FUTURE], [requirement(false)], TODAY)).toEqual({ allowed: true });
    });

    it("missing + blockOnExpiry=true -> blocked, reason missing", () => {
      expect(canAssign([], [requirement(true)], TODAY)).toEqual({
        allowed: false,
        documentType: "RSA",
        reason: "missing",
        expiryDate: null,
      });
    });
    it("missing + blockOnExpiry=false -> allowed", () => {
      expect(canAssign([], [requirement(false)], TODAY)).toEqual({ allowed: true });
    });

    it("unverified (Pending) + blockOnExpiry=true -> blocked, reason unverified", () => {
      expect(canAssign([PENDING], [requirement(true)], TODAY)).toEqual({
        allowed: false,
        documentType: "RSA",
        reason: "unverified",
        expiryDate: "2027-01-01",
      });
    });
    it("unverified (Pending) + blockOnExpiry=false -> allowed", () => {
      expect(canAssign([PENDING], [requirement(false)], TODAY)).toEqual({ allowed: true });
    });

    it("rejected + blockOnExpiry=true -> blocked, reason rejected", () => {
      expect(canAssign([REJECTED], [requirement(true)], TODAY)).toEqual({
        allowed: false,
        documentType: "RSA",
        reason: "rejected",
        expiryDate: "2027-01-01",
      });
    });
    it("rejected + blockOnExpiry=false -> allowed", () => {
      expect(canAssign([REJECTED], [requirement(false)], TODAY)).toEqual({ allowed: true });
    });

    it("expired (Verified past expiryDate) + blockOnExpiry=true -> blocked, reason expired", () => {
      expect(canAssign([VERIFIED_EXPIRED], [requirement(true)], TODAY)).toEqual({
        allowed: false,
        documentType: "RSA",
        reason: "expired",
        expiryDate: "2026-08-01",
      });
    });
    it("expired (Verified past expiryDate) + blockOnExpiry=false -> allowed", () => {
      expect(canAssign([VERIFIED_EXPIRED], [requirement(false)], TODAY)).toEqual({ allowed: true });
    });
  });

  describe("expiry boundary", () => {
    it("expiryDate === today -> expired (not valid-until-end-of-day, matches computeExpiryActions)", () => {
      const doc: HeldDocument = { documentType: "RSA", verificationStatus: "Verified", expiryDate: TODAY };
      expect(canAssign([doc], [requirement(true)], TODAY)).toEqual({
        allowed: false,
        documentType: "RSA",
        reason: "expired",
        expiryDate: TODAY,
      });
    });

    it("null expiryDate never triggers 'expired' -> Verified alone is enough", () => {
      const doc: HeldDocument = { documentType: "RSA", verificationStatus: "Verified", expiryDate: null };
      expect(canAssign([doc], [requirement(true)], TODAY)).toEqual({ allowed: true });
    });
  });

  describe("multiple requirements", () => {
    it("no requirements -> always allowed", () => {
      expect(canAssign([], [], TODAY)).toEqual({ allowed: true });
    });

    it("all requirements satisfied -> allowed", () => {
      const held: HeldDocument[] = [
        { documentType: "RSA", verificationStatus: "Verified", expiryDate: "2027-01-01" },
        { documentType: "FSS", verificationStatus: "Verified", expiryDate: null },
      ];
      const requirements: AssignmentRequirement[] = [
        { documentType: "RSA", blockOnExpiry: true },
        { documentType: "FSS", blockOnExpiry: true },
      ];
      expect(canAssign(held, requirements, TODAY)).toEqual({ allowed: true });
    });

    it("stops at the first failing blocking requirement, in requirement order", () => {
      const held: HeldDocument[] = [
        { documentType: "FSS", verificationStatus: "Rejected", expiryDate: "2027-01-01" },
      ];
      const requirements: AssignmentRequirement[] = [
        { documentType: "RSA", blockOnExpiry: true }, // missing, blocks first
        { documentType: "FSS", blockOnExpiry: true }, // also fails, never reached
      ];
      expect(canAssign(held, requirements, TODAY)).toEqual({
        allowed: false,
        documentType: "RSA",
        reason: "missing",
        expiryDate: null,
      });
    });

    it("a non-blocking failure is skipped in favour of a later blocking one", () => {
      const held: HeldDocument[] = [];
      const requirements: AssignmentRequirement[] = [
        { documentType: "RSA", blockOnExpiry: false }, // missing, but not gating
        { documentType: "FSS", blockOnExpiry: true }, // missing, and gating
      ];
      expect(canAssign(held, requirements, TODAY)).toEqual({
        allowed: false,
        documentType: "FSS",
        reason: "missing",
        expiryDate: null,
      });
    });
  });
});
