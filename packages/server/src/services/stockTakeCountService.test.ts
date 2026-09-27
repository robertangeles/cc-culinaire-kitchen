import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotFoundError, InvalidStateError, ValidationError, ConflictError } from "./stockTakeErrors.js";

vi.mock("../db/index.js", () => ({
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
  },
}));

vi.mock("./unitConversionService.js", () => ({
  convertToBase: vi.fn().mockResolvedValue({ baseQty: 5, baseUnit: "kg" }),
}));

vi.mock("./stockMath.js", () => ({
  varianceQty: vi.fn().mockReturnValue(0),
  variancePct: vi.fn().mockReturnValue(0),
}));

const { db } = await import("../db/index.js");
const { claimCategory, submitCategory, saveLineItem } = await import("./stockTakeCountService.js");

function mockSelect(rows: unknown[]) {
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rows),
      innerJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(rows),
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  });
}

function mockUpdate(returning: unknown[]) {
  (db.update as ReturnType<typeof vi.fn>).mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(returning),
      }),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("claimCategory", () => {
  it("throws NotFoundError when category does not exist", async () => {
    mockSelect([]);
    await expect(claimCategory("s1", "proteins", 1)).rejects.toThrow(NotFoundError);
  });

  it("returns cat idempotently when already IN_PROGRESS by same user", async () => {
    const cat = { categoryStatus: "IN_PROGRESS", claimedByUserId: 1, categoryId: "c1" };
    mockSelect([cat]);
    const result = await claimCategory("s1", "proteins", 1);
    expect(result).toEqual(cat);
  });

  it("throws InvalidStateError when category is SUBMITTED", async () => {
    mockSelect([{ categoryStatus: "SUBMITTED", claimedByUserId: 2, categoryId: "c1" }]);
    await expect(claimCategory("s1", "proteins", 1)).rejects.toThrow(InvalidStateError);
  });

  it("transitions NOT_STARTED to IN_PROGRESS", async () => {
    const cat = { categoryStatus: "NOT_STARTED", claimedByUserId: null, categoryId: "c1" };
    const updated = { ...cat, categoryStatus: "IN_PROGRESS", claimedByUserId: 1 };
    mockSelect([cat]);
    mockUpdate([updated]);
    const result = await claimCategory("s1", "proteins", 1);
    expect(result).toEqual(updated);
  });

  it("throws ConflictError when concurrent claim wins the race", async () => {
    const cat = { categoryStatus: "NOT_STARTED", claimedByUserId: null, categoryId: "c1" };
    mockSelect([cat]);
    mockUpdate([]); // 0 rows — another claim updated the status predicate first
    await expect(claimCategory("s1", "proteins", 1)).rejects.toThrow(ConflictError);
  });
});

describe("submitCategory", () => {
  it("throws NotFoundError when category does not exist", async () => {
    mockSelect([]);
    await expect(submitCategory("s1", "proteins")).rejects.toThrow(NotFoundError);
  });

  it("throws InvalidStateError when category is NOT_STARTED", async () => {
    mockSelect([{ categoryStatus: "NOT_STARTED", categoryId: "c1" }]);
    await expect(submitCategory("s1", "proteins")).rejects.toThrow(InvalidStateError);
  });

  it("returns cat idempotently when already SUBMITTED", async () => {
    const cat = { categoryStatus: "SUBMITTED", categoryId: "c1" };
    mockSelect([cat]);
    const result = await submitCategory("s1", "proteins");
    expect(result).toEqual(cat);
  });

  it("transitions IN_PROGRESS to SUBMITTED", async () => {
    const cat = { categoryStatus: "IN_PROGRESS", categoryId: "c1" };
    const submitted = { ...cat, categoryStatus: "SUBMITTED" };
    // First select: category lookup
    (db.select as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([cat]),
      }),
    });
    mockUpdate([submitted]);
    // Second select: checkAndAdvanceSession counts — not all claimed done, no advance
    mockSelect([{ claimed: 0, blocking: 0 }]);
    const result = await submitCategory("s1", "proteins");
    expect(result).toEqual(submitted);
  });

  it("throws ConflictError when concurrent submit wins the race", async () => {
    mockSelect([{ categoryStatus: "IN_PROGRESS", categoryId: "c1" }]);
    mockUpdate([]); // 0 rows — concurrent change updated status predicate first
    await expect(submitCategory("s1", "proteins")).rejects.toThrow(ConflictError);
  });
});

describe("saveLineItem", () => {
  it("throws ValidationError on negative quantity", async () => {
    await expect(saveLineItem("c1", "i1", -1, "kg", 1)).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError when quantity exceeds 99999", async () => {
    await expect(saveLineItem("c1", "i1", 100000, "kg", 1)).rejects.toThrow(ValidationError);
  });
});
