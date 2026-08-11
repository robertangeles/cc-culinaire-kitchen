import { describe, it, expect } from "vitest";
import { mimeToStorageFormat } from "./complianceController.js";

describe("mimeToStorageFormat", () => {
  it("a stored JPEG resolves to a jpg download format, not the pdf every document used to get", () => {
    expect(mimeToStorageFormat("image/jpeg")).toBe("jpg");
    expect(mimeToStorageFormat("image/jpeg")).not.toBe("pdf");
  });
});
