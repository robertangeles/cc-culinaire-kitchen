/**
 * @module db/advisoryLockKeys
 *
 * Stable Postgres advisory-lock keys for scheduled / singleton jobs (spec T15).
 * Any cron-style job that must run exactly once across all app instances claims
 * a unique bigint here via `withAdvisoryLock`. Keys MUST be globally unique and
 * never reused — a collision would let one job silently skip while another holds
 * the lock. Add new jobs (T16 compaction, T17 nudges) with fresh values.
 */
export const ADVISORY_LOCK_KEYS = {
  /** Weekly waste digest (Sunday 8 PM). */
  wasteDigest: 8_100_001,
  /** Weekly Brain org digest (Sunday 8 PM). */
  brainDigest: 8_100_002,
  /** Nightly Brain corpus snapshot (03:00) — Phase 3 analytics prep. */
  brainCorpusSnapshot: 8_100_003,
} as const;
