import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────

const mockInsertValues = vi.fn();
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

vi.mock("../db/index.js", () => ({
  db: { insert: mockInsert },
}));

vi.mock("../db/schema.js", () => ({
  auditLog: { _: "audit_log" },
}));

beforeEach(() => {
  mockInsertValues.mockClear();
  mockInsert.mockClear();
});

// ── Tests ─────────────────────────────────────────────────────────────

describe("auditService.log", () => {
  it("writes a row with all required fields", async () => {
    const { log } = await import("./auditService.js");

    await log({
      entityType: "receiving_session",
      entityId: "session-uuid-1",
      action: "complete",
      actorUserId: 42,
      organisationId: 7,
      beforeValue: { status: "ACTIVE" },
      afterValue: { status: "COMPLETED" },
      metadata: { poId: "po-1", linesProcessed: 3 },
    });

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsertValues).toHaveBeenCalledWith({
      entityType: "receiving_session",
      entityId: "session-uuid-1",
      action: "complete",
      actorUserId: 42,
      organisationId: 7,
      beforeValue: { status: "ACTIVE" },
      afterValue: { status: "COMPLETED" },
      metadata: { poId: "po-1", linesProcessed: 3 },
    });
  });

  it("defaults nullable fields to null when omitted", async () => {
    const { log } = await import("./auditService.js");

    await log({
      entityType: "ingredient",
      entityId: "ing-1",
      action: "soft_delete",
    });

    expect(mockInsertValues).toHaveBeenCalledWith({
      entityType: "ingredient",
      entityId: "ing-1",
      action: "soft_delete",
      actorUserId: null,
      organisationId: null,
      beforeValue: null,
      afterValue: null,
      metadata: null,
    });
  });

  it("uses the provided tx instead of the default db when given one", async () => {
    const { log } = await import("./auditService.js");

    const txInsertValues = vi.fn();
    const tx = {
      insert: vi.fn(() => ({ values: txInsertValues })),
    };

    await log(
      {
        entityType: "receiving_session",
        entityId: "s-1",
        action: "create",
      },
      tx as never,
    );

    // Audit row commits via the tx, not the global db.
    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(txInsertValues).toHaveBeenCalledTimes(1);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
