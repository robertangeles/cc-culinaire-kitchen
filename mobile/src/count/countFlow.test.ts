import { describe, it, expect } from "vitest";
import { buildAnswers, reviewRows, submitCheck, firstUncounted, progress, summarizeArea, type SheetItem } from "./countFlow";
import type { OutboxEntry } from "../outbox/outbox";

const items: SheetItem[] = [
  { ingredientId: "i1", ingredientName: "Shiraz", countUnit: "kg", alsoIn: ["Stock Room"] },
  { ingredientId: "i2", ingredientName: "Gin", countUnit: "kg", alsoIn: [] },
  { ingredientId: "i3", ingredientName: "Rum", countUnit: "kg", alsoIn: [] },
];

function entry(over: Partial<OutboxEntry> & { ingredientId: string; rawQty?: number }): OutboxEntry {
  const { ingredientId, rawQty = 1, ...rest } = over;
  return {
    id: `e-${ingredientId}`,
    userId: 1,
    status: "SAVED_LOCAL",
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: 1,
    updatedAt: 1,
    command: { sessionId: "S", categoryName: "Bar", ingredientId, ingredientName: ingredientId, rawQty, countedUnit: "kg", claimRevision: 1 },
    ...rest,
  };
}

describe("answers and their save state", () => {
  it("a line already on the server reads as Accepted", () => {
    const a = buildAnswers([{ ingredientId: "i2", rawQty: 4, countedUnit: "kg" }], []);
    expect(a.get("i2")).toEqual({ rawQty: 4, countedUnit: "kg", saveState: "accepted" });
  });

  it("a queued count shows its stage: Saved on this phone, Waiting to send, Accepted", () => {
    const a = buildAnswers([], [entry({ ingredientId: "i1", status: "SAVED_LOCAL" }), entry({ ingredientId: "i2", status: "SENDING" }), entry({ ingredientId: "i3", status: "ACCEPTED" })]);
    expect([a.get("i1")?.saveState, a.get("i2")?.saveState, a.get("i3")?.saveState]).toEqual(["saved_on_phone", "waiting_to_send", "accepted"]);
  });

  it("the phone's own number beats the server's older one for the same item", () => {
    const a = buildAnswers([{ ingredientId: "i1", rawQty: 3, countedUnit: "kg" }], [entry({ ingredientId: "i1", rawQty: 8 })]);
    expect(a.get("i1")).toMatchObject({ rawQty: 8, saveState: "saved_on_phone" });
  });

  it("a stuck count shows needs-attention with the server's message and keeps the number the chef typed", () => {
    const a = buildAnswers([], [entry({ ingredientId: "i1", rawQty: 6, status: "NEEDS_ATTENTION", attention: { reason: "claim_changed", message: "recount" } })]);
    expect(a.get("i1")).toEqual({ rawQty: 6, countedUnit: "kg", saveState: "needs_attention", attention: { reason: "claim_changed", message: "recount" }, entryId: "e-i1" });
  });

  it("a discarded count is gone from the screen and the server's line shows again", () => {
    const a = buildAnswers([{ ingredientId: "i1", rawQty: 3, countedUnit: "kg" }], [entry({ ingredientId: "i1", rawQty: 8, status: "DISCARDED" })]);
    expect(a.get("i1")).toMatchObject({ rawQty: 3, saveState: "accepted" });
  });
});

describe("review list at the end of an area (D14)", () => {
  it("tells counted, not counted, a shared item with no count, and needs-attention apart", () => {
    const answers = buildAnswers([{ ingredientId: "i2", rawQty: 4, countedUnit: "kg" }], [entry({ ingredientId: "i3", status: "NEEDS_ATTENTION", attention: { reason: "rejected", message: "x" } })]);
    expect(reviewRows(items, answers).map((r) => [r.name, r.kind])).toEqual([
      ["Shiraz", "shared_gap"], // shared with Stock Room and not counted here
      ["Gin", "counted"],
      ["Rum", "needs_attention"],
    ]);
  });

  it("a plain item left blank is simply not counted, which is allowed", () => {
    expect(reviewRows([items[1]], new Map())[0].kind).toBe("not_counted");
  });

  it("a deliberate zero on a shared item closes its gap", () => {
    const answers = buildAnswers([{ ingredientId: "i1", rawQty: 0, countedUnit: "kg" }], []);
    expect(reviewRows([items[0]], answers)[0].kind).toBe("counted");
  });
});

describe("what blocks submitting", () => {
  it("is clear only when every shared item has a count and every count has reached the server", () => {
    const ok = reviewRows(items, buildAnswers([{ ingredientId: "i1", rawQty: 0, countedUnit: "kg" }, { ingredientId: "i2", rawQty: 4, countedUnit: "kg" }], []));
    expect(submitCheck(ok)).toEqual({ ok: true, gaps: 0, needsAttention: 0, waiting: 0 });
  });

  it("counts the gaps, stuck counts and counts still waiting to send", () => {
    const answers = buildAnswers([], [entry({ ingredientId: "i2", status: "SAVED_LOCAL" }), entry({ ingredientId: "i3", status: "NEEDS_ATTENTION", attention: { reason: "rejected", message: "x" } })]);
    expect(submitCheck(reviewRows(items, answers))).toEqual({ ok: false, gaps: 1, needsAttention: 1, waiting: 1 });
  });
});

describe("walking the sheet", () => {
  it("starts at the first uncounted item and reports progress", () => {
    const answers = buildAnswers([{ ingredientId: "i1", rawQty: 1, countedUnit: "kg" }], []);
    expect(firstUncounted(items, answers)).toBe(1);
    expect(progress(items, answers)).toEqual({ counted: 1, total: 3 });
  });

  it("returns 0 when nothing is counted and -1 when everything is", () => {
    expect(firstUncounted(items, new Map())).toBe(0);
    const all = buildAnswers(items.map((i) => ({ ingredientId: i.ingredientId, rawQty: 1, countedUnit: "kg" })), []);
    expect(firstUncounted(items, all)).toBe(-1);
  });
});

describe("area summary for the areas list", () => {
  const category = { categoryName: "Bar", categoryStatus: "IN_PROGRESS", claimedByUserId: 1, claimedByUserName: "Chef" };
  it("shows progress, the needs-attention count and which areas share items", () => {
    const answers = buildAnswers([{ ingredientId: "i2", rawQty: 4, countedUnit: "kg" }], [entry({ ingredientId: "i3", status: "NEEDS_ATTENTION", attention: { reason: "rejected", message: "x" } })]);
    expect(summarizeArea({ items, category, answers, currentUserId: 1 })).toEqual({
      name: "Bar",
      status: "IN_PROGRESS",
      counted: 1,
      total: 3,
      needsAttention: 1,
      sharesWith: ["Stock Room"],
      heldBy: null,
    });
  });

  it("names who holds an area someone else claimed", () => {
    const s = summarizeArea({ items, category: { ...category, claimedByUserId: 2, claimedByUserName: "Sam" }, answers: new Map(), currentUserId: 1 });
    expect(s.heldBy).toBe("Sam");
  });
});
