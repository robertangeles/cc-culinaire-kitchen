---
title: Workforce Optimisation
category: entity
created: 2026-08-17
updated: 2026-08-17
related: [[roster-core]], [[staff-compliance-vault]]
---

Phase 3 of the Staff Compliance Vault + Rostering plan: demand forecasting from prep workload, a coverage heat map, and shift swapping. Complete — all three slices (demand forecasting, coverage heat map, shift swap) are shipped.

## Why it exists

Roster Core (Phase 2) answers "who can I put on tonight?" (the `canAssign` compliance gate). Phase 3 adds the other half: "how many people do I actually need?" and "is my roster covered?" — using signals CulinAIre already has (prep workload, recorded sales) rather than bookings or walk-ins, which this platform doesn't model.

## Demand forecasting (Slice 1) — reports by station, not role

`services/workforceDemandService.ts`. Recommends staffing hours per **kitchen station** for a target date, from `prep_task.prep_time_minutes` history scaled by that date's expected covers.

**Why station, not role**: `prep_task.station` (kitchen-area vocabulary set by ingredient category — "Bar", "Grill / Protein", "Pastry / Bakery", via `prepMath.ts`'s `stationFor()`) and `roster_role.roleName` (free-text per org, e.g. "Bartender") are independently-typed vocabularies with no table or FK between them anywhere in this schema. Mapping one to the other would mean guessing an org's own naming conventions on their behalf. Station names are already human-readable — a manager translates "Bar" ≈ "Bartender" in the two seconds it takes to read the screen. `# ponytail: no station→role mapping table; add one only if an operator explicitly asks for role-level rollups.`

**The formula**: `historicalMinutesPerCover(station) = Σprep_time_minutes / Σcovers` over the 30 days immediately before the target date (the target date itself is excluded from its own historical average — no circular reasoning). `recommendedHours = round((minutesPerCover × targetDate.expectedCovers) / 60, nearest 0.25h)`. `confidence = forecastConfidence(daysWithData, 30)` — reused verbatim from `forecastMath.ts`'s existing formula (`min(1, daysWithData/windowDays)`), computed **per station** so a station that only appears occasionally scores lower confidence than one logged daily.

**`sale` is deliberately not used.** No formula anywhere in this codebase converts sale volume into labour-hours, and inventing one now would be a guess presented as fact. Every result discloses `inputsUsed`/`inputsNotUsed` explicitly — same honesty posture as the Award engine's "0 of N checked" ([[roster-core]]).

**Fails loud, not silent**: `getStationDemand()` throws 404 if the target date has no `prep_session` at that venue with an expected-covers count — same "don't guess a number, ask for the real one" posture as the public holiday calendar's fail-loud gap check.

Client: a "Demand" tab in `RosterPage.tsx`, gated `roster:read-all`. Verified live end-to-end against dev (seeded 3 days of history + a target session, confirmed the exact recommended-hours and confidence-percentage math rendered matched the formula).

## Coverage heat map + skill coverage (Slice 2)

`services/staffingCoverageService.ts`. A day x role grid for one venue over a 7-day window: cell = rostered hours for that role that day (summed across shifts, deduped so a shift with multiple assignees doesn't double-count its own duration), coloured by the worst compliance status among its Pending/Confirmed assignees. A (day, role) with no shift simply has no cell — the client renders that square as an empty placeholder, distinct from a shift nobody's covering (`"unstaffed"`).

**Skill coverage reuses `roster_role_document` + the existing `canAssign` gate generically** — the same pure function `assignStaff`/`publishRoster` already use, re-run per assignee in memory. No hardcoded "RSA"/"Food Safety Supervisor" strings, no "alcohol shift" flag anywhere. "Is an FSS on shift" falls out for free once an operator has configured that requirement on a role in Roster Core's Roles UI — a config gap on their side isn't a code gap on ours, same disclosure posture as the Award engine.

**Batched, not per-cell** — this is a dashboard opened every time someone loads the tab, unlike `publishRoster()`'s one-shot per-assignment `canAssign` re-check (fine there since it runs once per publish action). Four fixed queries regardless of grid size: shifts+role+assignments joined for the date range, `roster_role_document` for the roles seen, `document_expiry_rule` for the document types seen, and held documents for every distinct assignee — then `canAssign` runs purely in memory. Detail text for an at-risk cell reuses `refusalMessage()` verbatim (exported from `rosterService.ts` for this purpose), same wording a live assignment refusal already shows.

**A real bug caught by the integration test before it shipped**: the worst-status accumulator originally seeded each new cell at `"unstaffed"` (the worst possible severity) and only ever moved a cell *up* in severity — meaning nothing could ever override the seed, and every cell read "unstaffed" regardless of what its shifts actually said. Fixed by seeding at `"ok"` (the best) instead, so real problems correctly escalate the status as they're found.

**Known gap, documented in code**: the service doesn't resolve a per-venue jurisdiction the way `publishRoster()`/`consentService.ts` do, so a jurisdiction-specific `document_expiry_rule` override (e.g. a state-specific `blockOnExpiry`) is invisible here — every role falls back to the national rule only. Acceptable for a heat map (advisory, not a publish gate) but worth revisiting if it turns out to matter in practice.

Client: a "Coverage" tab in `RosterPage.tsx`, hand-rolled CSS-grid table (no charting library in this repo), a `StatRow` summary strip above it computed from the same resolved dataset the grid renders. Verified live against dev with a 3-shift fixture (covered / unstaffed / covered) — grid cells, colors, and summary counts all reconciled exactly.

## Feature flag

`workforce_enabled` — reuses the `site_setting` flag already seeded `"false"` from Phase 2 Slice 0, never wired to a route until now. Gated via the existing `requireFlag()` middleware, same "unauthenticated prober sees the same 404" pattern as `roster_enabled`/`compliance_enabled`.

## Permissions

No new permission keys. Reuses Roster Core's existing `roster:read-own`/`roster:read-all`/`roster:manage`/`roster:publish` — established precedent (the public-holiday admin loader in [[roster-core]] made the same call).

## Shift swap (Slice 3) — peer-to-peer, no manager approval

`services/shiftSwapService.ts` + new `shift_swap_request` table. A staff member offers their own `Confirmed` assignment; any other org staff member browses the open-swap list and self-claims, gated only by `canAssign` re-run against the claiming candidate — the same gate `assignStaff` uses, no manager-approval step (Decision 5, matching the plan's own wording).

**Race-safe claim, one transaction, no advisory lock.** `claimSwap` runs a conditional `UPDATE shift_swap_request SET status='Claimed' WHERE swap_request_id=:id AND status='Open' RETURNING *` inside the same `db.transaction()` as the assignment transfer (hard-delete the old `shift_assignment` row, insert the new one `Confirmed`). If the conditional UPDATE returns zero rows — someone else claimed it first — the whole transaction throws and rolls back, including the delete/insert that hadn't happened yet. Proven under a real concurrent `Promise.allSettled([claimA, claimB])` against the dev DB: exactly one wins, exactly one assignment row exists afterward.

**`assignStaff`'s Draft-only guard deliberately does not apply to a claim.** That guard exists so `publishRoster()` stays the only place a *fresh* assignment's s.114 consent gate fires — see [[roster-core]]. A swap claim replaces an assignment on an already-Published shift (the realistic case), so it's its own dedicated delete-then-insert path inside one transaction, never a call through `assignStaff`.

**Public-holiday consent needed zero new logic.** On a successful claim into an `isPublicHoliday` shift, `claimSwap` calls the existing `consentService.requestConsent(orgId, newAssignmentId, actorUserId)` directly. `MyShiftsView.tsx` already renders the `publicHolidayConsent === "Requested"` Accept/Decline banner unconditionally for any assignment in that state, so the new assignee gets the identical prompt with zero new client code — and never inherits the old assignee's `"Accepted"` consent, since it's a brand-new assignment row.

**A real bug caught by my own integration test, before review**: the first version of `claimSwap` returned the assignment row captured *before* calling `requestConsent()`, so the caller saw `publicHolidayConsent: null` instead of `"Requested"` — `requestConsent`'s own UPDATE never made it back out. Fixed by returning `requestConsent`'s result directly whenever the shift is a public holiday.

**Reuses `rosterService.ts`'s single-user `canAssign` resolution path** (`getRequirementsForRole`, `getHeldDocuments`, both newly exported for this) rather than a third reimplementation — deliberately different from Slice 2's `staffingCoverageService.ts`, which reimplemented a *batched* multi-user version for its own dashboard reasons. A swap claim only ever checks one candidate, so reusing the existing single-user functions was the right call here, not premature DRY.

No new permission key — `roster:read-own`, same tier as `MyShiftsView.tsx`'s own respond/consent actions. The browse list briefly surfaces another staff member's name and shift time to make the marketplace work; a deliberate, minimal, non-sensitive disclosure.

Client: `MyShiftsView.tsx` gets an "Offer to swap" / "Cancel swap offer" button on `Confirmed` rows and a flat "Open swaps" list below with a Claim button for everyone else's offers. No new tab, no new page.

Full design (formula derivation, query shapes, schema, slice sequencing) is in the plan file's "Phase 3 Execution Plan" section.

## Related
[[roster-core]] · [[staff-compliance-vault]]
