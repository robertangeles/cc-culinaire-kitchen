import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for recordMemory's contract (docs/specs/brain-memory.md E2/T10):
 * it must NEVER reject — a Brain failure can never break the caller. The db
 * module is mocked so the DB-failure path is exercised deterministically.
 */

// Controlled settings — flags on by default so the insert path is reached.
let mockSettings: Record<string, string> = {};
vi.mock("./settingsService.js", () => ({
  getAllSettings: vi.fn(async () => mockSettings),
}));

// Controlled db.insert chain — flips between success and hard failure.
let insertShouldThrow = false;
const insertValues = vi.fn(() => ({
  onConflictDoUpdate: vi.fn(async () => {
    if (insertShouldThrow) throw new Error("connection refused");
  }),
}));
vi.mock("../db/index.js", () => ({
  db: { insert: vi.fn(() => ({ values: insertValues })) },
}));

describe("brainCaptureService — recordMemory (never rejects, spec E2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertShouldThrow = false;
    mockSettings = { brain_enabled: "true", brain_capture_enabled: "true" };
  });

  it("resolves void on the happy path and bumps the recorded counter", async () => {
    const { recordMemory, getCaptureCounters } = await import("./brainCaptureService.js");
    const before = getCaptureCounters().recorded;

    await expect(
      recordMemory({ userId: 7, sourceType: "chat", rawContent: "sear scallops dry" }),
    ).resolves.toBeUndefined();

    expect(getCaptureCounters().recorded).toBe(before + 1);
    expect(insertValues).toHaveBeenCalledTimes(1);
  });

  it("RESOLVES (never rejects) when the DB insert throws, and bumps the error counter", async () => {
    insertShouldThrow = true;
    const { recordMemory, getCaptureCounters } = await import("./brainCaptureService.js");
    const before = getCaptureCounters().errors;

    await expect(
      recordMemory({ userId: 7, sourceType: "chat", rawContent: "anything" }),
    ).resolves.toBeUndefined();

    expect(getCaptureCounters().errors).toBe(before + 1);
  });

  it("never records for guests (userId <= 0) — no DB touch", async () => {
    const { recordMemory } = await import("./brainCaptureService.js");
    await recordMemory({ userId: 0, sourceType: "chat", rawContent: "guest turn" });
    await recordMemory({ userId: -1, sourceType: "chat", rawContent: "guest turn" });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("is inert while the capture flags are off", async () => {
    mockSettings = { brain_enabled: "true", brain_capture_enabled: "false" };
    const { recordMemory } = await import("./brainCaptureService.js");
    await recordMemory({ userId: 7, sourceType: "chat", rawContent: "flagged off" });
    expect(insertValues).not.toHaveBeenCalled();

    mockSettings = { brain_enabled: "false", brain_capture_enabled: "true" };
    await recordMemory({ userId: 7, sourceType: "chat", rawContent: "flagged off" });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("skips when sanitisation empties the content", async () => {
    const { recordMemory } = await import("./brainCaptureService.js");
    await recordMemory({ userId: 7, sourceType: "chat", rawContent: "<><><>" });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("resolves even if the settings load itself fails", async () => {
    const { getAllSettings } = await import("./settingsService.js");
    vi.mocked(getAllSettings).mockRejectedValueOnce(new Error("settings table down"));
    const { recordMemory } = await import("./brainCaptureService.js");

    await expect(
      recordMemory({ userId: 7, sourceType: "chat", rawContent: "anything" }),
    ).resolves.toBeUndefined();
  });
});
