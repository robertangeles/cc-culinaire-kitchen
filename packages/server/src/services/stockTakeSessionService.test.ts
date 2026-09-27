import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConflictError, InvalidStateError, NotFoundError, ValidationError } from "./stockTakeErrors.js";

vi.mock("../db/index.js", () => {
  const tx = {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  };
  return {
    db: {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      transaction: vi.fn().mockImplementation((cb: (tx: typeof tx) => Promise<unknown>) => cb(tx)),
    },
  };
});

vi.mock("./brainCaptureService.js", () => ({
  recordOpsEvent: vi.fn().mockResolvedValue(undefined),
}));

const { db } = await import("../db/index.js");
const { openSession, openOpeningCount, submitSessionForReview, approveSession, flagSession } = await import("./stockTakeSessionService.js");

beforeEach(() => {
  vi.clearAllMocks();
});

function mockSelectOnce(rows: unknown[]) {
  (db.select as ReturnType<typeof vi.fn>).mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

describe("openSession", () => {
  it("throws ConflictError when an active session exists", async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ sessionId: "existing" }]),
      }),
    });
    await expect(openSession("loc1", 1, 1)).rejects.toThrow(ConflictError);
  });

  it("throws ValidationError when inventoryActive is false (opening count not complete)", async () => {
    // First select: no active session
    mockSelectOnce([]);
    // Second select: location with inventoryActive=false
    mockSelectOnce([{ inventoryActive: false }]);
    await expect(openSession("loc1", 1, 1)).rejects.toThrow(ValidationError);
  });

  it("throws NotFoundError when location does not belong to org", async () => {
    // First select: no active session
    mockSelectOnce([]);
    // Second select: location not found (wrong org)
    mockSelectOnce([]);
    await expect(openSession("loc1", 99, 1)).rejects.toThrow(NotFoundError);
  });
});

describe("openOpeningCount", () => {
  it("throws NotFoundError when location not found (cross-org guard)", async () => {
    // First select: org-scope check — location not found
    mockSelectOnce([]);
    await expect(openOpeningCount("loc1", 99, 1)).rejects.toThrow(NotFoundError);
  });

  it("throws ConflictError when an APPROVED OPENING session already exists", async () => {
    // First select: org-scope check — location found
    mockSelectOnce([{ storeLocationId: "loc1" }]);
    // Second select: existing OPENING sessions — APPROVED
    mockSelectOnce([{ sessionId: "s1", sessionStatus: "APPROVED" }]);
    await expect(openOpeningCount("loc1", 1, 1)).rejects.toThrow(ConflictError);
  });

  it("throws ConflictError when an in-progress OPENING session exists", async () => {
    // First select: org-scope check — location found
    mockSelectOnce([{ storeLocationId: "loc1" }]);
    // Second select: existing OPENING sessions — OPEN (in-progress)
    mockSelectOnce([{ sessionId: "s2", sessionStatus: "OPEN" }]);
    await expect(openOpeningCount("loc1", 1, 1)).rejects.toThrow(ConflictError);
  });

  it("throws ValidationError when location has no active items", async () => {
    // First select: org-scope check — location found
    mockSelectOnce([{ storeLocationId: "loc1" }]);
    // Second select: existing OPENING sessions — empty (none exist)
    mockSelectOnce([]);
    // Third select: active items — empty (no active catalogue items)
    (db.select as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    await expect(openOpeningCount("loc1", 1, 1)).rejects.toThrow(ValidationError);
  });

  it("throws ConflictError when an active regular session exists", async () => {
    // First select: org-scope check — location found
    mockSelectOnce([{ storeLocationId: "loc1" }]);
    // Second select: existing OPENING sessions — empty
    mockSelectOnce([]);
    // Third select: active items found
    (db.select as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ ingredientId: "i1", category: "proteins" }]),
        }),
      }),
    });
    // Fourth select: active regular session found
    mockSelectOnce([{ sessionId: "s-regular" }]);
    await expect(openOpeningCount("loc1", 1, 1)).rejects.toThrow(ConflictError);
  });
});

describe("submitSessionForReview", () => {
  it("throws NotFoundError when session does not exist", async () => {
    mockSelectOnce([]);
    await expect(submitSessionForReview("s1", 1)).rejects.toThrow(NotFoundError);
  });

  it("throws InvalidStateError when session is already PENDING_REVIEW", async () => {
    mockSelectOnce([{ sessionId: "s1", sessionStatus: "PENDING_REVIEW", organisationId: 1 }]);
    await expect(submitSessionForReview("s1", 1)).rejects.toThrow(InvalidStateError);
  });

  it("throws ValidationError when no categories are submitted", async () => {
    // First select: session (OPEN)
    mockSelectOnce([{ sessionId: "s1", sessionStatus: "OPEN", sessionType: "REGULAR", organisationId: 1 }]);
    // Second select: categories — all NOT_STARTED, none SUBMITTED
    mockSelectOnce([{ categoryId: "c1", categoryStatus: "NOT_STARTED" }]);
    await expect(submitSessionForReview("s1", 1)).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError when categories are still IN_PROGRESS", async () => {
    // First select: session (OPEN)
    mockSelectOnce([{ sessionId: "s1", sessionStatus: "OPEN", sessionType: "REGULAR", organisationId: 1 }]);
    // Second select: one SUBMITTED (passes the "at least one" check), one IN_PROGRESS (blocks)
    mockSelectOnce([
      { categoryId: "c1", categoryStatus: "SUBMITTED" },
      { categoryId: "c2", categoryStatus: "IN_PROGRESS" },
    ]);
    await expect(submitSessionForReview("s1", 1)).rejects.toThrow(ValidationError);
  });
});

describe("approveSession", () => {
  it("throws NotFoundError when session does not exist", async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });
    await expect(approveSession("s1", 1, 1)).rejects.toThrow(NotFoundError);
  });

  it("returns session idempotently when already APPROVED", async () => {
    const session = { sessionId: "s1", sessionStatus: "APPROVED", organisationId: 1 };
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([session]),
      }),
    });
    const result = await approveSession("s1", 1, 1);
    expect(result).toEqual(session);
  });

  it("throws InvalidStateError when session is not PENDING_REVIEW", async () => {
    const session = { sessionId: "s1", sessionStatus: "OPEN", organisationId: 1 };
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([session]),
      }),
    });
    await expect(approveSession("s1", 1, 1)).rejects.toThrow(InvalidStateError);
  });
});

describe("flagSession", () => {
  it("throws NotFoundError when session does not exist", async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    await expect(flagSession("s1", ["proteins"], "reason", 1)).rejects.toThrow(NotFoundError);
  });

  it("throws InvalidStateError when session is not PENDING_REVIEW", async () => {
    const session = { sessionId: "s1", sessionStatus: "OPEN", organisationId: 1 };
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([session]),
      }),
    });
    await expect(flagSession("s1", ["proteins"], "reason", 1)).rejects.toThrow(InvalidStateError);
  });

  it("throws ValidationError when no categories flagged", async () => {
    const session = { sessionId: "s1", sessionStatus: "PENDING_REVIEW", organisationId: 1 };
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([session]),
      }),
    });
    await expect(flagSession("s1", [], "reason", 1)).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError when a flagged category name is not in the session", async () => {
    // First select: session (PENDING_REVIEW)
    mockSelectOnce([{ sessionId: "s1", sessionStatus: "PENDING_REVIEW", organisationId: 1 }]);
    // Second select: session categories — only "dairy" exists, not "proteins"
    mockSelectOnce([{ categoryName: "dairy" }]);
    await expect(flagSession("s1", ["proteins"], "reason", 1)).rejects.toThrow(ValidationError);
  });
});
