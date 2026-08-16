import { describe, it, expect } from "vitest";
import { decideFlagAction } from "./backfillFeatureFlags.js";

/**
 * Idempotency is the whole safety property of this script — it exists
 * specifically because getting compliance_enabled wrong takes down a live
 * feature, so the decision it makes has to be provably correct on every
 * possible starting state, not just the happy path.
 */
describe("decideFlagAction", () => {
  it("inserts when the row does not exist at all", () => {
    expect(decideFlagAction(undefined)).toEqual({ kind: "insert" });
  });

  it("does nothing when the row is already \"true\" (idempotent re-run)", () => {
    expect(decideFlagAction("true")).toEqual({ kind: "noop" });
  });

  it("corrects when the row exists but is \"false\" — the live-fire case this script exists for", () => {
    expect(decideFlagAction("false")).toEqual({ kind: "correct", from: "false" });
  });

  it("corrects any other stored value, not just the literal \"false\"", () => {
    expect(decideFlagAction("")).toEqual({ kind: "correct", from: "" });
    expect(decideFlagAction("0")).toEqual({ kind: "correct", from: "0" });
  });
});
