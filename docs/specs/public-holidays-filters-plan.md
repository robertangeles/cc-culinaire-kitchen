# Public Holidays tab — filter/redesign plan

## Problem

`PublicHolidaysTab.tsx` (Settings → Rostering & Compliance → Public Holidays)
renders every loaded public holiday, for every jurisdiction, for every year,
as one flat unbroken list. With 8 jurisdictions × ~13 holidays/year, a single
loaded year is 100+ rows with no grouping or filtering. User feedback:
"a major doom scroll event."

## Current state

- `listPublicHolidays()` fetches ALL rows, no server-side filtering (client
  does not send jurisdiction/year query params; `packages/client/src/hooks/useRoster.ts:684`).
- Dataset is small (order of hundreds of rows max) — filtering client-side is
  sufficient, no API change needed.
- Flat `<div>` list, sorted by jurisdiction then date (`PublicHolidaysTab.tsx:277-316`).
- Add-holiday form is an inline expandable panel, already established pattern.
- Delete is an inline icon button per row.
- 8 jurisdictions: NSW, VIC, QLD, WA, SA, TAS, ACT, NT (`JURISDICTIONS` const).

## What already exists (reuse, don't reinvent)

- Horizontal pill-tab pattern (`role="tablist"`, amber-glow active state) —
  established in `InventoryPage.tsx` and just extended to
  `SettingsLayout.tsx`'s Rostering & Compliance strip. Same visual language
  applies here for a jurisdiction filter.
- `EmptyState` component (`components/ui/EmptyState.tsx`) — already used for
  the zero-holidays case.
- Amber glow / glass morphism tokens from CLAUDE.md's UI standard.

## Proposal (draft — subject to review passes below)

1. Jurisdiction filter: pill row (8 states), single-select, matching the
   existing tablist pattern. This is the primary fix — it's what collapses
   ~100+ rows down to ~13.
2. Year filter: a `<select>` next to it, populated from distinct
   `loadedForYear` values present in the data.
3. Defaults & decisions (all resolved during review — see below):
   - Jurisdiction filter defaults to the **organisation's
     `default_jurisdiction`** (existing field, `organisation.schema.ts:345`,
     admin-settable via Settings → Organisation → Branding, already
     returned by the org-read API but not yet wired to any client
     hook/context — new plumbing required, see T1) — **falling back to
     NSW** when the org has none set. Found by the eng review's outside
     voice: the plan originally hardcoded NSW everywhere, which would have
     shown every non-NSW org the wrong state by default despite this field
     existing specifically to solve that.
   - Year filter defaults to the **current calendar year if it has loaded
     data, else the nearest year that does; ties (equidistant past/future)
     prefer the future year** — an admin here is almost always preparing
     upcoming rosters, not auditing history. (Reconciled contradiction —
     an earlier draft of this plan said "nearest current/future year" in
     one place and flat "current calendar year" in another; this is the
     single rule that supersedes both.)
   - For a brand-new org with **zero** years loaded anywhere, the Year
     select falls back to just the current calendar year (its only
     option) — filtering then correctly lands on the existing "filtered
     empty" state with its Add-holiday CTA. No separate empty-toolbar
     layout needed.
   - Jurisdiction filter is **single-select only** — no "All" pill.
   - Filtered-empty state shows a context-specific message: "No holidays
     loaded for {state} in {year}".
   - Mobile (< ~640px): jurisdiction pill row **scrolls horizontally**,
     does not wrap or swap to a select. The new table (below) scrolls
     horizontally within its own container at the same breakpoint.
   - "Add holiday" form's jurisdiction dropdown **defaults to the currently
     active filter**, not hardcoded to NSW. AND: after a successful save,
     the active jurisdiction+year filter **auto-switches to match the
     newly-added holiday**, so it's immediately visible in the table
     instead of silently saving outside the current view.
   - Loading/error states keep today's behavior: the whole header
     (including the new toolbar) is not rendered during those states —
     matches the existing early-return pattern, not a new layout to build.
   - Subtitle copy is **unchanged** from today's compliance-warning text
     ("Publishing a roster into a jurisdiction and year with nothing
     loaded here is blocked...") — it's load-bearing, not decorative; the
     mockup's softer line was a generic placeholder, not a deliberate copy
     change.
   - Within a filtered (single state+year) view, rows sort by **date
     ascending** (jurisdiction is now fixed by the filter, so that part of
     the old two-key sort no longer applies).
   - Table rows get the same hover-lift affordance as other interactive
     rows/cards elsewhere in the app (CLAUDE.md UI standard).
   - The friendly empty state (T3) is gated by `!showAdd`, same as today's
     existing empty state — if the Add panel is already open, don't also
     show the empty-state block underneath it.

## Responsive

- Desktop/tablet: jurisdiction pills in one row, Year select alongside.
- Mobile (< ~640px): pill row becomes a horizontally-scrollable strip
  (`overflow-x-auto`), same pills, no wrap, no layout branch.
- Mobile (< ~640px): the table (Jurisdiction/Holiday/Date/Tags) scrolls
  horizontally within its own bounded container — same technique as the
  pill row, one pattern reused across both new elements, no separate
  stacked-card or column-dropping layout.

## Interaction State Coverage

| FEATURE            | LOADING              | EMPTY (zero years loaded anywhere) | EMPTY (filtered, no data for this state+year) | ERROR                          | SUCCESS |
|---------------------|-----------------------|----------------------------------|------------------------------------------------|----------------------------------|---------|
| Holiday list        | existing spinner (unchanged); toolbar not rendered yet (matches today's early-return) | Year select falls back to current-year-only; filtering into it lands on the filtered-empty state below (no separate layout) | "No holidays loaded for {state} in {year}" + Add CTA, gated by `!showAdd` | existing retry banner, unchanged; toolbar/filter selection not preserved (matches today's early-return) | table view, footer "Showing N holidays for {state} in {year}", rows sorted by date ascending |
| Add-holiday save    | —                     | —                                | —                                                | existing inline form error, unchanged | active filter auto-switches to the new holiday's jurisdiction+year so it's immediately visible |

## User Journey

```
STEP | USER DOES                        | USER FEELS           | PLAN SPECIFIES?
-----|-----------------------------------|-----------------------|------------------
1    | Opens Public Holidays tab         | Oriented, not buried  | Default NSW/current-year-with-data
2    | Clicks a different state pill     | In control, fast      | Instant client-side filter, no reload
3    | Hits a state/year with no data    | Informed, not stuck   | Context-specific empty state
4    | Adds a holiday (any jurisdiction) | Confident, sees it land | Form defaults to active filter; filter auto-switches to the new holiday on save, so it's visible immediately
```

## State diagram

```
                    ┌─────────────┐
                    │   loading   │  toolbar not rendered
                    └──────┬──────┘  (matches today's early-return)
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
        ┌───────────┐             ┌──────────┐
        │   error    │             │  ready   │
        │ (retry btn)│             └────┬─────┘
        └───────────┘                   │
                                         │  activeFilter = {jurisdiction, year}
                                         ▼
                          ┌──────────────────────────┐
                          │ filteredHolidays = holidays│
                          │   .filter(jurisdiction,year)│
                          └──────────────┬────────────┘
                                          │
                       ┌──────────────────┼───────────────────┐
                       ▼                  ▼                   ▼
                 length > 0         length === 0         length === 0
                 ─────────►          && !showAdd           && showAdd
                 render table      render filtered      render table
                                    EmptyState + CTA      (0-row, header
                                                            only) — Add
                                                            panel is the
                                                            visible CTA

  Add-holiday flow (showAdd = true):
    open (jurisdiction defaults to activeFilter.jurisdiction)
       │
       ▼
    handleAdd() ──validation fails──► formError shown, stays open
       │
       success (createPublicHoliday resolves)
       │
       ▼
    activeFilter ← {created.jurisdiction, year-from(created.holidayDate)}
    holidays ← [...prev, created]           (server-response-derived,
    showAdd = false                          not local form state)
       │
       ▼
    filteredHolidays now includes the new row ─► visible immediately
```

## Test Coverage

No test file exists for this component today (`PublicHolidaysTab.test.tsx`
does not exist). CLAUDE.md requires unit + integration + E2E + edge cases
for new features; this plan brings the component up to that bar rather
than adding untested code on top of an untested base.

```
CODE PATHS                                                    USER FLOWS
[+] PublicHolidaysTab.tsx                                     [+] Load & filter
  ├── load()                                                    ├── [GAP] Default NSW + best-available year on first open
  │   ├── [GAP] loading → ready                                 ├── [GAP] Switch jurisdiction pill → list updates
  │   ├── [GAP] loading → error → retry                         └── [GAP] Switch year select → list updates
  │   └── [GAP] ready, zero years anywhere (brand-new org)     [+] Add holiday
  ├── handleAdd()  [REGRESSION — existing behavior changed]      ├── [GAP] Add matching active filter → appears immediately
  │   ├── [GAP] validation: missing date/name/partial-time        ├── [GAP][→E2E] Add for a DIFFERENT jurisdiction/year →
  │   ├── [GAP] jurisdiction defaults to active filter (NEW)      │         filter auto-switches, row visible (CRITICAL —
  │   └── [GAP][→E2E] success → active filter auto-switches to    │         design review's critical finding)
  │             created.jurisdiction/year (NEW)                 └── [GAP] Save failure → formError shown, panel stays open
  ├── handleDelete()                                            [+] Empty states
  │   ├── [GAP] success → row removed from filtered view          ├── [GAP] Filtered-empty → "No holidays loaded for
  │   └── [GAP] failure → silent no-op (pre-existing, unchanged)  │         {state} in {year}" + Add CTA
  └── filteredHolidays derivation (NEW)                          ├── [GAP] Filtered-empty + showAdd open → EmptyState
      ├── [GAP] jurisdiction + year both match                   │         suppressed, only the Add panel shows
      ├── [GAP] jurisdiction matches, year doesn't (excluded)     └── [GAP] Zero years anywhere → Year select shows
      └── [GAP] sorted date-ascending within the filtered set              current year only, lands on filtered-empty

COVERAGE: 0/17 paths tested (0%) — no test file exists today
QUALITY: (none yet)  |  GAPS: 17 (1 regression, 1 E2E)
```

Legend: [→E2E] = needs integration test | REGRESSION = existing behavior
this plan changes, with no current test coverage — critical per the IRON
RULE (a test is mandatory, not optional, regardless of the E2E-scope
decision below).

**Decided:** RTL/vitest component tests (matching `SettingsLayout.test.tsx`'s
pattern) cover every branch above. One new Playwright spec,
`packages/client/tests/e2e/public-holidays.spec.ts` (matching the existing
per-feature-area convention — `compliance.spec.ts`, `roster-calendar.spec.ts`),
covers the critical journey: load → filter to a state → add a holiday for a
*different* state → confirm the filter auto-switches and the new row is
visible. That flow is the design review's critical finding and the exact
kind of cross-component interaction unit tests are weakest at catching.

## Design tokens (no DESIGN.md — pinned from existing app conventions)

- Jurisdiction filter pills: same pill-tablist pattern as `InventoryPage.tsx`
  and the `SettingsLayout.tsx` Rostering & Compliance strip —
  `role="tablist"` container `bg-dark-50 border border-dark-200 rounded-xl`,
  active pill `bg-gold text-dark` (per the approved mockup's solid-fill
  active state, slightly stronger than the amber-glow-on-dark-bg variant
  used elsewhere — acceptable, same family), inactive `text-dark-600
  hover:text-white hover:bg-dark-100/50`.
- Year control: native `<select>` styled to match existing form selects
  (`bg-dark-100 border border-dark-200 rounded-lg`), not a custom dropdown —
  reuses the browser's own a11y for free (Pass 6).
- Table: replaces the current unlabeled flat `<div>` rows with a real
  `<table>` (header row `JURISDICTION / HOLIDAY / DATE / TAGS`), same
  `rounded-xl border border-dark-200` container as today.
- Tag badges (Regional / partial-day / National / Religious / Local):
  existing `rounded-full border border-gold/30 px-2 py-0.5 text-xs
  text-gold` pattern, unchanged from current component.
- Font: `Inter` (already `body`'s primary font, `globals.css:95-99`) — no
  new typeface.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [x] **T1 (P1, human: ~1.5h / CC: ~20min)** — PublicHolidaysTab — Add jurisdiction pill filter + Year select toolbar, wired to the org's default jurisdiction
  - Surfaced by: Pass 1 (Information Architecture); eng review outside voice (default-jurisdiction sourcing, year tie-break)
  - Files: `packages/client/src/components/roster/PublicHolidaysTab.tsx`; a small new client fetch for the current org's `defaultJurisdiction` (no existing hook exposes it — `LocationContext` already has `organisationId` to call `GET /api/organisations/:id` with)
  - Verify: (a) load tab, confirm the org's `default_jurisdiction` (or NSW if unset) + best-available year (ties prefer future) shown by default; (b) click another state pill, list updates instantly; (c) brand-new org (zero years loaded) shows current year as the only Year option and lands on the filtered-empty state; (d) an org with `default_jurisdiction` set to e.g. VIC opens on VIC, not NSW
- [x] **T2 (P1, human: ~1h / CC: ~15min)** — PublicHolidaysTab — Replace flat row-list with a real `<table>` + footer count line + mobile horizontal scroll + row hover state
  - Surfaced by: Approved mockup (variant C); Pass 5 (Design System Alignment); Pass 6 (a11y — table semantics; mobile — table scroll, found by independent review)
  - Files: `packages/client/src/components/roster/PublicHolidaysTab.tsx`
  - Verify: screen reader announces column headers; footer reads "Showing N holidays for {state} in {year}"; rows sorted date-ascending; 375px viewport scrolls the table horizontally in its own container; row hover state visible
- [x] **T3 (P1, human: ~20min / CC: ~5min)** — PublicHolidaysTab — Context-specific empty state for filtered zero-results, gated by `!showAdd`
  - Surfaced by: Pass 2 (Interaction State Coverage); edge case (Add panel open + filtered-empty) found by independent review
  - Files: `packages/client/src/components/roster/PublicHolidaysTab.tsx`
  - Verify: (a) filter to a state/year with no loaded data, confirm message names the state+year; (b) open Add panel while filtered-empty, confirm the empty-state block does NOT also render underneath it
- [x] **T4 (P1, human: ~30min / CC: ~10min)** — PublicHolidaysTab — Add-holiday form defaults to active filter; active filter auto-switches to the saved holiday on success
  - Surfaced by: Pass 7 (form default); CRITICAL invisible-add-after-save gap found by independent review
  - Files: `packages/client/src/components/roster/PublicHolidaysTab.tsx`
  - Verify: (a) filter to VIC, click Add holiday, confirm jurisdiction dropdown opens on VIC; (b) add a holiday for a DIFFERENT jurisdiction/year than the active filter, confirm the filter switches to match and the new row is visible immediately, not silently hidden
- [x] **T5 (P2, human: ~20min / CC: ~10min)** — PublicHolidaysTab — Mobile horizontal-scroll for jurisdiction pill row
  - Surfaced by: Pass 6 (Responsive)
  - Files: `packages/client/src/components/roster/PublicHolidaysTab.tsx`
  - Verify: 375px viewport, all 8 pills reachable via horizontal scroll, no wrap
- [x] **T7 (P1, human: ~30min / CC: ~10min)** — PublicHolidaysTab — Regression test for `handleAdd`'s changed behavior
  - Surfaced by: eng review Test section — IRON RULE (existing behavior modified, zero prior coverage)
  - Files: `packages/client/src/components/roster/PublicHolidaysTab.test.tsx` (new)
  - Verify: `pnpm --filter @culinaire/client test PublicHolidaysTab`
- [x] **T8 (P1, human: ~2h / CC: ~30min)** — PublicHolidaysTab — Full RTL component test suite (all 17 diagrammed paths)
  - Surfaced by: eng review Test section — 0% existing coverage, CLAUDE.md testing mandate
  - Files: `packages/client/src/components/roster/PublicHolidaysTab.test.tsx`
  - Verify: `pnpm --filter @culinaire/client test PublicHolidaysTab`
- [x] **T9 (P1, human: ~45min / CC: ~15min)** — E2E — Critical-journey Playwright spec
  - Surfaced by: eng review Test section — auto-switch-on-save is the design review's critical finding
  - Files: `packages/client/tests/e2e/public-holidays.spec.ts` (new)
  - Verify: `pnpm --filter @culinaire/client test:e2e public-holidays`
- [ ] **T6 (P3, deferred — separate PR)** — cross-app — Pill/tab touch-target sweep + extract shared `PillTabs` component (13 instances, 10 files, 3 near-identical copies by the time this PR lands)
  - Surfaced by: design review Pass 6 (Responsive & Accessibility); eng review Code Quality (DRY — 3rd copy of the pill-tablist pattern)
  - Files: see `tasks/todo.md` entry (2026-09-20)
  - Verify: n/a — tracked, not built in this PR

## Failure modes

| Codepath | Realistic failure | Test? | Error handling? | User sees |
|---|---|---|---|---|
| `load()` | Network error / API 500 | Yes (T8) | Yes (existing retry banner) | Clear retry UI |
| `handleAdd()` save | API rejects (validation, 409, network) | Yes (T7/T8) | Yes (existing inline `formError`) | Clear inline error, form stays open |
| Auto-switch-on-save | `created.holidayDate` unparseable for year (shouldn't happen — `handleAdd` already validates date before calling create) | Yes (T7) | Guarded upstream by existing validation | N/A — guarded, not reachable |
| Year select, zero years loaded | Empty array to populate from | Yes (T8) | Explicit fallback (current year) | Filtered-empty state with Add CTA — not a blank/broken dropdown |
| `handleDelete()` failure | Network error | No — pre-existing gap, unchanged by this plan | Silent no-op (existing `ponytail:` comment) | **Silent failure** — pre-existing, not introduced by this plan |

No new critical gap (all new codepaths have a test + explicit handling).
The one silent-failure row (`handleDelete`) is pre-existing behavior this
plan does not touch — flagged for visibility, not blocking, since fixing
it is unrelated scope (would need a toast system this app doesn't have,
per the independent design review's same observation).

## Worktree parallelization strategy

Sequential implementation, no parallelization opportunity. Single primary
file (`PublicHolidaysTab.tsx`) plus one dependent new E2E spec — no
independent workstreams to split across worktrees.

## Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | No DESIGN.md; UI scope: PublicHolidaysTab   |
  | Step 0               | 2/10 initial — full 7-pass review chosen    |
  | Pass 1  (Info Arch)  | 6/10 → 10/10 → 10/10 (year-default          |
  |                       | contradiction caught + fixed post-hoc by    |
  |                       | independent review — see below)             |
  | Pass 2  (States)     | n/a  → 9/10 → 10/10 (empty-Year-select +    |
  |                       | Add-panel-open edge case, invisible-add fix)|
  | Pass 3  (Journey)    | 8/10 → 9/10 (journey table's self-          |
  |                       | contradiction on T4 corrected)              |
  | Pass 4  (AI Slop)    | 9/10 (no hard rejections, no issues)        |
  | Pass 5  (Design Sys) | n/a  → 9/10 after token mapping             |
  | Pass 6  (Responsive) | 4/10 → 8/10 → 10/10 (table had no mobile    |
  |                       | spec — found by independent review, fixed)  |
  | Pass 7  (Decisions)  | 7 resolved, 0 deferred                      |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (4 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 1 item added (tasks/todo.md)                |
  | Approved Mockups     | 3 generated, 1 approved (variant C)         |
  | Decisions made       | 13 added to plan                            |
  | Decisions deferred   | 0                                           |
  | Overall design score | 2/10 → 8/10 (native pass) → 9/10 (after     |
  |                       | independent review's findings applied)      |
  +====================================================================+
```

Overall score is the lowest of passes 1-6 (Pass 3 at 9/10). All rated
passes are 8+; 0 unresolved decisions. **Note:** the native review's
initial "8/10, clean" self-assessment was optimistic — the independent
Claude-subagent design voice (see Outside Voices below) found 2 critical
gaps (year-default contradiction; invisible add-after-save when it lands
outside the active filter) and 2 high-severity gaps (empty Year-select for
a brand-new org; the new table had zero mobile spec) that the native
passes had missed or under-scored. All were resolved above before this
review closed.

## Outside Voices

**Design review pass:**
- **Codex:** unavailable — CLI present (codex-cli 0.155.1) but not
  authenticated (401 Unauthorized on `codex exec`). Did not run `codex
  login` or attempt any workaround. Missing coverage from this provider.
- **Claude subagent (independent, no memory of this review's decisions):**
  completed. Found 2 critical, 2 high, 2 medium findings — all resolved
  above (issues 7-12). Recommendation given: "revise-before-build" for the
  year-default contradiction and invisible-add-after-save gap, both fixed.

**Eng review pass:**
- **Codex:** unavailable — same as above (`not_authed`, verified via the
  probe script, not re-attempted).
- **Claude subagent (independent, no memory of this review's decisions):**
  completed. Found 4 items, presented as Cross-Model Tension below.
  Recommendation given: "revise-before-build" for the default-jurisdiction
  gap specifically (verified, concrete, with a known existing fix).

### Cross-Model Tension (eng review outside voice)

| # | Topic | Review said | Outside voice said | Resolution |
|---|---|---|---|---|
| 1 | Jurisdiction default | Hardcode NSW | Use `organisation.default_jurisdiction` (exists, unused) | **Adopted** — wire it up (T1) |
| 2 | Year tie-break | Unresolved (gap) | Needs an explicit rule | **Adopted** — prefer future year on ties |
| 3 | Auto-switch friction | Not evaluated as a cost | Yanks admin out of flow on deliberate cross-jurisdiction entry | **Rejected** — kept as-is; real but rare, payoff outweighs cost |
| 4 | Table-rebuild scope | Approved via mockup (variant C, 5/5) | Disproportionate to the page's own "once a year" usage pattern | **Rejected** — kept the already-approved scope; not new information, a general minimalism argument against a decision already made with the visual in hand |

All four were presented individually via AskUserQuestion; none were
auto-incorporated. 2 adopted, 2 rejected — both rejections were the
user's explicit call, not overridden.

## Unresolved Decisions

NO UNRESOLVED DECISIONS

## Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|----------------|-------------|-----------|-------|
| Public Holidays (filtered) | /home/robangeles/.gstack/projects/robertangeles-cc-culinaire-kitchen/designs/public-holidays-filters-20260920/variant-C.png | Jurisdiction pill row + Year dropdown toolbar; proper table (Jurisdiction/Holiday/Date/Tags columns) instead of the current unlabeled flat rows; footer count line "Showing N holidays for X in YYYY" | User: "clean and elegant", 5/5. Approved as the visual reference. |

## NOT in scope

- Server-side filtering/pagination (dataset too small to need it).
- Bulk-load / auto-populate holidays (explicitly out of scope per this
  component's own doc comment — "no bulk auto-population").
- An "All jurisdictions" combined view (decided against — single-select only).
- Project-wide pill/tab touch-target sizing (~36px, below the 44px
  guideline) — spans 13 `role="tab"` instances across 10 files (Inventory,
  Roster, Profile ×3, Settings ×3, Purchasing, Organisation, Brain), none
  of which are part of this feature. Decided: own follow-up PR, not
  bundled here (see `tasks/todo.md`).

## Eng Review Completion Summary

- Step 0: Scope Challenge — scope accepted as-is (1 file, 0 new services, below the 8-file/2-service complexity threshold; no STOP triggered)
- Architecture Review: 1 issue found (missing state diagram) — resolved, diagram added
- Code Quality Review: 1 issue found (DRY — 3rd pill-tablist copy) — resolved, deferred to already-planned T6
- Test Review: diagram produced, 17 gaps identified — all folded into T7/T8/T9
- Performance Review: 0 issues found
- NOT in scope: written (unchanged from design review, still accurate)
- What already exists: written (unchanged from design review, still accurate)
- TODOS.md updates: 1 item extended (T6 now also covers PillTabs extraction)
- Failure modes: 0 critical gaps (1 pre-existing silent-failure noted, not introduced by this plan)
- Outside voice: ran (Claude subagent — Codex unavailable, not_authed) — 4 cross-model tension points, 2 adopted, 2 rejected (both user's explicit call)
- Parallelization: sequential, no parallelization opportunity (single primary file)
- Lake Score: 2/2 — both decisions comparing a complete option vs. a shortcut (DRY extraction now vs. deferred; default-jurisdiction wiring vs. hardcoded NSW) chose towards completeness where it mattered (deferred DRY to the already-scheduled sweep — not a shortcut, a sequencing call; adopted the real default-jurisdiction fix rather than shipping known-wrong behavior)
- Unresolved decisions: 0

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run — small, clearly-scoped UI fix, no product-direction ambiguity |
| Outside Review | Codex (unavailable, 401 auth, not_authed) + independent Claude subagent | Independent 2nd opinion | 2 | PARTIAL | Design pass: 2 critical + 2 high + 2 medium findings, all resolved. Eng pass: 4 cross-model tension points, 2 adopted (org default_jurisdiction wiring, year tie-break) + 2 rejected (user's explicit call) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 2 issues found (state diagram, DRY-deferred) + 0% → full test plan (17 paths, regression test, E2E spec), all resolved |
| Design Review | `/plan-design-review` | UI/UX gaps | 2 | CLEAR | score: 2/10 → 9/10, 13 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

- **OUTSIDE COVERAGE:** Codex — attempted twice (design pass, eng pass), unavailable both times (401 Unauthorized / not_authed; no workaround attempted). Claude subagent — completed both passes, independent (no memory of the review's own decisions each time). All findings folded into the plan above before close.
- **CROSS-MODEL:** not applicable for either pass — only one voice (Claude subagent) completed each time; Codex never produced output to compare against.
- **VERDICT:** DESIGN + ENG CLEARED — ready to implement.

NO UNRESOLVED DECISIONS
