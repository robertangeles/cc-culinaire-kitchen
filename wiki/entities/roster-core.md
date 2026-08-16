---
title: Roster Core
category: entity
created: 2026-08-16
updated: 2026-08-16
related: [[staff-compliance-vault]], [[compliance-expiry-engine]], [[scheduled-job-daily-claim]], [[store-locations-system]]
---

Phase 2 of the Staff Compliance Vault + Rostering plan: roles, shifts, availability, the `canAssign` compliance gate, an advisory-only Award engine, and a fail-loud public-holiday calendar — built across Slices 0–6 on flag `roster_enabled`. Slice 7 (s.114 consent workflow) is the one remaining piece.

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
- Every shift that does publish gets `shift.isPublicHoliday` (re-)confirmed against the now-guaranteed-loaded calendar — this is the column Slice 7's consent workflow will read.
- A daily gap-check job (05:00, reusing `claimDailyRun`/`runIfClaimed` verbatim — see [[scheduled-job-daily-claim]]) scans every distinct venue jurisdiction and logs an `alert: "compliance_holiday_calendar_gap"` marker for any (jurisdiction, year) not yet loaded for the current year, and next year from November on. This is a heads-up, not enforcement — the real block is `publishRoster()`'s own check at the moment a gap actually matters.
- Admin loader UI: Settings → Public Holidays (`PublicHolidaysTab.tsx`), gated on `roster:manage`. Manual entry only, no bulk auto-population of real AU dates — deliberately clerical.

### The UTC/local calendar-date bug this module exists to avoid

A shift's `startDatetime` is a `timestamptz` (a UTC instant). Converting that to "which calendar day is this" via `date.toISOString().slice(0, 10)` is wrong whenever the venue's local timezone differs from UTC: a 9am AEDT shift is 10pm UTC the *previous* day. `rosterService.ts`'s `toVenueLocalDate(instant, ianaTimezone)` reads the instant back in the venue's own `store_location.iana_timezone` (via `Intl.DateTimeFormat` with the `timeZone` option) instead of naive UTC slicing — the same class of bug [[compliance-expiry-engine]] never had to solve, because `compliance_document.expiry_date` is a bare `date` column, not a timestamptz.

## Permissions

`roster:read-own` (your own shifts/availability), `roster:read-all` (org-wide), `roster:manage` (create/edit roles, shifts, assignments, public holidays), `roster:publish`. Full six-step checklist applied per CLAUDE.md; boundary tests in `rosterPermissions.test.ts`.

## Known limits

- **Slice 7 (s.114 consent) is not built yet.** `shift.isPublicHoliday` is correctly populated, but nothing yet requires a staff member's consent before a public-holiday shift counts as confirmed, and nothing yet holds that one shift back (rather than the whole roster) on a decline.
- **No admin UI for authoring `award_rule` rows.** Deferred until an IR-competent reviewer is named — see the plan's Known Risk 2b.

## Related
[[staff-compliance-vault]] · [[compliance-expiry-engine]] · [[scheduled-job-daily-claim]] · [[store-locations-system]]
