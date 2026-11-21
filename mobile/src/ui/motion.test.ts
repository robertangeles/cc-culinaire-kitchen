import { describe, it, expect } from "vitest";
import { cardMotion, CARD_ADVANCE_MS } from "./motion";

describe("card motion", () => {
  it("is 180 ms ease-out by default", () => {
    expect(CARD_ADVANCE_MS).toBe(180);
    expect(cardMotion(false)).toEqual({ durationMs: 180 });
  });

  it("is instant when the phone asks to reduce motion", () => {
    expect(cardMotion(true)).toEqual({ durationMs: 0 });
  });
});
