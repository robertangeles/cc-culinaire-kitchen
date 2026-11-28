import { describe, it, expect } from "vitest";
import { expiryDateProblem, receivingText, receivingTextProblem } from "./receivingExtras.js";

const received = "2026-11-28T03:00:00.000Z";

describe("expiryDateProblem", () => {
  it.each(["2026-11-28", "2026-12-05", "2036-11-28"])("accepts %s for a delivery on 28 Nov 2026", (day) => {
    expect(expiryDateProblem(day, received)).toBeNull();
  });

  it("accepts the day before the UTC day, for a kitchen east of UTC", () => {
    expect(expiryDateProblem("2026-11-27", received)).toBeNull();
  });

  it.each(["2026-11-26", "2020-01-01"])("refuses %s, before the delivery day", (day) => {
    expect(expiryDateProblem(day, received)?.code).toBe("EXPIRY_DATE_OUT_OF_RANGE");
  });

  it("refuses a day more than ten years after the delivery", () => {
    expect(expiryDateProblem("2036-11-29", received)).toEqual({
      code: "EXPIRY_DATE_OUT_OF_RANGE",
      message: "The expiry date must be within 10 years of the delivery.",
    });
  });

  it.each(["2026-02-30", "2026-13-01", "28/11/2026", "2026-1-5", "", "2026-11-28T00:00:00Z"])("refuses %j, not a real day", (day) => {
    expect(expiryDateProblem(day, received)?.code).toBe("EXPIRY_DATE_INVALID");
  });
});

describe("lot and docket numbers", () => {
  it("accepts up to 50 characters once trimmed, and blank", () => {
    expect(receivingTextProblem("lot", `  ${"L".repeat(50)}  `)).toBeNull();
    expect(receivingTextProblem("docket", "")).toBeNull();
  });

  it("refuses longer, with the code for the field", () => {
    expect(receivingTextProblem("lot", "L".repeat(51))?.code).toBe("LOT_NUMBER_TOO_LONG");
    expect(receivingTextProblem("docket", "D".repeat(51))?.code).toBe("DOCKET_NUMBER_TOO_LONG");
  });

  it("stores the trimmed text, and null for blank", () => {
    expect(receivingText("  A-12 ")).toBe("A-12");
    expect(receivingText("   ")).toBeNull();
  });
});
