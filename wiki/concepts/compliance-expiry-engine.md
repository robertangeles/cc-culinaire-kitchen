---
title: Compliance Expiry Engine
category: concept
created: 2026-08-07
updated: 2026-08-07
related: [[staff-compliance-vault]], [[scheduled-job-daily-claim]], [[document-storage-cloudinary-private]]
---

The engine that decides, per document, whether to alert or expire it, and the dashboard aggregate that must agree with that decision down to the count — split across a pure math module, a daily job, and a resolved-per-staff-member SQL query that all read the same rule.

## The pure decision: `computeExpiryActions`

`complianceExpiryMath.ts` holds one exported function, `computeExpiryActions(doc, rule, today)`, deliberately kept free of any DB access so every branch is a plain unit test rather than a seeded-database fixture — matching the existing `forecastMath` / `poMath` / `stockMath` / `prepMath` pattern in this codebase.

The decision tree, in order:

1. No `expiryDate` -> `{kind:"none"}`. The document never expires; any future gating falls back to `verificationStatus` alone.
2. Status is `Archived` or `Rejected` -> `{kind:"none"}`. A dead document is never chased for renewal.
3. No matching `document_expiry_rule` for this type + jurisdiction -> `{kind:"none"}`. Nothing to alert against — a missing rule is a separate, caller-side warning, not this function's job.
4. The rule isn't effective yet, or has already ended, as of `today` -> `{kind:"none"}`.
5. `expiryDate <= today` -> `{kind:"expired"}`. Expiring *on* the day counts as already expired, not valid-until-end-of-day — the venue needs to be covered that day, and there is no midnight re-scan mechanism to flip the status later.
6. Otherwise, if `daysRemaining` exactly matches one of `rule.alertDays` -> `{kind:"alert", daysBefore, daysRemaining}`. **Exact match only** — the daily job fires each alert precisely once, on the day the countdown crosses that threshold, not on every day within it.

`today` is always injected as a parameter rather than read from `Date.now()` inside the function, which is what keeps the whole test suite immune to clock and DST flakiness.

## The job: `complianceExpiryJob.ts`

The job is a thin wrapper around the pure function, not a second copy of its logic: it fetches candidate documents (has an expiry date, not dead), resolves each one's rule by looking up the **venue's** jurisdiction (never the document's `issuing_jurisdiction` — see [[staff-compliance-vault]]'s schema section for why), calls `computeExpiryActions`, and acts on the answer — flip to `Expired`, or send a renewal-reminder notification through the existing `notifyHQAdmins` / `hasRecentNotification` fan-out so a retry of the same day never double-sends.

Two things worth knowing if you're touching this file:

- **The scan is never wrapped in one transaction.** Each row commits as it's processed, so a failure partway through a 200-document scan doesn't roll back the rows that already succeeded. `hasRecentNotification` is what makes re-running the same day safe rather than the transaction boundary — the same reasoning the once-a-day claim itself relies on (see [[scheduled-job-daily-claim]]).
- **Email bodies are escaped.** Staff display names and `trainingProviderUrl` (free text on a rule) are both attacker-controlled by the time they reach a manager's inbox, so everything interpolated goes through `escapeHtml`, and the renewal link is rejected unless it parses as plain `http(s)` — a `javascript:` href is click-to-execute in several webmail clients.

The job itself is gated by the daily-claim mechanism, not by anything in this module — see [[scheduled-job-daily-claim]] for why that's a conditional `UPDATE` and not an advisory lock or a JS flag.

## The dashboard's reconciliation problem

`complianceService.ts` has two places that need to agree on "how many staff are non-compliant": the dashboard's headline counts (`getComplianceDashboard`) and the per-staff-member matrix table underneath it (`listStaffCompliance`). This is the exact class of bug the design review's approved mockup calls out by name — "24 of 25" in the headline sitting above two visibly expired rows in the table.

The fix is that **both queries resolve the same thing**: for each (staff member, required document type) pair, the *best* document on file, not every raw row. A staff member can hold several documents of the same type — an expired old certificate and a fresh replacement — and counting raw rows would count the stale one too. Both queries pick the winner with the same `ORDER BY`:

```sql
ORDER BY
  CASE
    WHEN verification_status = 'Verified'
     AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE) THEN 0
    WHEN verification_status = 'Pending' THEN 1
    ELSE 2
  END,
  expiry_date DESC NULLS FIRST
LIMIT 1
```

Verified-and-current beats Pending beats everything else (expired, rejected, requires-renewal), with the furthest-out expiry breaking ties within a tier. Both `listStaffCompliance` and `getComplianceDashboard` run this as a `LEFT JOIN LATERAL` per (staff, required type) pair, so a renewed certificate can never make the headline and the table disagree — the comment in the code states plainly that counting raw rows was a real bug caught before shipping, not a hypothetical one.

The status this resolves to is computed **in SQL against `CURRENT_DATE`**, not recomputed separately in JS with `new Date()`. That matters because the dashboard aggregate and the staff matrix are two different queries — if one used the database's clock and the other the Node process's clock, the two numbers could disagree across midnight, or if the server process runs in a different timezone than Postgres. Using one clock for both is what keeps them provably in sync rather than usually in sync.

## Why the dashboard's join is LEFT, not INNER

`getComplianceDashboard`'s aggregate deliberately `LEFT JOIN`s `organisation_required_document`, not an inner join. An org that hasn't configured any required document types yet must still return its staff count — with an inner join, the whole resolved set collapses to zero rows, and the dashboard would render "No one on the team yet" for an org that plainly has staff. That's a false statement, and precisely the kind of misleading empty state the design review's eight-states requirement was written to prevent (state 1, "No one on the team yet," is reserved for an org with literally zero staff — state 5, "no staff match that filter," is a different, distinct state). With the `LEFT JOIN`, staff with no required types simply come back with an empty `documents` array, which the client can tell apart from having no staff at all.

## `statusVariant`: the pure status-to-pill mapping

`statusVariant(verificationStatus, expiryDate, today)` is the pure function that turns a resolved row into the pill the UI renders (`compliant | expiring | expired | pending | rejected | na`). `na` specifically means "this staff member has never uploaded this required type" (`verificationStatus === null`), which is visually distinct from a document that exists and has gone bad — conflating the two would hide the difference between "nobody's asked them yet" and "they used to be compliant." `Orphaned` (schema exists, storage object gone) also maps to `na`, since there's nothing displayable behind it either way.

## Related
[[staff-compliance-vault]] · [[scheduled-job-daily-claim]] · [[document-storage-cloudinary-private]]
