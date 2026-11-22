import { describe, it, expect, vi, beforeEach } from "vitest";

let mockSettings: Record<string, string> = {};
vi.mock("./settingsService.js", () => ({ getAllSettings: vi.fn(async () => mockSettings) }));

import { getMobileConfig } from "./featureFlagsService.js";

describe("getMobileConfig", () => {
  beforeEach(() => {
    mockSettings = {};
  });

  it("reports each module flag as a boolean, off unless the setting is exactly \"true\"", async () => {
    mockSettings = { compliance_enabled: "true", roster_enabled: "false", brain_enabled: "TRUE" };

    const { flags } = await getMobileConfig();

    expect(flags).toEqual({ compliance: true, roster: false, workforce: false, brain: false });
  });

  it("carries the minimum version, the store links and the languages", async () => {
    mockSettings = {
      mobile_min_app_version: "1.4.0",
      mobile_store_url_ios: "https://apps.apple.com/app/id1",
      mobile_store_url_android: "https://play.google.com/store/apps/details?id=x",
      mobile_languages_enabled: '["en","fr"]',
    };

    expect(await getMobileConfig()).toMatchObject({
      minVersion: "1.4.0",
      storeUrls: { ios: "https://apps.apple.com/app/id1", android: "https://play.google.com/store/apps/details?id=x" },
      languages_enabled: ["en", "fr"],
    });
  });

  it("defaults: no minimum, no store links (null, not an empty string), English only", async () => {
    expect(await getMobileConfig()).toEqual({
      flags: { compliance: false, roster: false, workforce: false, brain: false },
      minVersion: "0.0.0",
      storeUrls: { ios: null, android: null },
      languages_enabled: ["en"],
    });
  });

  it("never copies a setting it was not asked for", async () => {
    mockSettings = { stripe_secret: "sk_live_x", compliance_enabled: "true" };
    expect(JSON.stringify(await getMobileConfig())).not.toContain("sk_live_x");
  });
});
