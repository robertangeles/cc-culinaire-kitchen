import { describe, it, expect } from "vitest";
import { validateSettingsUpdate } from "./settingsService.js";

describe("validateSettingsUpdate", () => {
  it("accepts an update with no phone version, and valid x.y.z versions", () => {
    expect(validateSettingsUpdate({ page_title: "Hi" })).toBeNull();
    expect(validateSettingsUpdate({ mobile_min_app_version: "0.0.0" })).toBeNull();
    expect(validateSettingsUpdate({ mobile_min_app_version: "12.3.45" })).toBeNull();
  });

  it.each(["", "1.2", "v1.2.3", "banana", "1.2.3-beta"])("explains a minimum version of %j", (v) => {
    expect(validateSettingsUpdate({ mobile_min_app_version: v })).toBe("The minimum phone app version must look like 1.2.3 (0.0.0 allows every version).");
  });
});
