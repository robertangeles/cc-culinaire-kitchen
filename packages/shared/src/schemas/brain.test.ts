import { describe, expect, it } from "vitest";
import { MemoryPageSchema, NudgeOptInSchema } from "./brain";

const row = { memoryId: "m1", title: null, body: "Salt the fish overnight", sourceType: "chat", scope: "user", isPinned: false, status: "ready", createdDttm: "2026-11-24T10:00:00Z", canManage: true, authorName: null };

describe("Your Brain schemas", () => {
  it("reads a page of memories and ignores fields it does not know", () => {
    expect(MemoryPageSchema.parse({ memories: [{ ...row, embedding: [1, 2] }], total: 1, more: "x" })).toEqual({ memories: [row], total: 1 });
  });

  it("leaves out a row it cannot read instead of losing the list", () => {
    expect(MemoryPageSchema.parse({ memories: [{ body: "no id" }, row], total: 2 }).memories.map((m) => m.memoryId)).toEqual(["m1"]);
  });

  // A scope or status this version does not know must never be read as "shared" or as manageable.
  it("falls back to the safe reading of an unknown value", () => {
    expect(MemoryPageSchema.parse({ memories: [{ memoryId: "m2", body: "x", scope: "galaxy", canManage: "yes" }], total: 1 }).memories[0]).toEqual({
      memoryId: "m2", title: null, body: "x", sourceType: "", scope: "user", isPinned: false, status: "ready", createdDttm: "", canManage: false, authorName: null,
    });
  });

  it("needs a real yes or no for the nudges switch", () => {
    expect(NudgeOptInSchema.parse({ optIn: true })).toEqual({ optIn: true });
    expect(NudgeOptInSchema.safeParse({}).success).toBe(false);
  });
});
