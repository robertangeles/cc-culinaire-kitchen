import { describe, it, expect } from "vitest";
import { attentionCopy, describeCount } from "./attentionCopy";
import type { AttentionReason } from "../outbox/outbox";

describe("needs-attention copy", () => {
  it.each<[AttentionReason, string[]]>([
    ["area_closed", ["discard"]],
    ["not_yours", ["discard"]],
    ["claim_changed", ["enter_again", "discard"]],
    ["signed_out", ["sign_in", "discard"]],
    ["no_access", ["discard"]],
    ["rejected", ["enter_again", "discard"]],
  ])("%s offers only actions that can work", (reason, actions) => {
    expect(attentionCopy(reason, "").actions).toEqual(actions);
    expect(attentionCopy(reason, "").sentence.length).toBeGreaterThan(10);
  });

  it("shows the server's own words for a rejected count", () => {
    expect(attentionCopy("rejected", "Quantity cannot exceed 99,999").sentence).toBe("Quantity cannot exceed 99,999");
  });

  it("names the item and quantity in the discard confirmation", () => {
    expect(describeCount("Shiraz", { rawQty: 6, countedUnit: "kg" })).toBe("6 kg of Shiraz");
  });
});
