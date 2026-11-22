import { describe, it, expect, vi } from "vitest";
import { AppError } from "./appError.js";
import { insertOnce, settleDelete } from "./retrySafe.js";

const row = { id: "a", userId: 7 };

describe("insertOnce", () => {
  it("returns the new row and says it is not a replay", async () => {
    const existing = vi.fn();
    expect(await insertOnce(7, async () => [row], existing)).toEqual({ row, replay: false });
    expect(existing).not.toHaveBeenCalled();
  });

  it("answers a replay by the same user with the stored row", async () => {
    expect(await insertOnce(7, async () => [], async () => row)).toEqual({ row, replay: true });
  });

  it("refuses an id another user already holds, with a CONFLICT code", async () => {
    const err = await insertOnce(8, async () => [], async () => row).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ statusCode: 409, code: "CONFLICT" });
  });

  it("refuses when the conflicting row cannot be read back (deleted between the two statements)", async () => {
    await expect(insertOnce(7, async () => [], async () => undefined)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("settleDelete", () => {
  it("is deleted when a row was removed", async () => {
    expect(await settleDelete(true, async () => true)).toBe("deleted");
  });

  it("is already_gone when nothing was removed and no row is left: a replay answers success", async () => {
    expect(await settleDelete(false, async () => false)).toBe("already_gone");
  });

  it("is not_yours when nothing was removed but the row exists", async () => {
    expect(await settleDelete(false, async () => true)).toBe("not_yours");
  });
});
