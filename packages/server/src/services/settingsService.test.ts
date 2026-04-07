import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockWhere = vi.fn();

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({ from: mockFrom }),
    insert: () => ({ values: mockValues }),
    update: () => ({ set: () => ({ where: mockWhere }) }),
  },
}));

vi.mock("../db/schema.js", () => ({
  siteSetting: {
    settingId: "setting_id",
    settingKey: "setting_key",
    settingValue: "setting_value",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ field: a, value: b })),
}));

// We need to re-import each test to reset the cache
describe("settingsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module to clear the in-memory cache
    vi.resetModules();
  });

  it("getAllSettings fetches from DB and returns key-value map", async () => {
    mockFrom.mockResolvedValue([
      { settingKey: "page_title", settingValue: "Test Kitchen" },
      { settingKey: "logo_path", settingValue: "/uploads/logo.png" },
    ]);

    const { getAllSettings } = await import("./settingsService.js");
    const result = await getAllSettings();

    // DB values override defaults; defaults fill in the rest
    expect(result).toMatchObject({
      page_title: "Test Kitchen",
      logo_path: "/uploads/logo.png",
    });
    // Verify defaults are merged in
    expect(result.web_search_model).toBe("perplexity/sonar-pro");
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });

  it("getAllSettings uses cache on second call", async () => {
    mockFrom.mockResolvedValue([
      { settingKey: "page_title", settingValue: "Test Kitchen" },
    ]);

    const { getAllSettings } = await import("./settingsService.js");

    await getAllSettings();
    await getAllSettings();

    // DB should only be queried once
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });
});
