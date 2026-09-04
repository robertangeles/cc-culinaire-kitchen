---
title: Roster Core
category: entity
created: 2026-08-16
updated: 2026-09-04
related: [[staff-compliance-vault]], [[compliance-expiry-engine]], [[scheduled-job-daily-claim]], [[store-locations-system]], [[workforce-optimisation]]
---

Phase 2 of the Staff Compliance Vault + Rostering plan, complete: roles, shifts, availability, the `canAssign` compliance gate, an advisory-only Award engine, a fail-loud public-holiday calendar, and the s.114 consent workflow — built across Slices 0–7 on flag `roster_enabled`.

## Why it exists

The Compliance Vault (Phase 1) answers "is everyone current?" but not "who can I put on tonight?" Roster Core links the two: a shift can only be assigned to a staff member who holds every document their role requires, re-checked again at publish time because a certificate can lapse between drafting and publishing.

## Data model

| Table | Purpose |
|---|---|
| `roster_role` | A role staff get scheduled into ("Bartender"), org-wide or venue-scoped |
| `roster_role_document` | Junction: which `document_type`s a role requires |
| `shift` | One rostered shift at one venue, one role, Draft/Published/Cancelled |
| `shift_assignment` | A staff member on a shift; unique per (shift, user) |
| `staff_availability` | Recurring day-of-week windows a staff member is available |
| `award_rule` | Fair Work Award rules (jurisdiction, ruleType, threshold), effective-dated. **Zero rows seeded — see Award engine below** |
| `public_holiday` | Gazetted public holidays by jurisdiction + date, admin-loaded |

Tenancy: `shift.storeLocationId` is NOT NULL (a shift always happens at one venue); `roster_role.storeLocationId` and `staff_availability.storeLocationId` are nullable (org-wide or venue-scoped). `award_rule` and `public_holiday` carry no `organisationId` at all — both are jurisdiction-keyed shared reference data, same shape as `document_expiry_rule`.

### Jurisdiction normalization

`store_location.state` is free text with no dropdown, so real data mixes "VIC" and "Victoria" for the same legal jurisdiction. `services/jurisdiction.ts`'s `normalizeJurisdiction()` is the single canonical mapping used everywhere a jurisdiction is compared (`canAssign`, the Award engine, the holiday calendar) — it does NOT reuse `store_location.iana_timezone`'s backfill mapping, because that one intentionally conflates ACT into Sydney's timezone, and ACT is a legally distinct jurisdiction for Awards and public holidays.

## The `canAssign` gate

`services/rosterAssignmentRules.ts` — pure function, same shape as `complianceExpiryMath.ts`: `canAssign(heldDocs, requiredDocTypes, today)` → discriminated union naming the reason. Blocked per-shift, not per-batch: `assignStaff` refuses a single assignment ("Cannot assign. Alex's RSA expired on 15 June 2026."), and `publishRoster()` re-runs the same check for every already-assigned shift, holding back (not blocking) any shift whose assignment now fails rather than failing the whole publish.

## Award engine — shipped empty, by design

`services/awardRuleService.ts`'s `evaluate()` returns both `warnings[]` and a `coverage` object (`checked`/`not_checked` rule-type arrays, `jurisdiction`, `rules_version`) on every publish, whether or not any `award_rule` rows exist. **Zero rows are seeded** — nobody on the project is currently named as competent to author Fair Work Award rules (MA000009 changes several times a year and needs industrial-relations expertise, not calendar diligence). The publish screen shows "0 of N rule categories checked" with the same visual weight a populated warning list would get, so the gap is disclosed rather than hidden — an empty `warnings[]` is never allowed to read as "the system checked me and found nothing." Advisory-only: this engine never blocks a publish. Populating rules later is a data-entry task (INSERT + an IR-competent reviewer), not a code change.

## Public holiday calendar — fail loud, not silent

`services/publicHolidayService.ts`. Unlike the Award engine, this has no "ship empty forever" story: holiday declaration is clerical (a human loads each jurisdiction+year once it's gazetted), not a competence question. `isPublicHoliday(date, jurisdiction)` **throws** if that (jurisdiction, year) has never been loaded, rather than silently answering "not a holiday" — a missing year would otherwise mean s.114 (public-holiday work consent) is silently skipped for every shift that year.

- `publishRoster()` calls `assertHolidayCalendarLoaded()` before touching any shift: if the venue's jurisdiction has no row for every year the publish window spans, the whole publish is blocked with `"Public holidays for VIC 2027 are not loaded."` This is the one WHOLE-PUBLISH hard block in `publishRoster()` — `canAssign` blocks per-shift, the Award engine never blocks at all.
- Every shift that does publish gets `shift.isPublicHoliday` (re-)confirmed against the now-guaranteed-loaded calendar — the column the consent workflow below reads.
- A daily gap-check job (05:00, reusing `claimDailyRun`/`runIfClaimed` verbatim — see [[scheduled-job-daily-claim]]) scans every distinct venue jurisdiction and logs an `alert: "compliance_holiday_calendar_gap"` marker for any (jurisdiction, year) not yet loaded for the current year, and next year from November on. This is a heads-up, not enforcement — the real block is `publishRoster()`'s own check at the moment a gap actually matters.
- Admin loader UI: Settings → Public Holidays (`PublicHolidaysTab.tsx`), gated on `roster:manage`. Manual entry only, no bulk auto-population of real AU dates — deliberately clerical.

## s.114 consent workflow (Slice 7)

`services/consentService.ts`. A staff member's consent is its own state machine on `shift_assignment` (`publicHolidayConsent`: null → `Requested` → `Accepted`/`Declined`, with `consentRequestedAt`/`consentRespondedAt`) — independent of the shift's `status` (Draft/Published) and the assignment's own `status` (Pending/Confirmed/Declined). Three separate questions live on the same row: will you work this shift, has the venue published it, and do you consent to it being a public holiday.

- `requestConsent(orgId, assignmentId, actorUserId)` — manager-only (`roster:manage`). Independently re-derives whether the shift's date is a public holiday (the same `toVenueLocalDate` + `isPublicHoliday` check `publishRoster()` uses) rather than trusting `shift.isPublicHoliday`, which is only reliable once a shift is Published — a manager requesting consent on a still-Draft shift needs a fresh check. Notifies the staff member directly (`createInApp`, type `HOLIDAY_CONSENT_REQUESTED`) — not `notifyHQAdmins`, which is for the opposite direction below. Refuses to re-request an already-`Accepted` consent (409).
- `respondToConsent(orgId, assignmentId, callerUserId, response)` — the assignee only (`roster:read-own`); a non-assignee gets 404, same "don't confirm another user's assignment exists" shape as `respondToAssignment`. Requires `publicHolidayConsent === "Requested"` (409 otherwise) — a decline can't be silently overridden by a later response without a fresh request. Every response is audit-logged (`entityType: "shift_assignment"`, `metadata.action`: `consent_accept` | `consent_decline`). A decline fans out via `notifyHQAdmins(..., "roster:manage")` so a manager knows to reassign the shift.
- `publishRoster()` reads `publicHolidayConsent` directly off each already-fetched assignment row (no extra query) and holds — never blocks — a public-holiday shift whose Pending/Confirmed assignees haven't all reached `Accepted`. The held reason names who and why (`rosterService.ts`'s `consentHoldReason()`): never asked, asked but no response yet, or declined. Checked only after `canAssign` passes for that person, so a compliance block is always the reason surfaced first when both apply.
- `notification.type` is `varchar(30)`. `PUBLIC_HOLIDAY_CONSENT_REQUESTED`/`_DECLINED` (32/31 chars) overflowed it — caught by the live integration suite, not `tsc` (a column-length violation is a runtime Postgres error, invisible to the type system). The actual `NotificationType` members are the shorter `HOLIDAY_CONSENT_REQUESTED`/`HOLIDAY_CONSENT_DECLINED`.
- Verified live end-to-end via browser QA against dev (not just integration tests): request → staff sees a distinct Accept/Decline prompt in `MyShiftsView.tsx` separate from the shift confirm/decline question → decline → publish holds that shift with the exact reason text → re-request → accept → publish succeeds.

### The UTC/local calendar-date bug this module exists to avoid

A shift's `startDatetime` is a `timestamptz` (a UTC instant). Converting that to "which calendar day is this" via `date.toISOString().slice(0, 10)` is wrong whenever the venue's local timezone differs from UTC: a 9am AEDT shift is 10pm UTC the *previous* day. `rosterService.ts`'s `toVenueLocalDate(instant, ianaTimezone)` reads the instant back in the venue's own `store_location.iana_timezone` (via `Intl.DateTimeFormat` with the `timeZone` option) instead of naive UTC slicing — the same class of bug [[compliance-expiry-engine]] never had to solve, because `compliance_document.expiry_date` is a bare `date` column, not a timestamptz.

## Week calendar (drag-to-build)

`components/roster/RosterCalendarView.tsx`, the "Calendar" tab beside the pre-existing flat-list "Shifts" tab — additive, not a replacement. X = 7 day columns (Mon–Sun), each subdivided into one sub-lane per role active at the venue; Y = time-of-day, a full 24h scroll defaulting to ~6am. Four gestures map to the four mutations Shift builder already exposes — drag empty lane space (create), drag a Draft shift (reschedule), drag its edge (resize), drag a staff chip onto a Draft shift (assign) — no new mutation surface, and Published shifts render read-only since the server 409s on all four for a non-Draft shift.

**Why role-lanes, not a plain 7-column week:** role is immutable on a shift once created (`PUT /shifts/:id` never accepts a role change), so a drag-create gesture has to know its role from where you drop it — the role has to be a spatial axis of the grid, not a picker step after the fact. This also makes cross-role time overlap structurally impossible (different lane) without a real collision-packing algorithm, and constrains a move-drag to its own role's lane by construction.

**New read path:** `getWeekCalendar(orgId, storeLocationId, from, to)` (`rosterService.ts`) via `GET /shifts/calendar`, one row per shift with role name and Pending/Confirmed assignees joined inline — same join shape `staffingCoverageService.ts` already established, minus its `canAssign` aggregation (that's Coverage's job). The existing `GET /shifts` deliberately wasn't touched or overloaded — `ShiftsManager.tsx` depends on its bare-shift-row contract, and fetching assignments per-shift on demand (its existing lazy pattern) doesn't scale to rendering a whole week of shifts at once.

**Position math** lives in `lib/rosterCalendarMath.ts` — pure, separately unit-tested (time↔pixel, snap-to-15-minutes, Monday-start week/day-column resolution, lane index), same "pure logic module" convention as `complianceExpiryMath.ts`/`rosterAssignmentRules.ts`. Drag mechanics are hand-rolled Pointer Events + `elementFromPoint` — no DnD library, matching this repo's zero-dependency convention already set by `MiniCalendar.tsx`/`StaffingCoverageView.tsx`.

**Two real bugs found only by actually dragging things in a browser**, neither catchable by unit or integration tests: (1) day columns never received their initial ~6am scroll position — only the hour rail did, since each day column is an independently-scrolling container synced to the others only on a user-driven scroll — so a freshly-created shift rendered at the wrong apparent time relative to the visible hour labels until the mount effect was fixed to set every column's `scrollTop`, not just the rail's. (2) A second assignment of the same person to the same shift hit `shiftAssignment`'s `UNIQUE(shiftId, userId)` constraint directly and surfaced a raw Postgres error as an unhandled 500 — `assignStaff()` now checks for an existing row first and refuses with `"{name} is already assigned to this shift."` (409), regression-tested in `roster.integration.test.ts`.

**A third real bug, found by adversarial review before merge, not by browser QA:** the resize gesture derived a shift's calendar day via `new Date(startDatetime).toISOString().slice(0, 10)` — the UTC day — while every other path in the file (lane bucketing, the move gesture) used the LOCAL day. For this app's own AU deployment timezone, any shift starting before ~10–11am local (AEST/AEDT) is stored with a UTC date one day earlier — resizing it silently sent both start and end anchored to the wrong day. The server only validates `end > start`, so it accepted the internally-consistent-but-wrong result with no error: a shift the user could see moved a calendar day backward. Fixed by extracting `localDayIso()` into `rosterCalendarMath.ts` and using it everywhere a shift's day is derived from its timestamp — never `.toISOString().slice(0, 10)` for that. Two unit tests reproduce the exact UTC/local disagreement via a `TZ` override.

**Known limitations, disclosed rather than silently shipped (adversarial review, all fail safe or are pre-existing patterns extended — not fixed this pass):**
- **Overnight (midnight-crossing) shifts can't be dragged.** `minutesSinceMidnight` strips the date, so an overnight shift's derived duration goes negative — the server's `end > start` check then rejects every move/resize of one with a generic error. Confirmed fail-safe (never silently corrupts the times), just unusable via drag today; still creatable/editable the old way via the Shifts tab's form.
- **Two same-role Draft shifts that overlap in time are hit-test ambiguous.** No collision packing exists yet, so both render at the same coordinates and a drag lands on whichever painted on top — a valid target, just possibly not the one the user meant to grab. A real staffing mistake with no warning, worth a packing/z-offset pass if overlapping same-role shifts turn out to be common in practice.
- **Not multi-touch/pointerId-safe.** The drag state machine is a single global slot; a second concurrent pointer (tablet multi-touch) silently discards whatever the first pointer was mid-drag. Matches the plan's own "full mobile/touch polish" exclusion for v1.
- **`getWeekCalendar` has no cap on the requested date range**, same as `listShifts`/`getStaffingCoverage` already have — not a new risk class, but the response is heavier per row (assignee names joined in) than those two.

**A fourth bug found merging this branch with the shift-time incident fix below, before landing rather than after:** a shift spanning multiple calendar days rendered in a single day's lane, sized to only that day's minutes (`minutesSinceMidnight` strips the date component on both ends) — which looked exactly like an ordinary same-day shift, no visual sign the remaining days existed. Not the "renders absurdly tall" failure originally assumed when scoping this fix; the actual failure was the opposite and more dangerous — a normal-looking block silently hiding a 129h/157h-class incident shift. `formatTimeRange()` (a fourth independent reimplementation of the same start-date-without-end-date formatting bug fixed below) is replaced by the shared `formatShiftRange()`, and every shift block now carries a "+Nd" badge (amber, hover for the exact end date) whenever `localDayIso(end) !== localDayIso(start)` — computed via the existing `dayColumnIndexForDate()`, no new date-math primitive needed.

## Shift-time display, validation, and editing (2026-09 incident hardening)

Two "Duty Manager" shifts in dev were entered with end dates 5-7 days after their start (129h and 157h spans) — genuine bad data, not a calculation bug. `staffingCoverageService.ts`'s hour arithmetic and day-bucketing were both already correct; what let the mistake through unnoticed was purely a display gap:

- `formatShiftTime()` (formerly duplicated in `ShiftsManager.tsx` and `MyShiftsView.tsx`) printed the shift's start date once, then `startTime–endTime` — it never checked whether `endDatetime` landed on a different calendar day, so a 157-hour shift rendered identically to a normal 13-hour one. Replaced by `formatShiftRange()` (`packages/shared/src/utils/dates.ts`), which shows the end date too whenever it differs: `"Mon, 7 Sept, 8:00 am – Sun, 13 Sept, 9:00 pm"`.
- The create-shift form had two independent `datetime-local` inputs with no duration feedback at all. `ShiftTimeFields` (`ShiftsManager.tsx`) now shows a live duration readout and a non-blocking warning + required confirm checkbox above 16 hours or when the shift spans more than one calendar-day boundary (`daysBetweenLocal(...) > 1` — crossing exactly one midnight is a normal overnight shift and doesn't warn).
- There was no way to see or fix a shift's start/end after creating it, even though the server's `PUT /shifts/:id` (`updateShift()`) already enforced Draft-only + `end > start` — it simply had no caller. `useShifts()` now exposes `update()`, and `ShiftRow` has an Edit action (same Draft-only gate as Cancel). `updateShift()` now also writes an audit-log entry (before/after start/end), following `respondToAssignment()`'s diff pattern rather than `publishRoster()`'s batched-summary one.

New shared helpers in `packages/shared/src/utils/dates.ts`: `durationHours()` and `daysBetweenLocal()` — used by both the client warning and (planned, Phase 3) a server-side 24h hard ceiling, so the arithmetic exists once across the client/server boundary rather than being reimplemented per layer.

The two corrupted dev rows were deleted (`DELETE FROM shift WHERE shift_id IN (...)`) after confirming they were Draft, unpublished, and had no recoverable original intent; `shift_assignment.shift_id`'s `ON DELETE CASCADE` handled any assignment rows automatically.

**Not yet done** (tracked separately, not part of this fix): a published-only week-agenda redesign of `MyShiftsView.tsx` (today's `listMyShifts()` has no status filter, so Draft shifts still show to staff); a server-side 24h duration guard; double-booking overlap warnings. The drag-to-build week calendar (above, "Week calendar (drag-to-build)") merged in the same pass as this section, with its own multi-day-shift "+Nd" guard added — see that section's final paragraph.

## Permissions

`roster:read-own` (your own shifts/availability), `roster:read-all` (org-wide), `roster:manage` (create/edit roles, shifts, assignments, public holidays), `roster:publish`. Full six-step checklist applied per CLAUDE.md; boundary tests in `rosterPermissions.test.ts`.

## Known limits

- **No admin UI for authoring `award_rule` rows.** Deferred until an IR-competent reviewer is named — see the plan's Known Risk 2b.
- **No Playwright E2E coverage for the original Roster Core flows (Slices 2–7)** — roles, shift builder, my shifts, availability, publish, public holidays, s.114 consent. CI has no E2E step at all (the plan's own eng-review issue 11 / task T26); every one of those slices was instead verified via live browser QA against dev before shipping. The week calendar above is the one exception — it does have a real Playwright spec (`roster-calendar.spec.ts`), added specifically because a drag gesture is the one class of interaction browser QA can eyeball but can't leave behind as a durable regression check.

## Related
[[staff-compliance-vault]] · [[compliance-expiry-engine]] · [[scheduled-job-daily-claim]] · [[store-locations-system]] · [[workforce-optimisation]]
