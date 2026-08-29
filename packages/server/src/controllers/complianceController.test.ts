import { describe, it, expect } from "vitest";
import { mimeToStorageFormat, shouldRunOcr } from "./complianceController.js";

describe("mimeToStorageFormat", () => {
  it("a stored JPEG resolves to a jpg download format, not the pdf every document used to get", () => {
    expect(mimeToStorageFormat("image/jpeg")).toBe("jpg");
    expect(mimeToStorageFormat("image/jpeg")).not.toBe("pdf");
  });
});

describe("shouldRunOcr", () => {
  it("refuses a PDF — tesseract.js cannot decode one, and trying hung the whole server", () => {
    expect(shouldRunOcr("application/pdf")).toBe(false);
  });

  it("allows a JPEG", () => {
    expect(shouldRunOcr("image/jpeg")).toBe(true);
  });

  it("allows a PNG", () => {
    expect(shouldRunOcr("image/png")).toBe(true);
  });
});
