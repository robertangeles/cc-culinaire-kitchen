import { describe, it, expect, vi } from "vitest";

const db = { getAllAsync: vi.fn(), execAsync: vi.fn(async () => {}) };
vi.mock("./db", () => ({ getDb: async () => db }));

import { wipeLocalData } from "./wipe";

describe("wipeLocalData", () => {
  it("empties every table the app keeps on the phone, including ones a later wave adds, but not the database's own", async () => {
    db.getAllAsync.mockResolvedValueOnce([{ name: "outbox" }, { name: "kv" }, { name: "waste_cache" }]);
    await wipeLocalData();
    expect(db.getAllAsync).toHaveBeenCalledWith(expect.stringContaining("name NOT LIKE 'sqlite_%'"));
    expect(db.execAsync).toHaveBeenCalledWith('DELETE FROM "outbox"; DELETE FROM "kv"; DELETE FROM "waste_cache";');
  });

  it("does nothing when there are no tables", async () => {
    db.execAsync.mockClear();
    db.getAllAsync.mockResolvedValueOnce([]);
    await wipeLocalData();
    expect(db.execAsync).not.toHaveBeenCalled();
  });
});
