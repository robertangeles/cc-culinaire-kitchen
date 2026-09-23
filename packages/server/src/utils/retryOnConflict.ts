/**
 * @module utils/retryOnConflict
 *
 * Shared "retry once on unique-violation" wrapper for the close-active-row
 * + insert-new-version upsert pattern (`upsertExpiryRule`, `upsertAwardRule`).
 * Both guard a partial unique index (`..._one_active`) the same way: two
 * concurrent creates for the same key can each close the row they see, but
 * only one INSERT wins the index; the loser's 23505 is retried once so it
 * re-reads the now-closed state and completes cleanly instead of surfacing
 * a raw constraint-violation error.
 */
export async function withRetryOnConflict<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") {
      return attempt();
    }
    throw err;
  }
}
