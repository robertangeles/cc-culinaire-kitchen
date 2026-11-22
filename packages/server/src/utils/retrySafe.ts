/**
 * @module utils/retrySafe
 *
 * The one place that decides what a retried write means, for the phone's offline queue: the phone
 * resends a command until the server answers, so the answer to a repeat must equal the answer to the
 * first send. Used by waste, consumption, stock movements and prep.
 */
import { AppError } from "./appError.js";

/**
 * Create a row whose primary key the client chose. `insert` must be an `onConflictDoNothing().returning()`
 * so a repeat inserts nothing; `existing` reads the row that holds the id.
 *
 * `replay: true` means the row was already there: the caller must skip every side effect (stock, events).
 * An id held by someone else's row is a 409 CONFLICT, never their row.
 */
export async function insertOnce<R extends { userId: number }>(
  userId: number,
  insert: () => Promise<R[]>,
  existing: () => Promise<R | undefined>,
): Promise<{ row: R; replay: boolean }> {
  const [created] = await insert();
  if (created) return { row: created, replay: false };
  const row = await existing();
  if (!row || row.userId !== userId) throw new AppError(409, "CONFLICT", "That id is already used by another entry");
  return { row, replay: true };
}

export type DeleteVerdict = "deleted" | "already_gone" | "not_yours";

/**
 * What a delete meant. A repeat of a delete that already happened is a success (`already_gone`), not a 404;
 * a row that exists but was not removed is not the caller's to delete (`not_yours`).
 */
export async function settleDelete(removed: boolean, rowExists: () => Promise<boolean>): Promise<DeleteVerdict> {
  if (removed) return "deleted";
  return (await rowExists()) ? "not_yours" : "already_gone";
}
