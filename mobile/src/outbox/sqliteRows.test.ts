import { describe, it, expect } from "vitest";
import { fromRow, toRow } from "./sqliteRows";
import type { OutboxEntry } from "./outbox";

const base: OutboxEntry = {
  id: "a",
  userId: 7,
  status: "SAVED_LOCAL",
  command: { sessionId: "S", categoryName: "Bar", ingredientId: "i", ingredientName: "Shiraz", rawQty: 2.5, countedUnit: "kg", claimRevision: 3 },
  attempts: 2,
  nextAttemptAt: 99,
  createdAt: 1,
  updatedAt: 2,
};

describe("outbox row mapping", () => {
  it("round-trips an entry without an attention note", () => {
    expect(fromRow(toRow(base))).toEqual(base);
    expect(toRow(base)).toMatchObject({ attention_reason: null, attention_message: null });
  });

  it("round-trips a stuck entry with its reason and the server's message", () => {
    const stuck: OutboxEntry = { ...base, status: "NEEDS_ATTENTION", attention: { reason: "claim_changed", message: "recount under the current claim" } };
    expect(fromRow(toRow(stuck))).toEqual(stuck);
  });
});
