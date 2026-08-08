---
title: Daily-Run Claim Replaces Advisory Lock for Scheduled Jobs
category: decision
created: 2026-08-07
updated: 2026-08-07
related: [[compliance-expiry-engine]], [[staff-compliance-vault]]
---

The compliance expiry scan (and, going forward, every scheduled job) claims its once-per-day run with a single atomic conditional `UPDATE` against a `site_setting` row, instead of wrapping the job in `withAdvisoryLock` or guarding it with an in-process JS variable.

## The mechanism

`packages/server/src/utils/dailyRunClaim.ts` reduces the whole problem to one statement:

```sql
UPDATE site_setting
   SET setting_value = :today, updated_dttm = now()
 WHERE setting_key = :key AND setting_value <> :today
RETURNING setting_id;
```

One row back means the caller owns today's run. Zero rows means someone else already claimed it — return immediately, do no work. That single atomic `UPDATE` is doing three separate jobs at once, which is exactly why it replaces two other mechanisms rather than one:

| Concern | How the claim covers it |
|---|---|
| **Cross-instance mutex** | The `UPDATE` is atomic at the database level; with N instances racing the same tick, exactly one gets a row back. |
| **Restart-safe day guard** | The "have we run today" state lives in the row, not a JS variable — a Render deploy landing mid-window cannot make the job re-fire, because the new process reads the same row the old one wrote. |
| **Admin-visible heartbeat** | `setting_value` **is** the last-run date. `GET /api/compliance/stats` reads it via `readLastRun()`; a stale value is the direct signal that the job died silently. |

Three jobs, one write, one row. No separate heartbeat table, no separate lock table.

## Why not `withAdvisoryLock`

The obvious alternative already existed in the codebase — `pg_try_advisory_xact_lock`-based mutual exclusion. It was rejected for a specific, code-level reason, not a style preference: `withAdvisoryLock` runs the caller's `fn` inside `db.transaction()`, but its signature is `fn: () => Promise<void>` — it never passes the transaction handle `tx` to `fn`. Every consumer of that helper therefore does its real writes through the module-level `db` on other pooled connections anyway, so wrapping a job in it buys none of the atomicity a reader might assume it buys.

What it does cost is real: it holds one connection from the pool idle for the entire duration of `fn`, a cost its own doc comment already warns about ("keep `fn` fast and DB-bound... a long external await would hold the lock, and a pool connection, the whole time"). The compliance expiry scan can touch on the order of 18,000 rows in one pass. Holding a pool connection idle for that whole scan is a self-inflicted `ConnectionPoolExhausted` risk for no atomicity benefit — the exact failure mode this decision exists to avoid.

## Why not a JS variable

The simpler-looking alternative — a module-level `let lastRunDate` checked before the job body runs — fails for a reason specific to this deployment: Render restarts the process on every deploy, and this project ships multiple times a week. A JS variable's state does not survive a restart. A deploy landing inside the job's run window resets the guard to its initial value, and the job fires again the same day. The claim's state lives in Postgres specifically so a deploy mid-window cannot cause a duplicate run — this is the same reasoning [[staff-compliance-vault]]'s tenancy model applies to state that must outlive a single process.

## Why not `settingsService`

`site_setting` already has a service layer (`upsertSettings()` / `getAllSettings()`), and reusing it looked like the smaller diff. It doesn't fit: `upsertSettings()` is select-then-write across two round trips, which cannot express "update only if the value differs from today" as one atomic operation — and that conditional atomicity is the entire mechanism this decision relies on. `getAllSettings()` also serves from a module-scope cache, so a job checking through it could read a stale claim. `dailyRunClaim.ts` talks to `db` directly for both reasons and never reads through the settings service.

## Claim-before-work, and what that requires

The claim is taken **before** the job's work runs, deliberately — that ordering is what makes the cross-instance mutex work at all; two instances racing the same tick can never both start. The cost of that ordering: if the work throws after the claim succeeds, the claim is already "spent" for today, and without an explicit release the job would not retry until tomorrow. `runIfClaimed()` handles this with a `catch` that calls `releaseDailyRun()` — resetting the row back to the sentinel `""` — so the next tick can retry the same period. Losing the *release* itself (if that write also fails) only costs a retry this period, never correctness; it's logged and swallowed rather than thrown, because a failed job must not take the process down.

The seed value `""` for a freshly-created claim row is deliberately chosen because it can never equal a real `YYYY-MM-DD` day key, so the first claim after seeding always wins.

## Consequences

- Any new scheduled job should reuse `claimDailyRun` / `runIfClaimed` rather than reinventing a guard — the plan explicitly calls out retrofitting this same pattern onto five pre-existing jobs (`sendWeeklyWasteDigests`, `sendOrgDigests`, `snapshotCorpus`, `compactAll`, `runNudges`) that currently use the JS-variable pattern and have no heartbeat at all.
- The heartbeat is only as fresh as the last successful claim — a job that claims but then fails every single run still shows a recent `setting_value`, because the claim write happens before the work. Staleness detection catches "stopped running entirely," not "running but failing internally."
- `dayHourKey()` exists alongside `dayKey()` for jobs that may legitimately need to run more than once a day (none do yet; weekly digests are the anticipated case).

## Related
[[compliance-expiry-engine]] · [[staff-compliance-vault]]
