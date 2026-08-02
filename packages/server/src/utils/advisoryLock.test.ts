import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvPrefix } from "./envShim.js";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
applyEnvPrefix();

const { sql } = await import("drizzle-orm");
const { db } = await import("../db/index.js");
const { withAdvisoryLock } = await import("./advisoryLock.js");
const { ADVISORY_LOCK_KEYS } = await import("../db/advisoryLockKeys.js");

const dbAvailable = await (async () => {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
})();
if (!dbAvailable) {
  console.warn("advisoryLock.test.ts: no local database reachable — suite skipped");
}

// A dedicated test key, well clear of the real registry values.
const K = 991_001;

describe.runIf(dbAvailable)("withAdvisoryLock (T15 single-runner guard)", () => {
  it("runs fn and returns true when the lock is free", async () => {
    let ran = false;
    const ok = await withAdvisoryLock(K, async () => {
      ran = true;
    });
    expect(ok).toBe(true);
    expect(ran).toBe(true);
  });

  // The core cross-instance guarantee: two overlapping runs → exactly one sends.
  //
  // Synchronised with an explicit handshake, NOT a sleep. The original version
  // fired both calls via Promise.all and had the winner sleep 150ms, assuming
  // that was long enough for the two transactions to overlap. Against a remote
  // database that assumption breaks: opening the second transaction cost ~216ms
  // (measured), so the first one committed and released BEFORE the second even
  // began. Both then acquired legitimately, runs === 2, and the suite reported a
  // lock failure that was really a test-timing failure. Gating on "the first
  // caller is provably inside the lock" removes the race entirely and holds on
  // any connection latency.
  it("only ONE of two concurrent callers runs; the other skips", async () => {
    let runs = 0;
    let firstIsInside!: () => void;
    let releaseFirst!: () => void;
    const inside = new Promise<void>((r) => (firstIsInside = r));
    const gate = new Promise<void>((r) => (releaseFirst = r));

    const holder = withAdvisoryLock(K, async () => {
      runs++;
      firstIsInside();
      await gate; // hold the lock open until the contender has had its turn
    });

    await inside; // the lock is now definitely held
    const contender = await withAdvisoryLock(K, async () => {
      runs++;
    });

    releaseFirst();
    const first = await holder;

    expect(contender).toBe(false); // second caller skipped
    expect(first).toBe(true); // first caller ran
    expect(runs).toBe(1);
  });

  it("releases the lock after fn resolves (a later call re-acquires)", async () => {
    expect(await withAdvisoryLock(K, async () => {})).toBe(true);
    expect(await withAdvisoryLock(K, async () => {})).toBe(true);
  });

  it("releases the lock when fn throws — no permanent skip", async () => {
    await expect(
      withAdvisoryLock(K, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // Transaction rolled back → lock free again.
    expect(await withAdvisoryLock(K, async () => {})).toBe(true);
  });

  it("distinct keys don't block each other (waste vs brain digest)", async () => {
    let innerAcquired = false;
    const ok = await withAdvisoryLock(ADVISORY_LOCK_KEYS.wasteDigest, async () => {
      innerAcquired = await withAdvisoryLock(ADVISORY_LOCK_KEYS.brainDigest, async () => {});
    });
    expect(ok).toBe(true);
    expect(innerAcquired).toBe(true);
  });
});
