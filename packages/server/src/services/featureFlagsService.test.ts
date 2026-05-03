import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./settingsService.js", () => ({
  getAllSettings: vi.fn(),
}));

import { getMobileFeatureFlags, __test } from "./featureFlagsService.js";
import { getAllSettings } from "./settingsService.js";

const mockGetAll = getAllSettings as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("parseLanguagesEnabled — fallbacks", () => {
  it("returns ['en'] when the setting is undefined", () => {
    expect(__test.parseLanguagesEnabled(undefined)).toEqual(["en"]);
  });
  it("returns ['en'] when the setting is empty string", () => {
    expect(__test.parseLanguagesEnabled("")).toEqual(["en"]);
  });
  it("returns ['en'] when the setting is invalid JSON", () => {
    expect(__test.parseLanguagesEnabled("not[json")).toEqual(["en"]);
  });
  it("returns ['en'] when the parsed value is not an array", () => {
    expect(__test.parseLanguagesEnabled('"en"')).toEqual(["en"]);
  });
  it("returns ['en'] when the parsed array is empty", () => {
    expect(__test.parseLanguagesEnabled("[]")).toEqual(["en"]);
  });
  it("filters out non-string elements", () => {
    expect(__test.parseLanguagesEnabled('["en", 42, null, "fr"]')).toEqual(["en", "fr"]);
  });
  it("filters out malformed locale strings", () => {
    // Only short lowercase locale-shaped tokens survive — blocks attempts to
    // smuggle long arbitrary strings into the response.
    expect(__test.parseLanguagesEnabled('["en", "EN", "fr-FR", "x", "fr"]')).toEqual(["en", "fr"]);
  });
});

describe("getMobileFeatureFlags — service integration", () => {
  it("returns languages_enabled from the site_setting", async () => {
    mockGetAll.mockResolvedValueOnce({
      mobile_languages_enabled: '["en", "fr"]',
    } as Record<string, string>);
    const flags = await getMobileFeatureFlags();
    expect(flags).toEqual({ languages_enabled: ["en", "fr"] });
  });

  it("falls back to ['en'] when the setting row is missing", async () => {
    mockGetAll.mockResolvedValueOnce({} as Record<string, string>);
    const flags = await getMobileFeatureFlags();
    expect(flags).toEqual({ languages_enabled: ["en"] });
  });

  it("falls back to ['en'] when the stored value is corrupted", async () => {
    mockGetAll.mockResolvedValueOnce({
      mobile_languages_enabled: "{bad json",
    } as Record<string, string>);
    const flags = await getMobileFeatureFlags();
    expect(flags).toEqual({ languages_enabled: ["en"] });
  });
});
