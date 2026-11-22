import { describe, it, expect } from "vitest";
import { validateTransition, PO_TRANSITIONS } from "./stateTransition.js";
import { AppError } from "./appError.js";

describe("validateTransition", () => {
  it("allows a legal transition", () => {
    expect(() => validateTransition("DRAFT", "SENT", PO_TRANSITIONS, "purchase order")).not.toThrow();
  });

  it("answers an illegal transition as 409 INVALID_STATE, not an unmapped 500", () => {
    const run = () => validateTransition("CANCELLED", "SENT", PO_TRANSITIONS, "purchase order");
    expect(run).toThrow(AppError);
    try {
      run();
    } catch (err) {
      expect(err).toMatchObject({
        statusCode: 409,
        code: "INVALID_STATE",
        message: "Cannot transition purchase order from CANCELLED to SENT",
      });
    }
  });
});
