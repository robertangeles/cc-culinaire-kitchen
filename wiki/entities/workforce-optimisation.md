---
title: Workforce Optimisation
category: entity
created: 2026-08-17
updated: 2026-08-17
related: [[roster-core]], [[staff-compliance-vault]]
---

Phase 3 of the Staff Compliance Vault + Rostering plan: demand forecasting from prep workload, a coverage heat map, and shift swapping. In progress — Slice 1 (demand forecasting) is built; Slices 2 (coverage heat map) and 3 (shift swap) are not yet started.

## Why it exists

Roster Core (Phase 2) answers "who can I put on tonight?" (the `canAssign` compliance gate). Phase 3 adds the other half: "how many people do I actually need?" and "is my roster covered?" — using signals CulinAIre already has (prep workload, recorded sales) rather than bookings or walk-ins, which this platform doesn't model.

## Demand forecasting (Slice 1) — reports by station, not role

`services/workforceDemandService.ts`. Recommends staffing hours per **kitchen station** for a target date, from `prep_task.prep_time_minutes` history scaled by that date's expected covers.

**Why station, not role**: `prep_task.station` (kitchen-area vocabulary set by ingredient category — "Bar", "Grill / Protein", "Pastry / Bakery", via `prepMath.ts`'s `stationFor()`) and `roster_role.roleName` (free-text per org, e.g. "Bartender") are independently-typed vocabularies with no table or FK between them anywhere in this schema. Mapping one to the other would mean guessing an org's own naming conventions on their behalf. Station names are already human-readable — a manager translates "Bar" ≈ "Bartender" in the two seconds it takes to read the screen. `# ponytail: no station→role mapping table; add one only if an operator explicitly asks for role-level rollups.`

**The formula**: `historicalMinutesPerCover(station) = Σprep_time_minutes / Σcovers` over the 30 days immediately before the target date (the target date itself is excluded from its own historical average — no circular reasoning). `recommendedHours = round((minutesPerCover × targetDate.expectedCovers) / 60, nearest 0.25h)`. `confidence = forecastConfidence(daysWithData, 30)` — reused verbatim from `forecastMath.ts`'s existing formula (`min(1, daysWithData/windowDays)`), computed **per station** so a station that only appears occasionally scores lower confidence than one logged daily.

**`sale` is deliberately not used.** No formula anywhere in this codebase converts sale volume into labour-hours, and inventing one now would be a guess presented as fact. Every result discloses `inputsUsed`/`inputsNotUsed` explicitly — same honesty posture as the Award engine's "0 of N checked" ([[roster-core]]).

**Fails loud, not silent**: `getStationDemand()` throws 404 if the target date has no `prep_session` at that venue with an expected-covers count — same "don't guess a number, ask for the real one" posture as the public holiday calendar's fail-loud gap check.

Client: a "Demand" tab in `RosterPage.tsx`, gated `roster:read-all`. Verified live end-to-end against dev (seeded 3 days of history + a target session, confirmed the exact recommended-hours and confidence-percentage math rendered matched the formula).

## Feature flag

`workforce_enabled` — reuses the `site_setting` flag already seeded `"false"` from Phase 2 Slice 0, never wired to a route until now. Gated via the existing `requireFlag()` middleware, same "unauthenticated prober sees the same 404" pattern as `roster_enabled`/`compliance_enabled`.

## Permissions

No new permission keys. Reuses Roster Core's existing `roster:read-own`/`roster:read-all`/`roster:manage`/`roster:publish` — established precedent (the public-holiday admin loader in [[roster-core]] made the same call).

## Not yet built

- **Coverage heat map** (Slice 2) — day × role grid per venue, cell = rostered hours. "Skill coverage" (is an FSS on shift, is RSA-certified staff on every alcohol shift) is designed to reuse `roster_role_document` + the existing `canAssign` gate generically rather than hardcoding certification names — no "alcohol shift" flag, no magic strings.
- **Shift swap** (Slice 3) — peer-to-peer, `canAssign` re-run against the claiming candidate as the only gate (no manager-approval step). New `shift_swap_request` table. On claim into a public-holiday shift, reuses `consentService.requestConsent()` directly so the new assignee independently consents rather than inheriting the old assignee's consent.

Full design (formula derivation, query shapes, schema, slice sequencing) is in the plan file's "Phase 3 Execution Plan" section.

## Related
[[roster-core]] · [[staff-compliance-vault]]
