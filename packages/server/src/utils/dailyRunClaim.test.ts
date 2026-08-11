import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module (settingsService.test.ts's style). dailyRunClaim's real
// implementations of claimDailyRun/releaseDailyRun run underneath runIfClaimed
// here — they live in the same module, so there is nothing to spy on directly —
// only the db calls they make can be controlled.
const mockOnConflictDoNothing = vi.fn().mockResolvedValue(undefined);
const mockValues = vi.fn(() => ({ onConflictDoNothing: mockOnConflictDoNothing }));
const mockReturning = vi.fn().mockResolvedValue([]); // default: claim lost (no rows updated)
const mockWhere = vi.fn(() => ({ returning: mockReturning }));
const mockSet = vi.fn(() => ({ where: mockWhere }));
const mockFrom = vi.fn().mockResolvedValue([]);

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({ from: mockFrom }),
    insert: () => ({ values: mockValues }),
    update: () => ({ set: mockSet }),
  },
}));

vi.mock("../db/schema.js", () => ({
  siteSetting: {
    settingId: "setting_id",
    settingKey: "setting_key",
    settingValue: "setting_value",
    updatedDttm: "updated_dttm",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ op: "eq", a, b })),
  ne: vi.fn((a, b) => ({ op: "ne", a, b })),
  and: vi.fn((...args) => ({ op: "and", args })),
}));

import { dayKey, dayHourKey, dailyRunKey, runIfClaimed } from "./dailyRunClaim.js";

function fakeLogger() {
  return { error: vi.fn() };
}

describe("dayKey", () => {
  it("pads month and day", () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(dayKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("dayHourKey", () => {
  it("appends the zero-padded hour", () => {
    expect(dayHourKey(new Date(2026, 0, 5, 0))).toBe("2026-01-05-00");
    expect(dayHourKey(new Date(2026, 0, 5, 9))).toBe("2026-01-05-09");
  });
});

describe("dailyRunKey", () => {
  it("namespaces as job_last_run:<job>", () => {
    expect(dailyRunKey("waste-digest")).toBe("job_last_run:waste-digest");
  });
});

describe("runIfClaimed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOnConflictDoNothing.mockResolvedValue(undefined);
    mockReturning.mockResolvedValue([]);
  });

  it("due() false: returns false, claim never attempted, run never called", async () => {
    const due = vi.fn().mockReturnValue(false);
    const run = vi.fn();
    const log = fakeLogger();

    const result = await runIfClaimed({
      job: "job-a",
      due,
      period: () => "2026-01-05",
      run,
      log,
      now: () => new Date(2026, 0, 5),
    });

    expect(result).toBe(false);
    expect(mockValues).not.toHaveBeenCalled(); // ensureRow (part of claim) never ran
    expect(mockSet).not.toHaveBeenCalled(); // the conditional UPDATE never ran
    expect(run).not.toHaveBeenCalled();
  });

  it("due() true + claim wins: runs the work and returns true", async () => {
    mockReturning.mockResolvedValueOnce([{ settingId: 1 }]); // UPDATE ... RETURNING one row

    const due = vi.fn().mockReturnValue(true);
    const run = vi.fn().mockResolvedValue(undefined);
    const log = fakeLogger();

    const result = await runIfClaimed({
      job: "job-a",
      due,
      period: () => "2026-01-05",
      run,
      log,
      now: () => new Date(2026, 0, 5),
    });

    expect(result).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("due() true + claim lost: run not called, returns false", async () => {
    // mockReturning defaults to [] in beforeEach: no rows updated == claim lost.
    const due = vi.fn().mockReturnValue(true);
    const run = vi.fn();
    const log = fakeLogger();

    const result = await runIfClaimed({
      job: "job-a",
      due,
      period: () => "2026-01-05",
      run,
      log,
      now: () => new Date(2026, 0, 5),
    });

    expect(result).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("run() throws: returns false, releaseDailyRun IS called, error logged, does not rethrow", async () => {
    mockReturning.mockResolvedValueOnce([{ settingId: 1 }]); // claim wins

    const due = vi.fn().mockReturnValue(true);
    const run = vi.fn().mockRejectedValue(new Error("run boom"));
    const log = fakeLogger();

    const result = await runIfClaimed({
      job: "job-a",
      due,
      period: () => "2026-01-05",
      run,
      log,
      now: () => new Date(2026, 0, 5),
    });

    expect(result).toBe(false);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), job: "job-a" }),
      expect.stringContaining("job-a"),
    );
    // Claim's UPDATE, then release's UPDATE — release reset the value to "".
    expect(mockSet).toHaveBeenCalledTimes(2);
    expect(mockSet).toHaveBeenLastCalledWith(expect.objectContaining({ settingValue: "" }));
  });

  it("claimDailyRun() throws: returns false, run not called, does not rethrow", async () => {
    mockOnConflictDoNothing.mockRejectedValueOnce(new Error("db down")); // ensureRow fails inside claimDailyRun

    const due = vi.fn().mockReturnValue(true);
    const run = vi.fn();
    const log = fakeLogger();

    const result = await runIfClaimed({
      job: "job-a",
      due,
      period: () => "2026-01-05",
      run,
      log,
      now: () => new Date(2026, 0, 5),
    });

    expect(result).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled(); // never got past the failed claim to the UPDATE
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), job: "job-a" }),
      expect.stringContaining("job-a"),
    );
  });

  it("release() also throws: still returns false, does not rethrow, both errors logged", async () => {
    mockReturning.mockResolvedValueOnce([{ settingId: 1 }]); // claim's UPDATE wins
    mockWhere.mockImplementationOnce(() => ({ returning: mockReturning })); // 1st where() call: claim
    mockWhere.mockImplementationOnce(() => {
      throw new Error("release boom"); // 2nd where() call: release
    });

    const due = vi.fn().mockReturnValue(true);
    const run = vi.fn().mockRejectedValue(new Error("run boom"));
    const log = fakeLogger();

    const result = await runIfClaimed({
      job: "job-a",
      due,
      period: () => "2026-01-05",
      run,
      log,
      now: () => new Date(2026, 0, 5),
    });

    expect(result).toBe(false);
    expect(log.error).toHaveBeenCalledTimes(2);
  });
});
