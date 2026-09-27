import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConflictError, InvalidStateError, NotFoundError } from "./stockTakeErrors.js";

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
const { openSession, approveSession, flagSession } = await import("./stockTakeSessionService.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("openSession", () => {
  it("throws ConflictError when an active session exists", async () => {
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ sessionId: "existing" }]),
      }),
    });
    await expect(openSession("loc1", 1, 1)).rejects.toThrow(ConflictError);
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
    await expect(flagSession("s1", 1, [], "reason")).rejects.toThrow(NotFoundError);
  });

  it("throws InvalidStateError when session is not PENDING_REVIEW", async () => {
    const session = { sessionId: "s1", sessionStatus: "OPEN", organisationId: 1 };
    (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([session]),
      }),
    });
    await expect(flagSession("s1", 1, [], "reason")).rejects.toThrow(InvalidStateError);
  });
});
