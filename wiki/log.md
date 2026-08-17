# Wiki Session Log

Append-only. Newest entry on top.

---

## 2026-08-17 — Phase 3 Slice 3 shipped: shift swap — Phase 3 (Workforce Optimisation) complete

- `feature/ck-web/workforce-shift-swap`: new `shift_swap_request` table + `services/shiftSwapService.ts`
  — peer-to-peer swap marketplace, no manager-approval step. `offerSwap` (own Confirmed
  assignment only), `listOpenSwaps` (org-wide browse), `claimSwap` (atomic conditional
  `UPDATE ... WHERE status='Open'` inside the same transaction as the assignment transfer —
  the losing side of a concurrent claim gets zero rows back and rolls back cleanly, no
  advisory lock needed), `cancelSwap` (offerer-only, still-Open only).
- `assignStaff`'s Draft-only guard deliberately does NOT apply to a claim — that guard exists
  so `publishRoster()` stays the only place a *fresh* assignment's s.114 consent gate fires.
  A swap claim replaces an already-Published assignment, so it's its own dedicated
  delete-then-insert path inside one transaction, not a call through `assignStaff`.
- Public-holiday consent needed zero new logic: a successful claim into an
  `isPublicHoliday` shift calls the existing `consentService.requestConsent()` directly, so
  the new assignee gets the identical Accept/Decline banner `MyShiftsView.tsx` already
  renders for any `"Requested"` consent — never inherited from the person who offered.
- **Real bug caught by my own integration test before it ever reached review**: the initial
  `claimSwap` returned the assignment row captured *before* calling `requestConsent()`, so a
  caller claiming a public-holiday shift saw `publicHolidayConsent: null` instead of
  `"Requested"` — `requestConsent`'s own UPDATE never made it back to the caller. Fixed by
  returning `requestConsent`'s result directly when the shift is a public holiday.
- Exported `getRequirementsForRole` and `getHeldDocuments` from `rosterService.ts` (both were
  private) so the swap-claim gate reuses the exact same `canAssign` resolution path
  `assignStaff`/`publishRoster` already use, rather than a third reimplementation — Slice 2's
  `staffingCoverageService.ts` reimplemented a *batched* multi-user version for its own
  reasons, but a swap claim only ever checks one candidate, so reusing the existing
  single-user functions was the right call here.
- Verified via 7 integration tests: offer→claim happy path (including the self-claim and
  cross-org 404 guards), claim blocked by `canAssign` with the verbatim `refusalMessage()`
  text, two concurrent claims on the same swap (exactly one wins, proven against the real DB
  under `Promise.allSettled`), the public-holiday consent-reset case, offerer cancel, and a
  non-offerer's cancel attempt 404ing. Also found and cleaned up ~2 unrelated orphaned-fixture
  rows left over in dev from an earlier session's aborted `publicHolidayService.integration.test.ts`
  run — pre-existing pollution, not caused by this slice, but it was failing the full suite
  until cleaned up.
- Client: `MyShiftsView.tsx` gets an "Offer to swap" / "Cancel swap offer" button on
  `Confirmed` rows and a flat "Open swaps" list below it with a Claim button for everyone
  else's open offers — no new tab, no new page, matching the plan. Verified live against dev
  (offer → button flips to Cancel → cancel → flips back), zero console errors.
- Phase 3 (Workforce Optimisation) is now fully shipped: demand forecasting (Slice 1),
  coverage heat map (Slice 2), shift swap (Slice 3). Updated [[workforce-optimisation]].

## 2026-08-17 — Phase 3 Slice 2 shipped: coverage heat map + skill coverage

- `feature/ck-web/workforce-coverage-heatmap`: `services/staffingCoverageService.ts` — a
  day x role coverage grid for one venue, cell = rostered hours coloured by the worst
  compliance status among its assignees. Skill coverage reuses `roster_role_document` +
  the existing `canAssign` gate generically (no hardcoded "RSA"/"FSS" strings, no "alcohol
  shift" flag) — same design call the plan locked in before building this slice.
- **Self-caught bug, before it ever reached review**: the worst-status accumulator seeded
  each new cell at `"unstaffed"` (the worst severity) and only ever escalated UP in
  severity — meaning nothing could ever override the seed, so every cell read "unstaffed"
  regardless of what its shifts actually said. Found by my own integration test failing
  ("expected ok, got unstaffed" on a cell I'd seeded with a fully-compliant assignee), not
  by pr-reviewer. Fixed by seeding at `"ok"` (the best) instead. `refusalMessage()` in
  `rosterService.ts` was exported (previously private) so the cell detail text reuses the
  exact wording a live assignment refusal already shows, rather than a second copy.
- 4 fixed batched queries per screen-load regardless of grid size (shifts+role+assignments,
  role-document requirements, expiry rules, held documents for every distinct assignee) —
  `canAssign` then runs purely in memory, same "dashboard needs O(1) queries, not O(N)"
  discipline `complianceService.ts`'s dashboard already established.
- Verified via 4 integration tests (worst-of-cell computation across ok/missing/unstaffed,
  a multi-assignee-same-shift hours-dedup check, summary/grid reconciliation, 400/404
  boundaries) plus live browser QA against dev — grid cells, colours, and the summary stat
  row all matched a hand-seeded 3-shift fixture exactly.
- Updated [[workforce-optimisation]] with the design, the seed-bug story, and a documented
  known gap (no per-venue jurisdiction resolution yet, so a state-specific expiry-rule
  override is invisible to this screen — acceptable for an advisory heat map, flagged for
  later). Slice 3 (shift swap) is the only piece of Phase 3 left.

## 2026-08-17 — Phase 3 (Workforce Optimisation) planned + Slice 1 shipped

- Ran the same planning rigor Phase 2 got: 3 parallel Explore agents against the current
  codebase (not the original spec's assumptions) surfaced a load-bearing gap the original
  plan didn't anticipate — `prep_task.station` (kitchen-area vocabulary) and
  `roster_role.roleName` (free-text per org) are independently-typed vocabularies with no
  mapping between them anywhere in the schema, so "recommended hours per role" can't be
  computed directly from "station task load" as the original spec assumed.
- User-confirmed 3 real product decisions before locking the plan: (1) `sale` data dropped
  from v1 demand — no formula anywhere converts sale volume to labour-hours, inventing one
  would be a guess; (2) day-level granularity, not shift-window — `prep_session.prepDate`
  is a bare date, no AM/PM concept exists in Phase 1/2; (3) shift swap is peer-to-peer,
  `canAssign` is the only gate, no manager-approval step.
- Wrote the full "Phase 3 Execution Plan" into the plan file: 3 slices (demand forecasting →
  coverage heat map ‖ shift swap, the latter two independent once the shared router lands),
  each with concrete schema/query/formula decisions, no padding to match Phase 2's slice
  count.
- **Slice 1 shipped** (`feature/ck-web/workforce-demand-forecast`): `services/
  workforceDemandService.ts` reports demand per station (not role, per the gap above),
  two new pure formulas added to the existing `forecastMath.ts` (`minutesPerCover`,
  `recommendedStationHours`), reuses `forecastConfidence` verbatim. Reuses the
  `workforce_enabled` flag already seeded from Phase 2 Slice 0. Verified live against dev:
  seeded 3 days of prep history + a target session, confirmed the rendered recommended-hours
  and confidence percentage matched the formula exactly (2.5h, 10% confidence, 3d history).
- Wrote up the module in [[workforce-optimisation]] (new entity page), cross-linked from
  [[roster-core]]. Slices 2 (coverage heat map) and 3 (shift swap) not yet started.

## 2026-08-17 — Roster Core Phase 2 complete: Slice 7 (s.114 consent workflow)

- `feature/ck-web/public-holiday-consent`: `services/consentService.ts` (`requestConsent`/`respondToConsent`),
  a `publicHolidayConsent` state machine already present on `shift_assignment` since Slice 2's original
  schema (no new migration needed — confirmed on both dev and prod before starting). `publishRoster()`
  now holds — never blocks — a public-holiday shift whose assignees haven't all accepted, reading
  consent straight off the assignment rows it already fetches for the `canAssign` re-check (no extra
  query). This closes out Phase 2 — all of T12–T16 from the original plan are now shipped.
- **Real bug caught before it shipped**: `NotificationType` members `PUBLIC_HOLIDAY_CONSENT_REQUESTED`/
  `_DECLINED` (32/31 chars) exceed `notification.type`'s `varchar(30)` — a Postgres error at insert time,
  invisible to `tsc`. Only surfaced when the live integration suite actually ran the insert. Renamed to
  `HOLIDAY_CONSENT_REQUESTED`/`_DECLINED`. Lesson: a DB column-length constraint is not something the
  type system can catch — a string-literal union type only proves the value is one of the allowed
  strings, never that it fits the column.
- 25 integration tests (request/respond state machine, ownership, audit-log actions, three publish-hold
  outcomes: never-asked, declined, accepted) — all passing against the live dev DB, alongside a full
  live browser QA pass (Settings → Public Holidays loader → assign → request consent → staff sees a
  distinct Accept/Decline prompt in `MyShiftsView.tsx` → decline → publish holds the shift with the
  exact reason text → re-request → accept → publish succeeds).
- Wrote up the whole workflow in [[roster-core]] and closed its stale "Slice 7 not built yet" limit.
  Documented the still-open, module-wide (not Slice-7-specific) gap: no Playwright E2E exists for any
  Roster Core flow across Slices 2–7 — every slice this session was verified via live browser QA
  instead, matching established practice rather than introducing new E2E CI infrastructure mid-slice.

## 2026-08-16 — Roster Core (Phase 2, Slices 0–6) built and documented

- Slices 0–5 (flags, Antoine tool, roster schema + `canAssign`, roster service/routes, Award
  engine shipped empty, roster builder + publish UI) shipped to production this session,
  PRs #94–#98. Slice 6 (`feature/ck-web/public-holiday-calendar`) adds the `public_holiday`
  table, `isPublicHoliday`/`isYearLoaded`, a daily gap-check job reusing `claimDailyRun`
  verbatim, an admin loader Settings tab, and a fail-loud whole-publish block when a venue's
  jurisdiction+year isn't loaded.
- **Self-caught correctness bug, fixed before it shipped**: `publishRoster()`'s
  `isPublicHoliday` computation originally read a shift's calendar date via
  `startDatetime.toISOString().slice(0, 10)` — always UTC, so an early-local-morning AU
  shift resolves to the *previous* UTC calendar day. Fixed with `toVenueLocalDate()`, which
  reads the instant back in `store_location.iana_timezone` via `Intl.DateTimeFormat`.
  Verified against the live dev DB: an integration test using an explicit `+11:00`
  (AEDT) offset — deliberately avoiding a bare local-format string, which would parse in
  the *test runner's* timezone and silently stop exercising the bug in a UTC-based CI
  runner — now passes; it failed before the fix.
- Wrote [[roster-core]] (new entity page) covering the full Phase 2 data model, the
  `canAssign` gate, the Award engine's "shipped empty, coverage disclosed" design, and the
  public-holiday fail-loud block. Corrected [[staff-compliance-vault]]'s stale "Phase 2
  blocked on naming an `award_rule` owner" line — that blocker was resolved by shipping the
  engine with zero rules seeded rather than waiting on an IR-competent reviewer.
- Slice 7 (s.114 consent workflow) is the one remaining piece of Phase 2.

## 2026-08-07 — Documented the Staff Compliance Vault (Phase 1)

- Wrote up `feature/ck-web/compliance-vault` (Phase 1 of the CEO-reviewed three-phase
  compliance/rostering plan): one entity page, one concept page, two decision pages. Wiki-only
  session — no source code touched.
- [[staff-compliance-vault]] — the vault as a whole: schema (`compliance_document`,
  `document_expiry_rule` + alert-day junction, `document_access_log`,
  `organisation_required_document`), the tenancy model (`organisation_id` + nullable
  `store_location_id`, no separate `venue_id`), the two subject CHECK constraints — including
  why the venue-scope CHECK's `IS NOT NULL` term is load-bearing (Postgres only violates a
  CHECK on FALSE; `NULL = uuid` passes), services/routes/permissions, and known limits stated
  without euphemism: Phase 2 is *blocked*, not merely unbuilt, on naming an `award_rule` owner;
  no admin UI exists yet for the expiry-rule editor; and the real Cloudinary upload/preview
  path is untested against a live account because `documentStorageService.test.ts` mocks the
  `cloudinary` module entirely.
- [[document-storage-cloudinary-private]] — why `documentStorageService.ts` must never call
  `middleware/upload.ts`'s `uploadFileBuffer` (silent fallback to an unauthenticated
  `/uploads/` directory — a notifiable breach for a police check, one missing env var away,
  nothing in the logs), the 120-second signed-URL TTL against Cloudinary's 1-hour default and
  its "issue on click, never prefetch a list" consequence, encryption-at-rest as an accepted
  deviation (Cloudinary holds the key, not us — "Cloudinary and us" is the honest answer to a
  procurement question), and why `document_access_log` records denials, not just grants.
- [[scheduled-job-daily-claim]] — the one-statement conditional `UPDATE` that is simultaneously
  the cross-instance mutex, the restart-safe day guard, and the admin-visible heartbeat; why
  `withAdvisoryLock` was rejected (its `fn` never receives `tx`, so it buys no atomicity — only
  a pool connection held idle for an 18k-row scan); and why a JS variable was rejected (Render
  redeploys reset it, so a deploy inside the run window re-fires the job).
- [[compliance-expiry-engine]] — the pure `computeExpiryActions` decision tree
  (`complianceExpiryMath.ts`), how `complianceExpiryJob.ts` wires it to notifications without
  double-sending, and the dashboard's reconciliation fix: the headline aggregate and the
  per-staff matrix both resolve to the SAME best-document-per-type (`LEFT JOIN LATERAL`,
  verified-and-current beats pending beats everything else) against the SAME clock
  (`CURRENT_DATE` in SQL, not `new Date()` in JS twice), so a renewed certificate can never make
  "24 of 25 compliant" disagree with the table underneath it — a bug the design review's own
  mockup was built to call out.
- Added all four pages to `wiki/index.md` (Entities, Concepts, Decisions). Ran
  `node scripts/wiki-graph.mjs build` and `pnpm wiki:lint` — see the task report for exact
  output; no contradictions found with existing pages.

## 2026-08-02 — Receiving walked end to end in a browser: 3 more bugs fixed, HEPHAESTUS open items closed

- **`startSession` still dead-ended on the mirror-image inconsistent state.** The 2026-08-01 fix
  resumed an ACTIVE session only when the PO read `RECEIVING`. The DB also produces the inverse —
  PO `SENT` with an ACTIVE session — because `cancelSession` resets the PO to `SENT`
  unconditionally, so cancelling one half of a pre-lock race pair leaves its sibling ACTIVE.
  `PO-MRUH46AZ` was sitting in exactly that state (5 sessions: 4 CANCELLED + 1 ACTIVE, the race
  pair 10 ms apart at `05:12:46.842` / `.852`), which is what threw *"A receiving session is
  already in progress for this PO"*. Fixed by looking the ACTIVE session up **before** branching
  on PO status, so either direction of disagreement resumes and repairs the status on the way.
  The dead-end throw is gone. Lesson: a fix that guards one direction of a two-way inconsistency
  is half a fix — enumerate both.
- **Every delivery receipt 500'd** (*"Internal server error"* on Confirm Receipt). Root cause was
  NOT in receiving at all: `wacService.recompute` interpolated a JS `Date` into a raw ``sql`` ``
  template. Raw SQL carries no column type information, so Drizzle handed the Date straight to
  the `postgres` driver, which called `Buffer.byteLength()` on it →
  `ERR_INVALID_ARG_TYPE: ... Received an instance of Date`. Drizzle's *typed* builder
  (`.set({ x: new Date() })`) serialises Dates correctly, which is why every other write in the
  flow worked and only this one statement broke. Now bound as `${nowIso}::timestamptz`, matching
  the convention already used by the raw date filters in `ingredientService`. Swept the whole
  server for the same class — `wacService` was the only offender; every other date-ish
  interpolation is either a Drizzle column reference or an ISO string with an explicit cast.
- **Stale Receive queue and tab badge.** Neither refetched after a receipt: `onBack` only cleared
  local state, so a confirmed delivery stayed in the list, and `PurchasingPage` holds its *own*
  `usePurchaseOrders` instance so the badge kept its own stale copy. `ReceiveQueue` now refreshes
  on exit and notifies the parent via an `onChanged` prop. Also: the badge counted only `SENT`
  while the queue lists `SENT` *and* `RECEIVING`, so an in-progress delivery vanished from the
  badge while still sitting in the tab — both now agree.
- **Closed both HEPHAESTUS open items.** The `pg_advisory_xact_lock` fix is now verified under
  real concurrency (two simultaneous `startSession` calls against the real dev DB returned the
  same session, no second row), and the orphaned `PO-MRUH46AZ` session is resolved — it is
  `RECEIVED` and clean.
- **Full browser walk** (Purchasing → Receive → open → mark Short → Confirm) on a real PO:
  session resumed across a full page reload with the Short action persisted (line showed
  "Short: 2.0", total recalculated, "1 issue" badges), confirm returned 200, and stock/WAC/FIFO
  all moved correctly — Plain Flour 166.8 → 216.8 kg, Chicken 15 → 17 kg @ WAC 12.0000, PO →
  `PARTIAL_RECEIVED`, queue and badge both cleared without a reload.
- Added `wacService.test.ts` (no coverage existed) asserting no `Date` is ever bound into a raw
  sql template and that the timestamp binds as ISO 8601; plus two `receivingService` tests for
  the resume path and the terminal-status rejection. All four fail without their fix.
- Left alone deliberately: `cancelSession` resetting the PO unconditionally is now unreachable-
  harmful, since the advisory lock prevents sibling sessions from existing at all.

### Deep-links were dead across every notification path; history rows now navigate

- **Audit first, on the user's instruction** — I had started coding a fix before inventorying the
  current state and was pulled up on it. The audit found more than the original question:
  | Link | Emitted by | Problem |
  |---|---|---|
  | `/inventory?tab=purchase-orders&po=` | PO approval email ×2, discrepancy alert email, notification bell | Route ignored query params entirely; POs had moved to `/purchasing`; `purchase-orders` was not a tab key on either page |
  | `/waste` | weekly waste digest | **Route does not exist** — the digest's only CTA landed every recipient on NotFoundPage |
  Only `ResetPasswordPage` and `VerifyEmailPage` read query params anywhere in the app.
- **Fixed:** `/purchasing` and `/inventory` now read deep-link params (`?tab=`, `?po=`; and for
  inventory a sub-view level, `?view=`/`?transfer=`, since a transfer lives at tab `log` →
  sub-view `transfers`). Unknown values are ignored rather than applied, so a stale URL falls back
  to the default instead of rendering an empty tab. All 5 links corrected.
- **History rows are now clickable** where a destination exists. `TransactionEvent` gained a
  generic `link: string | null` decided server-side; the UI renders a chevron and hover state
  strictly where it is set, so no row ever looks interactive and does nothing.
- **Audit of the other event types** (what shipped and what deliberately did not):
  - `receipt` → `/purchasing?tab=orders&po=` ✅
  - `transfer_loc` → `/inventory?tab=log&view=transfers&transfer=` ✅
  - `stock_take` — destination is HQ-only (`inventory:hq`); linking a chef into a 403 is worse
    than no link. Needs a permission-aware link. **Not built.**
  - `movement`, `transfer` (usage) — only entry FORMS exist, no browsable list to land on.
    Linking would drop the user on a blank form. **Needs a list built first.**
- **Two bugs found by verifying rather than assuming:** a deep-linked transfer row opened straight
  onto "No details available" (the detail fetch lived inside `toggleExpand`, which never runs when
  a row starts expanded — now fetched on mount); and my own script asserted 2 TransferRow call
  sites when there are 3, which aborted the edit before writing rather than silently half-applying.
- **Process failure worth recording:** I ran `git checkout --` on `PurchaseOrderList.tsx` to undo
  one premature edit and destroyed two *other* uncommitted changes in that file from earlier the
  same session (the receipt header and the actual-cost arrow). Caught only because a verification
  screenshot showed the header missing. Restored and re-verified. Reverting a whole file to undo
  part of it is unsafe while other work in it is uncommitted.

### The "flaky brain tests" were a live dev server racing the suite — scheduled jobs now gated

- Six real-DB tests had been failing intermittently and written off as flaky. Three distinct causes:
  1. **Five were `Test timed out in 5000ms`.** The dev DB moved from local Postgres to remote
     Render; every query now pays ~200ms+ latency and vitest's 5s default was sized for local.
     (The config comment still claimed "one local Postgres".) Raised `testTimeout`/`hookTimeout`
     to 30s. Mocked tests are unaffected — they finish in ms either way.
  2. **One was a sleep pretending to be synchronisation.** `advisoryLock.test.ts` fired two calls
     via `Promise.all` and had the winner sleep 150ms. A probe measured the second transaction
     opening **216ms** later — the first committed and released before the second began, so both
     acquired legitimately and `runs === 2`. The lock was never broken; the test was. Replaced with
     an explicit handshake.
  3. **The residual intermittent was `pnpm dev` itself.** The failing assertion was
     `expected 0 to be greater than 0` — the test counted the pending `brain_memory` rows it had
     just seeded and found none. The dev server runs `runBrainWorkerTick()` **every 15 seconds**
     against the same shared dev database and had claimed and embedded them mid-test.
- **Fix:** all 10 scheduled jobs now gate on `isProductionProcess()` — ON in production, OFF
  everywhere else, `ENABLE_SCHEDULED_JOBS=1` to override. Safe because that predicate is the same
  one `assertSafeDbHost` uses as its prod hard rail: a production deploy satisfying neither
  `NODE_ENV=production` nor `APP_ENV=prod` could not connect to its own database at all, so this
  cannot silently disable prod jobs. Extracted to `envShim` as one definition with 5 unit tests
  covering both directions, including near-misses (`NODE_ENV=prod`, `APP_ENV=production`).
- **Proven, not asserted:** a hand-inserted pending row stayed `pending` / `attempt_count=0` for
  40s with the dev server live (previously claimed within 15s), then **5 consecutive full-suite
  runs at 674/674**. Was ~40% failure across 7 runs.
- **One wrong fix shipped first and was caught by baselining.** I hypothesised foreign pending rows
  and wrote a helper to park them for each suite. Measured: the paired repro went from 29/29
  passing to 4 failures. Reverted. The only reason I knew is that I re-ran the same command with
  the change stashed rather than trusting that the file passed in isolation.

### Real-DB integrity checks — closing the blind spot that let five defects through

- **The user's criticism was correct**: five defects surfaced in one session while 660 tests
  stayed green. The common cause is not five separate oversights — it is that every test mocks
  the database, so the suite verifies what code does with a fake and never what the live system
  actually is. A mock cannot see a PO that is `SENT` while holding an ACTIVE receiving session.
- **`scripts/checkCatalogIntegrity.ts`** — 8 invariant checks, pure SQL, run against a real DB:
  1. `po-status-matches-receiving-session` — a PO is RECEIVING iff it has an ACTIVE session
  2. `one-active-session-per-po` — the pre-advisory-lock race
  3. `every-ingredient-has-a-cost`
  4. `preferred-supplier-link-has-cost` — the trigger's only input
  5. `preferred-cost-matches-trigger-source` — **the drift check the schema promised in
     `serverIndex` and which was never actually written**
  6. `received-po-lines-have-actual-cost`
  7. `stock-never-negative` — `deductStock` decrements with no floor
  8. `fifo-batches-cover-stock-on-hand` (warn)
  Each check states its invariant AND names the incident it prevents, so a future failure
  explains itself. `warn` severity keeps a legitimately-degraded state (uncosted opening stock)
  from training anyone to ignore red. Exposed as `pnpm --filter @culinaire/server db:check`.
- **Proven to fire, not just to pass.** Injected both a `SENT`-PO-with-ACTIVE-session and a
  `preferred_unit_cost` drift inside a transaction, confirmed each check returned exactly one
  offender, then rolled back. A check that has only ever passed is decoration.
- **`checkCatalogIntegrity.test.ts`** fails CI on any `error`-severity violation, asserts at
  least 8 checks exist (so the suite cannot pass vacuously if checks are deleted), and prints the
  invariant + prevented incident in the failure message.
- **Result: 7/8 pass, 0 errors, 1 warn** (222 rows of seeded opening stock with no FIFO layer —
  known and expected until an opening-cost backfill runs).

### Yield variance was reporting a fictional 100% favourable variance on every dish

- `yieldVarianceService` summed actual cost with `COALESCE(i.preferred_unit_cost, 0)`. That column
  is trigger-maintained from `ingredient_supplier.cost_per_unit`, which was NULL catalog-wide, so
  actual cost summed to **$0** and every dish looked 100% under theoretical. Every sibling
  consumer (`orderGuideService`, `menuIntelligenceService`, `saleService`) coalesces to
  `unit_cost`; only this path coalesced to zero.
- Fixed to fall back `preferred_unit_cost → unit_cost`, and to count rows where both are null. Any
  such row now returns a new `"uncosted"` status instead of publishing an understated variance —
  same honest-empty-state philosophy as the existing `"thin-data"`. Two regression tests added;
  the `uncosted` one fails without the fix (verified by stashing).

### preferred_unit_cost was starved, not broken — fed via its trigger

- The column is owned by `fn_recompute_preferred_supplier_cost`, which copies `cost_per_unit` from
  the ingredient's preferred `ingredient_supplier` row. 92 ingredients had `preferred_supplier_id`
  populated but 0 had a cost — proving the trigger fired 94 times and cached NULL each time,
  because the 2026-07-14 import created link rows with `(ingredient_id, supplier_id,
  preferred_ind)` and no price.
- `seedCatalogCosts.ts` now also writes `ingredient_supplier.cost_per_unit` (94 links) and lets
  the trigger cascade — app code still never touches `preferred_unit_cost`, per the schema's
  explicit instruction. `preferred_unit_cost` went 0 → 92 populated with no direct write, which
  also closes the "no per-supplier pricing" gap.

### Catalog costs researched and given provenance for the first time

- **The catalog's pricing had no recorded provenance.** Asked whether a cost-research pass had
  ever run, the answer was no. The 2026-07-14 supplier-catalog import
  (`data/imports/pfd-batch-01.csv` + `import-batch-01.sql`) carried names, categories, units and
  94 supplier links but **zero prices** — `unit_cost` appears 0 times in that SQL. Yet 107 items
  had a cost stamped that same day by a step whose artifacts were never committed. Only the 17
  wines had real provenance (`wine-batch-02.csv`, actual bottle prices from the venue's wine list).
  Nothing yesterday touched costs either: `seedCatalogParStock.ts` mentions `unit_cost` 0 times.
- **New `scripts/seedCatalogCosts.ts`** — 98 non-wine items priced against AU foodservice
  listings, ex-GST, per kitchen unit, dry-run by default, idempotent (verified: re-run reports
  0 changes). Every row carries a provenance tag — `sourced` (7, a live supplier listing read and
  URL cited), `benchmark` (15, derived from a sourced anchor with the derivation written out),
  `retained` (76, checked against research and already defensible). 11 source URLs are listed in
  the file header. Wines are deliberately never touched.
- **Pricing tier matters and the catalog told us which one.** T55 flour, Guérande salt and
  Billecart-Salmon mark this as a premium French pâtisserie, so specialty pastry items price at
  professional tier (Callebaut couverture, Cacao Barry cocoa) while staples price at bulk
  foodservice tier. Mixing tiers is what a real patisserie invoice looks like.
- **22 costs changed. The big ones were genuinely wrong:**
  - **Dark Chocolate $19.50 → $39.80/kg.** The old figure was *compound* pricing on an item a
    pâtisserie buys as couverture. Milk and white followed (+128%, +146%).
  - **Cocoa Powder $16.50 → $66.00/kg.** Two independent AU listings agree within 2%
    ($67.50 Bargain Foods, $65.99 Paragon) for Cacao Barry Extra Brute.
  - **Vanilla Extract $180 → $64.00/L**, the only large *reduction* — sourced from a real
    foodservice 5L at $320.
  - Sourced items that merely confirmed the existing number: Eggs $0.52 → $0.54, Chicken
    $12.99 → $12.00, Plain Flour $1.40 → $1.27.
- **Research caught one of my own bad guesses.** An early benchmark put Guérande Salt at
  $24.00/kg (+153%). Sourcing it found $10.50/kg — the $24 was *fleur de sel* pricing, not
  *sel gris*, and would have overstated it 2.3x. The pre-existing $9.50 was nearly right.
  Lesson: benchmark-by-category is exactly where a plausible-sounding number goes wrong; the
  items worth sourcing are the ones where the benchmark implies a big move.
- Written to `ingredient.unit_cost`, which is the live field: resolution is
  `preferred_unit_cost` → `location_ingredient.unit_cost` → `ingredient.unit_cost`, and
  `preferred_unit_cost` is unset across all 115 rows.

### Receipt history — chefs can now see who received a delivery and what it actually cost

- Asked "how will chefs check the history", the honest answer was: **Purchasing → Orders →
  Received → expand**, and that view was missing most of the receipt. Two gaps were data that
  already existed and simply was not plumbed:
  - **`actual_unit_cost` was never selected by `getPODetail`.** `confirmReceipt` has always
    written it, but the history table rendered `unitCost` — the price the kitchen *ordered* at.
    Any price change taken at the door was invisible, which made receiving look like it had done
    nothing. The Cost column now shows `$17.50 → $21.00`, red when the price went up, green when
    it went down, and stays a single plain figure when actual matches ordered.
  - **Who received it and when was never rendered.** `receivedByUserId` / `receivedDttm` already
    reached the client; the only mention of either in the whole client was a type declaration.
    The expanded PO now leads with "Received by {name} | {date, time}", joined through
    `user.userName` on the line's receiver. A receipt is one session event — every line carries
    the same receiver and timestamp — so the first received line speaks for the delivery.
- **Verified live** on a purpose-built receipt: created a PO via the API, received it with a
  `PRICE_VARIANCE` of $17.50 → $21.00 (+20%, correctly recorded as `varianceAmount 3.5`,
  `variancePct 20.0`), confirmed, then read it back in the browser — the arrow, the red colour,
  and the "Received by Rob Angeles - CulinAIre | Aug 2, 2026, 11:11 AM" header all render, and a
  clean receipt with no variance shows a plain cost with no arrow.
- **Still missing, deliberately not built** (bigger than a plumbing fix, flagged for after UAT):
  1. **No path to *why* a line was short or rejected.** Rejection reason/note, shortage qty,
     variance %, and photos live in `receiving_discrepancy` / `discrepancy_photo`, reachable only
     via `GET /receiving/sessions/:sessionId`. The session id is never surfaced after confirm and
     `useReceiving.loadSession` is **never called by any component**, so the badge says `SHORT`
     and the reason is unreachable. Needs a new "get the completed session for this PO" endpoint.
  2. **Credit notes are backend-only.** `POST/GET /credit-notes` exist with zero client
     references.

## 2026-08-01 — Receiving session bugs (unknown item, stuck PO, race condition) + checklist UI rework

- While walking Purchasing → Receive on `PO-MRUH46AZ`, found and fixed three compounding bugs in
  `receivingService.startSession()`, in the order they surfaced:
  1. **"Unknown item" on every freshly-started delivery** — `startSession` returned bare
     `receiving_line` rows straight from `.returning()`, with no join to `ingredient`; the reload
     path (`getSession`) DID join correctly, so the two paths silently disagreed. Fixed by
     extracting a shared `selectLinesWithIngredient()` helper both now call, so they can't drift
     apart again.
  2. **Stuck PO with no way back in** — a receiving session left open (tab closed, navigated away
     mid-receive, or just abandoned) put the PO in `RECEIVING` with genuinely no UI path to resume
     or cancel it: starting fresh always threw `Cannot start receiving on PO with status
     RECEIVING`, and the client only ever populates session state via a successful start. Fixed by
     making `startSession` resume the existing active session instead of rejecting when it finds
     one for a `RECEIVING` PO.
  3. **Race condition (the actual root cause of #2)** — two concurrent `startSession` calls for
     the same PO could both read `po.status = SENT` and "no active session" before either
     committed, creating two ACTIVE sessions for one PO. Confirmed live twice — the second time
     because a verification script raced a real browser attempt. Fixed with a transaction-scoped
     `pg_advisory_xact_lock(hashtext(poId))` at the top of `startSession`, same primitive as
     `utils/advisoryLock.ts`'s job-runner lock, keyed per-PO instead of a fixed job key. **Not yet
     verified against a real concurrent load or a real browser** — session paused before that
     could run; see the UAT doc's RESUME HERE block.
- **UI rework** (user-requested, same session): `ReceivingChecklist.tsx`'s 4 action pills (All
  Good/Short/Reject/Price Change) moved from a tap-to-expand 2×2 grid to always-visible on the
  right of each line (icon-only below the `sm` breakpoint). Each line now also shows unit cost,
  UOM, current stock on hand, par level, and total cost inline — required extending
  `selectLinesWithIngredient()` to join `location_ingredient` + `stock_level` (scoped via
  `receiving_session.store_location_id`, so the helper's signature didn't need to change).
- Lesson: the mocked-transaction test harness in `receivingService.test.ts` modeled only a single
  `.leftJoin()` and no `.innerJoin()` — had to make the mock's join chain generically composable
  (any join type, any count, before `.where()`) to match what real Drizzle allows. Also had to add
  `tx.execute()` to the mock for the new advisory-lock call.

## 2026-08-01 — Seeded realistic par/reorder/stock across the Almost French Pâtisserie catalog

- UAT for `feature/ck-web/purchasing-order-guides-p1` (checklist: `docs/qa/uom-recipe-selling-uat.md`)
  needed to walk Section C/C-guides, but the catalog was mostly bare: Almost French Patisserie had
  0/115 items with a par level set (only 7 had any stock_level row); Almost French Epicure had only
  3/115 items configured at all. Order Guides, order-to-par, and dashboards were effectively empty
  outside the ~7 hand-built fixture items.
- **Ran one-off `scripts/seedCatalogParStock.ts`** (deterministic, hash-based — no `Math.random`, so
  reruns are idempotent) against both locations: 230 `location_ingredient` par/reorder settings
  written via `updateLocationIngredient()`, 220 new `stock_level` rows created via `addStock()`
  where none existed. The 10 pre-existing fixture rows (Belicard, Sancerre, Eleventh Hour Barossa
  Shiraz, San Pellegrino, Chicken, Napkins, Baker's Flour — whichever location already had them)
  were left byte-for-byte untouched since the checklist's worked examples in Sections A/B/E/F/G/H
  depend on those exact numbers.
- **Decisions made with the user:** scope = Almost French Pâtisserie org only (not the Comfort Spoon
  Co. demo org); par/reorder gets set on every item including the fixture ones (so C5's "type a par
  value" UI step doesn't have to start from a totally blank catalog); Epicure gets the full 115-item
  catalog, pars scaled to 55% of Patisserie's (satellite site) — **except** Baker's Flour/Chicken/
  Eleventh Hour, which skip the scale-down because their preserved stock is identical at both
  locations (25kg/10kg/24 bottles) and scaling par down while stock stayed constant made Epicure
  read as absurdly overstocked.
- **Known drift flagged, not silently patched:** Belicard's live stock has drifted to 16 bottles
  (checklist documents 6.5 — some C-section testing clearly happened off the recorded checkboxes).
  Rather than force the stale worked numbers, Belicard's par was deliberately set to 20 (reorder 36)
  so it still lands meaningfully below-par for a real C9–C15 walkthrough. The checklist's literal
  expected numbers there are now stale and need a manual update whenever C-guides is actually walked.
- **Verified:** re-queried both locations post-write — 115/115 par set and 115/115 stock_level rows
  at both Patisserie and Epicure (up from 0/112 and 0/3); Belicard spot-checked live (stock 16, par
  20, reorder 36); `tsc --noEmit` clean; Comfort Spoon Co. (org 1) confirmed untouched.

## 2026-07-15 — Storage areas as count sheets, B1 (branch: feature/ck-web/storage-areas-and-movements)

Built B1 of `docs/specs/storage-areas-count-sheets.md`: areas exist, items get assigned to
them with per-area pars, moves record with zero stock effect, and the FOH guardrail finally
has somewhere to send people.

**Pages touched**
- NEW [[storage-areas]] — the model, why not per-area ledgers, and the traps.
- [[reconciliation-matrix]] — added the **Area movement** row. It's the only row whose
  "Must Balance Against" is *nothing*, which is the whole point.
- [[index]] — new concept page listed.

**What the eng review caught (the spec asserted 3 things about the code that were false)**
1. "existing category-status machinery enforces every group submitted" — it does NOT.
   Both `checkAndAdvanceSession` and `submitSessionForReview` exclude `NOT_STARTED` by
   design. Harmless in CATEGORY mode, silent stock deletion in AREA mode. B2 must guard
   BOTH paths.
2. The E1 snapshot query joined `stock_take_line.session_id` — no such column (links via
   `category_id`) — and ordered by an approval timestamp that doesn't exist.
3. The Unassigned anti-join targeted a server-side item universe that isn't there; the
   sheet is a client-side filter with a LOOSER predicate.

**Corrections to the eng review itself** (a reviewer's confident claim is not evidence
either): `moved_at` → `moved_dttm` was WRONG and reverted — the schema uses `_at` for domain
events and `_dttm` for row lifecycle, and `consumption_log` carries both.

**Also fixed**: `TransactionEvent` was declared twice with different unions; the hook's copy
had been missing `transfer_loc` since forever while the server emitted it. One declaration now.

**Recorded in `tasks/lessons.md`**: a spec's claims about the code are not evidence; and
drizzle-kit reads `DEV_DATABASE_URL` before `DATABASE_URL` (cost an hour of wrong diagnoses
— and the 2026-07-02 entry below already knew this).

---

## 2026-07-02 — Local DB bootstrap + drizzle-kit env-prefix fix (branch: feature/ck-web/local-db-bootstrap, PR #38)

Stood up local dev on a second machine (HEPHAESTUS) and fixed three DB-setup failures, captured in full as lesson #54 in `tasks/lessons.md`. (1) The machine had no `archos_dev` role / `culinaire_kitchen_dev` DB → `28P01 password authentication failed` on every startup task. (2) `pnpm db:deploy` failed with *"Either connection url or host/database are required"* — `drizzle.config.ts` read unprefixed `process.env.DATABASE_URL`, but `.env` only defines `DEV_DATABASE_URL`, and the `DEV_/PROD_` shim (`utils/envShim.applyEnvPrefix`) runs in the server process, not the separate drizzle-kit process that loads the config. (3) A raw `pg_dump` restore of prod aborted on `type "public.citext" does not exist` — prod uses `citext` + `uuid-ossp` (+ `vector`), local had only `vector`.

**Shipped:**
- `scripts/db-bootstrap.mjs` (+ `pnpm db:bootstrap`) — parses the resolved DEV connection string from `.env`, refuses non-local hosts (mirrors the `db/index.ts` guard), and idempotently creates/syncs the login role + database + `vector`/`citext`/`uuid-ossp` extensions via `sudo -u postgres psql`. SQL piped via stdin so the password never hits disk or `ps`.
- `packages/server/drizzle.config.ts` — now resolves `${APP_ENV}_DATABASE_URL` inline (kept in sync with `envShim.ts`).
- Local populated via a **RAW** prod clone (`pg_dump --clean --if-exists --no-owner --no-privileges`, grep-filtering the superuser-only EXTENSION lines).

**Two footguns this introduces (see lesson #54):** (a) The drizzle.config fix means `drizzle-kit push` now *connects* — the accidental "no URL → can't push" safety net is gone, so the [[schema-drift-may-2026]] "never `drizzle-kit push` against this drifted DB" rule now rests purely on discipline. (b) This is a RAW clone that **reverses [[dev-prod-db-separation]]'s sanitization** — because DEV encryption keys were set equal to PROD keys, real customer PII + live API credentials sit decryptable on the dev laptop; trusted personal machines only. Also: Turnstile keys live in prod's Render env, not the DB, so a fresh clone has no Turnstile config → web login deadlocks with *"Security check couldn't load"*; bootstrap local login with Cloudflare test keys (`1x00000000000000000000AA`) in `.env` first. See [[single-env-file]].

## 2026-07-01 — Role-aware, kitchen-native navigation (branch: feature/ck-web/role-aware-nav)

CEO review (`/plan-ceo-review`, SELECTIVE EXPANSION) of the sidebar found two root causes behind "it works but something's off": the nav was grouped by the codebase (Creative Labs / Kitchen Operations / Community) not the user's day, and it showed all 12 items to everyone despite a full role + permission system. Rebuilt the sidebar as a data-driven, permission-filtered config (`navConfig.ts` + pure `filterNav` + `useHasPermission`) and renamed to kitchen vernacular (Ask Antoine, Test Kitchen, Run the Kitchen, Menu & Costing, Prep, Waste, Community Recipes). Added new permission keys `menu:read` / `waste:read` / `prep:manage`, enforced them on the previously `authenticate`-only routes (`/api/menu`, `/api/waste`, `/api/prep`) via existing `requirePermission`, and wrapped the matching client routes in `RequirePermission`. Added a sidebar location chip (E1) and per-role landing route (E2). Outside-voice review caught the rollout gap: `scripts/backfillNavPermissions.ts` grants the new keys to every existing role and MUST run before enforcement deploys (a test-user cleanup runs first). New page [[role-aware-navigation]]. Verified: client tsc + server tsc clean, 33 client + 418 server tests pass, build + lint (0 errors) green. Deferred: test-user audit/cleanup (needs DB + PII-decryption confirmation), persona rename to Antoine in systemPrompt.md, mobile nav (web is desktop-only by decision).

## 2026-07-01 — MFA consolidated into Profile → Security tab

**What was done**

Moved MFA out of its scattered homes (a standalone `/mfa-setup` page reached via a sidebar "MFA Settings" dropdown item, plus a secondary "Manage MFA" button on the Account tab) into a single **Security** tab on the Profile page. The renamed tab (was "Change Password") now holds two section cards: Change Password (unchanged) and Two-Factor Authentication.

- New `packages/client/src/components/profile/MfaSection.tsx` — MFA setup/enable/disable logic adapted from the deleted `MfaSetupPage.tsx`, now calls `refreshUser()` from AuthContext so `user.mfaEnabled` stays in sync app-wide.
- `ProfilePage.tsx` — tab id `password` → `security`, label "Security" + ShieldCheck icon; removed the Account-tab "Manage MFA" button and the now-orphaned `useNavigate` import.
- `UserMenu.tsx` — removed "MFA Settings" from both dropdown variants + unused `ShieldCheck` import.
- `App.tsx` — removed `/mfa-setup` route + import; deleted `pages/MfaSetupPage.tsx`.

Backend MFA endpoints unchanged — pure frontend reorganisation. Verified: `tsc:check`, `vite build`, lint (0 errors), grep confirms no `mfa-setup`/`MfaSetupPage` refs remain. Updated [[features]].

**Live QA + two latent bugs fixed.** Ran an authenticated browser pass (client :5179 / server :3009). It surfaced two client/server field-name mismatches carried over verbatim from the old `MfaSetupPage`, meaning the standalone MFA flow never actually worked: setup read `data.qrDataUrl` but the endpoint returns `qrCodeDataUrl` (QR never rendered), and enable sent `{ code }` but the server expects `{ token }` (authController.ts:636, always failed). Both `any`-typed so tsc/build/lint were blind. Fixed in `MfaSection.tsx`; verified full UI round-trip (Set Up → QR → TOTP → Enable → Disable) with `/api/auth/me` confirming the `mfaEnabled` round-trip. Lesson: type the `/api/auth/mfa/*` shapes in `shared/` so field drift fails at compile time.

## 2026-06-29 — Feature Catalog page added

**What was done**

Created [[features]] (`wiki/synthesis/features.md`) — a living, complete enumeration of every user-facing feature in CulinAIre Kitchen, grouped by the four product lobes (Chat Assistant, Creative Labs, Kitchen Operations, Community) plus accounts, settings/admin, and the platform layer. Built from a fresh sweep of client routes/components and server routes/services. Linked it from `wiki/index.md` under Synthesis. Intent: keep this updated as features are built, changed, or removed — it's the "what exists now" view, complementary to [[project-status]]'s delivery timeline.

---

## 2026-06-16 — Dev/prod database separation (+ migrations rejected)

**What was done**

Split local dev off the shared production Postgres. Local dev now runs against a local Postgres (`culinaire_kitchen_dev`) seeded from a sanitized prod snapshot (`pg_dump` read-only → `pg_restore` → new `packages/server/scripts/sanitize-local.sql`: PII nulled, secret/token tables deleted, fresh local encryption keys, uniform dev password, `admin@local.test`). Root `.env` repointed to local with rotated keys; prod URL saved to gitignored `.env.production.local`. Added a boot guard in `packages/server/src/db/index.ts` that refuses a remote DB host unless `NODE_ENV=production`.

**Decided**

Did **not** adopt drizzle-kit versioned migrations. A drift gate (baseline `0000` from `schema.ts` → empty throwaway DB → `pg_dump --schema-only` diff vs prod snapshot) reconfirmed [[schema-drift-may-2026]] and surfaced new drift (4 DB functions/triggers, `citext`/`uuid-ossp`, code-only indexes, `_fkey` vs verbose FK names). Removed the migration scaffolding; the repo keeps its targeted-tsx-script workflow until drift is reconciled.

**Touched**: `wiki/decisions/dev-prod-db-separation.md` (new), `wiki/synthesis/schema-drift-may-2026.md` (drift items 5–8 + 2026-06-16 section), `wiki/index.md`, `tasks/lessons.md` (#52).

---

## 2026-06-01 — Formula audit: complete catalog + reconciliation matrix

**What was done**

Full audit of every formula in the CulinAIre Kitchen calculation engine. Read 13 source files across the server and shared packages, documented 27 formulas with forward/backward proofs, and created a reconciliation matrix showing how stock-affecting and cost-affecting operations must balance.

**Pages created**
- `wiki/concepts/formula-catalog.md` — 27 formulas across 8 categories (Unit Conversion, Stock, WAC, Menu Cost, Prep, PO, Forecast, Yield Variance). Each formula documented with ID, source file:line, inputs/outputs, precision/rounding, forward proof, backward proof, dependency chain, conversion system used, and test file status.
- `wiki/concepts/reconciliation-matrix.md` — 8 operations mapped (receiving, transfer send, transfer receive, stock take approve, consumption, waste logging, PO creation, menu cost recalculation) with stock effects, cost effects, balance rules, and 5 cross-operation invariants.

**Key findings**
- Two unit conversion systems coexist: System A (static, `shared/utils/units.ts`) for menu cost engine, System B (DB-backed, `unitConversionService.ts`) for stock take. Documented explicitly to prevent confusion.
- Pure math modules (`prepMath.ts`, `poMath.ts`, `stockMath.ts`, `forecastMath.ts`) are well-separated from I/O services. These are the easiest to test and have the best coverage.
- Test coverage gaps identified: `poMath.ts`, `wacService.ts`, `stockService.ts`, `thresholdService.ts`, `autoPoSuggestService.ts`, and `forecastService.ts` (integration) all lack dedicated test files.
- Precision varies across formulas: `.toFixed(2)` is the most common (menu costs, PO totals), `Math.round` for prep portions, `Math.floor` for depletion days, `Math.ceil` for reorder quantities, and `Math.round(x*1000)/1000` for on-hand display. All documented per formula.

**Pages updated**
- `wiki/index.md` — added both new concept entries.

---

## 2026-05-05 — Play Console legal-URL pattern: SPA-route surface override + `/delete-account`

Two web sessions today, both driven by Play Console submission requirements for the mobile app.

### Session 1 — Privacy + Terms wired to mobile-surface rows (PR #15, merged)

Robert needed a public HTTPS URL for Play Console's "Privacy policy URL" listing field. The web SPA already had `/privacy` and `/terms` routes (from commit `9d770f1`), but they fetched `/api/site-pages/{slug}` with the controller's default `surface=web` — and only the mobile-surface rows are published on prod (web rows are still draft, intentionally per the 2026-05-03 surface-partition decision). So a Play reviewer hitting `https://www.culinaire.kitchen/privacy` was getting the SPA's "Page not found" state.

Discovery flow worth keeping for the next time a "page is published but the URL 404s" report comes in:

1. Pulled main, ran `pnpm install` (lockfile drift from PR #15's tree-shaking — `tesseract.js` flagged for `pnpm approve-builds`, approved).
2. Naive curl `https://www.culinaire.kitchen/privacy` returned `Cannot GET /privacy` (Express envelope) — initially thought the route wasn't mounted, mirroring the 2026-05-03 incident. Re-checked with a browser-like `Accept: text/html` header and the SPA fallback at [packages/server/src/index.ts:338-346](../packages/server/src/index.ts#L338-L346) kicked in → 200 + SPA shell. Lesson: the SPA fallback is gated on Accept; curl's default `*/*` misses it. Always test with browser headers when reasoning about what reviewers see.
3. Curled `/api/site-pages/privacy?surface=web` → JSON 404 envelope `{"error":"Page not found"}` and `/api/site-pages?surface=web` → `[]`. That's the "route mounted, data layer null" envelope from the 2026-05-03 decision — pointed straight at publish-state, not deploy.
4. Confirmed Robert's "I published this a long time ago" was correct for `surface=mobile` (10,344 bytes / 14,211 bytes on prod, matches yesterday's resolution log) and unfilled for `surface=web`. Same admin-UI surface ambiguity from yesterday's incident — the editor doesn't show the surface, only the sidebar group does.

Fix: SPA-route surface override. New optional `surface` prop on `<PublicPage>`, passed through to `usePublicPage`; `App.tsx` passes `surface="mobile"` on `/privacy` and `/terms` only. `/pages/:slug` (the generic catch-all) and the controller default both stay on `web`, so future admin-authored web pages still work. Three-line change. Verified locally with Playwright (full-page screenshots saved to `C:/tmp/legal-{privacy,terms}.png`); after merge + Render auto-deploy, re-verified against prod (new bundle hash `index-kloymna2.js`, h1s and bodies all match).

### Session 2 — `/delete-account` for Play data-deletion policy (in flight)

Mobile session posted a new ask in `mobile-needs.md` — Google Play's data-deletion policy requires a public URL with three required elements (app/dev name, deletion steps, data-deleted/kept breakdown), enforced at Closed Testing review onward. Same SPA-route surface-override pattern fits cleanly:

1. Server `sitePageService.ts` — added `delete-account` to `RESERVED_SLUGS` and to the boot-time seed list. New seed count is 2 surfaces × 3 slugs = 6 inserts. Updated tests for both the new reserved-slug guard and the seed count.
2. Client `App.tsx` — added `<Route path="/delete-account" element={<PublicPage slug="delete-account" surface="mobile" />} />` next to `/privacy` and `/terms`.
3. Server suite green (217 passed); client typecheck clean.

The post-deploy step is on Robert: open `Settings → Mobile → Pages → Deleting your account`, paste the body (suggested copy supplied by mobile in `mobile-needs.md`), tick Published. URL goes into Play Console → App content → Data deletion → "Delete account URL".

### Pattern documented

[concepts/surface-partition.md](concepts/surface-partition.md) updated with a new "SPA-route surface override" section explaining when to override the default `web` surface at the route level vs at the controller default. Cross-repo `decisions.md` (`cc-culinaire-shared-context/decisions.md`) is the canonical source for the pattern across both repos — added a 2026-05-05 entry that lists the three URLs (`/privacy`, `/terms`, `/delete-account`) and the four-step recipe for adding a new one.

The takeaway: app-store review URLs are a third class of consumer for the `site_page` table. Web users default to web copy, mobile users default to mobile copy, and reviewers get the mobile copy via SPA-route override. The controller default stays `web` because that's still the right answer for everything else.

---

## 2026-05-03 (afternoon) — Mobile v1.2 unblock, cross-repo coordination, auto-injected shared-context hook

Three concurrent work streams, all driven by the parallel mobile session.

### Mobile v1.2 unblock — commit `62ce119`

The mobile session asked (URGENT in `mobile-needs.md`) for an FR placeholder slug + a feature-flag endpoint so the v1.2 language picker could be tested end-to-end without waiting for the authored translation + eval pass. Shipped both:

- **FR placeholder.** [packages/server/src/scripts/createFrPlaceholderPrompt.ts](../packages/server/src/scripts/createFrPlaceholderPrompt.ts) — idempotent one-shot that inserts a device-runtime `prompt` row with key `antoine-system-prompt-fr`. Body is the EN body verbatim with `[PLACEHOLDER — pending culinary review, not production-ready]` as the first line so no downstream reader can mistake it for the authored translation. Reachable at `GET /api/mobile/prompts/antoine-system-prompt-fr` via the existing route — no controller change required.
- **`GET /api/mobile/feature-flags`** — new route, Bearer-authed, reuses the 30 req/min `mobilePromptRateLimit`. Sets `Cache-Control: public, max-age=3600` (drops to private/no-store if per-user flags are added later). Response shape `{ "languages_enabled": ["en"] }` driven by a new `mobile_languages_enabled` site setting (JSON-encoded array). Service falls back to `["en"]` on parse failure so the mobile picker always has at least the default. Forward-compatible — adding a `features` map later won't break older mobile clients. Tests cover parse fallbacks, cache header, error pass-through (13 new tests; server suite now 173 passing).

### Cross-repo coordination

Parallel mobile asks landed in shared-context throughout the day; this session owned the responses:

- **`shared-context/api-contracts.md`** — rewritten. Endpoints A (Mobile Prompt Fetch), B (Mobile RAG Retrieval), C (Mobile Feature Flags), and D (Public Site Pages with the `?surface=` query param) all populated with auth, rate limits, response shapes, and behavioural notes. Authentication and Subscription Verification still TBD.
- **`shared-context/decisions.md`** — appended a durable record: mobile consumes Terms + Privacy via the JSON site-pages API scoped by surface, not by linking out to the web HTML pages.
- **`shared-context/mobile-needs.md`** — both today's mobile asks marked complete with URLs, repro commands, and cache-header notes.

A late-afternoon mobile ask landed (`mobile-needs.md` head): prod `GET /api/site-pages/{terms,privacy}?surface=mobile` still returning 404 despite Robert ticking Published in the admin. Working hypothesis from mobile: the admin UI was toggling the **web**-surface rows, not the mobile ones — i.e. either the `Settings → Mobile → Pages` tab is wired to the wrong surface or Robert clicked under `Settings → Web → Pages` by accident. Open; not yet investigated.

### Auto-injected shared-context (hook)

Wired a `UserPromptSubmit` hook in [.claude/settings.local.json](../.claude/settings.local.json) that runs before every prompt and injects the head of `mobile-needs.md` and `decisions.md` (~80 lines each, with mtime headers) wrapped in `<system-reminder>`. Trade: ~10 KB of context per turn for cross-repo awareness without manual prompting. Confirmed firing this session — no longer need the user to nudge me with "check shared context".

Recommended reading order for any future session: this entry, then `mobile-needs.md` head (already auto-injected), then `decisions.md` head (also auto-injected). Older entries from earlier today below.

---

## 2026-05-03 — Settings scope clarity + dead `knowledge-base/` folder removed

**Settings reorganised by app surface.** The Settings sidebar now groups tabs under **Web / Mobile / Shared**. Empty primary groups still render their header with a "No tabs yet" hint so the cherry-pick targets stay visible. Tab placement is configurable via a new optional `group` field on the tab registry in [SettingsLayout.tsx](../packages/client/src/components/settings/SettingsLayout.tsx).

Two existing single-tab features were extended to support per-surface scoping using the same pattern:
- **Prompts** — `PromptsTab` accepts `runtimeFilter` (`"server" | "device"`); registry now has a Mobile-scoped Prompts tab (`runtime='device'`) and the Shared one filters to `runtime='server'`. Antoine and the other on-device prompts now appear under Mobile → Prompts only.
- **Pages** — `PagesTab` accepts `surface` (`"web" | "mobile"`). The `site_page` table gained a `surface` column with composite unique on `(slug, surface)`, applied to the remote DB via a one-shot idempotent script ([addSitePageSurface.ts](../packages/server/src/scripts/addSitePageSurface.ts)) because `drizzle-kit push` was hanging on an interactive prompt even with `--force`. Reserved slugs (`terms`, `privacy`) are now seeded for both surfaces; the mobile app's legal copy is fully separate from the web's.

**Knowledge base folder removed.** The top-level `knowledge-base/` folder (10 markdown files seeded in the project's earliest weeks) had no runtime consumer — no `fs.readFile`, no `readdir`, no SHA-256 sync. The wiki page describing it was actively wrong about boot-time behaviour. Removed via `git rm -r knowledge-base/` (recoverable from history) and rewrote [raw-index/knowledge-base.md](raw-index/knowledge-base.md) to point at the actual source of truth: the `knowledge_document` + `knowledge_document_chunk` Postgres tables, authored through Settings → Knowledge Base.

**Prompts folder pruned.** Audit found the `prompts/` folder was genuinely live but had drifted. The `seed.ts` recipe-lab block referenced three files that either never existed (`recipePromptV2.md`) or had been deliberately deleted in Phase 8 (`patisseriePrompt.md`, `spiritsPrompt.md`). The `try/catch` wrapper meant `pnpm db:seed` was silently failing for three of four recipe-lab prompts on every fresh deploy. Per the Phase 8 commit message ("Recipe prompts moved from MD files to database (admin-editable)"), the deliberate target state is DB-only authoring through Settings → Mobile → Prompts. Cleaned up:
- Removed the `recipePrompts[]` seeding block + `RECIPE_PROMPTS_DIR` constant from `packages/server/src/db/seed.ts`.
- Deleted `prompts/recipe/patisseriePromptV2.md`, `prompts/recipe/spiritsPromptV2.md`, and `packages/server/src/db/migrations/update-domain-prompts-v2.ts` — the V2 files only existed as inputs to that one-shot migration, which has long since been applied.
- Deleted the duplicate `prompts/recipe/recipeRefinementPrompt.md`; preserved the canonical `prompts/chatbot/recipeRefinementPrompt.md` as the runtime fallback for `promptService.loadPromptFromFile()` (which hard-codes `PROMPTS_DIR = prompts/chatbot`).
- Updated [entities/prompt-system.md](entities/prompt-system.md) to reflect DB-as-source-of-truth, marked [decisions/duplicate-recipe-refinement-prompt.md](decisions/duplicate-recipe-refinement-prompt.md) RESOLVED, and ticked off the todo entry.

End state of `prompts/`: just two files, both genuinely load-bearing — `prompts/chatbot/systemPrompt.md` (seed + runtime fallback) and `prompts/chatbot/recipeRefinementPrompt.md` (runtime fallback only).

**Docs swept** to remove stale references and the fictitious `buildIndex()` startup step:
- `CLAUDE.md` — folder listing trimmed; "Knowledge Base Structure" section rewritten to describe DB-backed storage; wiki rules updated to drop the `knowledge-base/` immutability claim.
- `docs/architecture/overview.md`, `docs/architecture/technical-guide.md`, `docs/architecture/data-flow-diagrams.md` — folder listings trimmed; startup sequence corrected to `ensureSeededPages()` (truthful) instead of `buildIndex()` (never existed); Knowledge Base section rewritten around pgvector + admin UI.
- `wiki/index.md`, `wiki/concepts/technical-architecture.md` — pointer entries updated.

---

## 2026-04-30 — Ways of working: every PR ships with a structured description

**What was established**
User formalised a norm after PR #9: every pull request opened against this repo must include a structured description body covering Summary / Why / What ships / Out of scope / Test plan / Risk / Depends on. Default `gh`-generated bodies and one-liners are not acceptable. PR #9's description is the canonical example.

**Why now**
PR #9 (catalog-spine Phase 1) was the first PR to include this kind of structured overview. The user explicitly asked for it on every subsequent PR so reviewers (and future Claude sessions) can understand the PR without reading every commit. Without "Out of scope" + "Test plan" sections, every review re-surfaces scope-creep questions that should have been answered upfront.

**What was done**
- Wrote [wiki/concepts/pr-description-template.md](concepts/pr-description-template.md) — the seven required sections, the `--body-file` pattern (write to `C:/tmp/pr<N>-body.md` first), what NOT to do.
- Indexed in `wiki/index.md`.
- Saved as a feedback memory in the user's auto-memory store so the norm persists across machines + sessions.
- PR #9's description was retroactively written in the new format and is referenced as the canonical example.

**How this composes with existing rules**
- CLAUDE.md "Git Workflow — Trunk-Based Development" — covers commits + branching but not PR descriptions specifically. This concretises that gap.
- Existing commit message format ("verb area: detail") still applies per CLAUDE.md.
- The Dev-server + Playwright norm (2026-04-29) feeds directly into the "Test plan" section of the PR body.

---

## 2026-04-29 — UI ways of working: Dev server + Playwright as a default

**What was established**
User formalised a working norm: every UI change in this project must be rendered in the live dev server and inspected via Playwright before being reported as done. No "should work" without a screenshot. Backend-only changes still follow the curl-based regression protocol from CLAUDE.md.

**Why now**
Established at the kickoff of Phase 0 of the catalog-spine initiative, before any UI work lands. Scoping the rule before Phase 1 ships keeps the IngredientPicker variants, Unlinked badge, allergen rollups, variance pills, and mise en place sheet from accumulating round-trips on visual defects.

**What was done**
- Wrote [wiki/concepts/dev-server-plus-playwright-verification.md](concepts/dev-server-plus-playwright-verification.md) — workflow, port reminders (Vite 5179 / Express 3009), backend-vs-frontend distinction, tool selection (`webapp-testing` / `browse`).
- Indexed in `wiki/index.md`.
- Also saved as a feedback memory in the user's auto-memory store so future Claude sessions on different machines pick it up.

**How this composes with existing rules**
- CLAUDE.md "Verification Before Done" — that section already mandated end-to-end verification; this concretises *how* for UI.
- CLAUDE.md "Local Development Ports" — same ports referenced (5179 / 3009).
- CLAUDE.md "Regression Testing Protocol" — Playwright is additive for UI; curl coverage of API routes still required separately.

---

## 2026-04-29 — CI pipeline wired up (post-mortem on Render deploy failure)

**What happened**
A Render deploy failed on `tsc` with TS2493 in `packages/server/src/middleware/rateLimiter.test.ts:116` — a vitest mock-call tuple typing weakness compiled into production output because the server tsconfig had no `*.test.ts` exclude. The test file landed via PR #6 (`7d876d4`) and survived two intermediate commits before our docs push triggered a rebuild that exposed it.

**What was done**
1. Fix (commit `ec0e422`): excluded `**/*.test.ts` from `packages/server/tsconfig.json`. Render redeployed cleanly.
2. Investigation: confirmed there is **no** `.github/workflows/`, no Husky, no lint-staged. CLAUDE.md describes a CI pipeline that was never wired up. PR #6 had no automated check whatsoever.
3. Wire-up (this work, on `feature/ck-web/wire-up-ci`):
   - `.github/workflows/ci.yml` — single job, 5 steps mapped 1:1 to CLAUDE.md (install / lint / tsc:check / test / build), Node 22, pnpm 10.31.0 pinned to `packageManager`, ubuntu-latest, 15-min cap, concurrency cancellation per ref.
   - Added `tsc:check` script to each package + a turbo task. `pnpm tsc:check` runs all three packages in ~6.5s locally.
   - Wrote [wiki/decisions/ci-pipeline.md](decisions/ci-pipeline.md) with the full failure-mode mapping and trade-offs considered.

**Why a feature branch this time**
Per CLAUDE.md, changes >3 files normally branch. More importantly: the very first run of the new workflow needs to happen on the PR, not on main, so we can see green/red before it gates anything else. If we'd committed to main directly, the first CI run would have been on main — and a broken CI on main would block subsequent PRs too.

**Follow-ups not done in this branch**
- Branch protection rule on `main` requiring this check before merge (must be configured in GitHub Settings → Branches; not in code).
- Husky + lint-staged for pre-push fast feedback (CLAUDE.md describes this; it doesn't exist either). Optional after CI is green.
- E2E (Playwright) tests in CI — needs a separate workflow with services. Deferred.

---

## 2026-04-29 — Mobile API contract documented

**What was done**
Wrote [wiki/concepts/mobile-api-contract.md](concepts/mobile-api-contract.md) — the first cross-cutting concept page filling a gap surfaced in the original audit. Documents the contract between this web monorepo (API only, port 3009) and the separate CulinAIre mobile repo (React Native, on-device Gemma 3n E4B).

**Coverage**
- Auth transport split — Bearer header (mobile) vs httpOnly cookie (web), unified by one `authenticate` middleware
- Mobile-specific entry point — `POST /api/auth/google/idtoken` returns `tokens` in body for keychain storage
- The single `/api/mobile/*` route — `GET /api/mobile/prompts/:slug` (commit `128a119`), with rate-limit (30/min/user), slug regex validation, and the deliberate 404-unification that prevents server-runtime prompt enumeration
- Device tokens — `device_token` table is wired and registration works; FCM/APNs dispatch is **not yet implemented**
- Notification types defined for the kitchen-ops events that mobile will eventually listen on
- Test coverage points that lock the contract
- Three known gaps for the backlog: push dispatch, mobile token rotation, sparse `/api/mobile/*` namespace

**Bidirectional links added**
Updated `related:` frontmatter on `culinaire-kitchen-platform`, `prompt-system`, `technical-architecture` to link back to the new page. Hook auto-rebuilt the graph: 11 → 12 nodes, 23 → 26 edges → final state after this turn includes 6+ edges into `mobile-api-contract`.

**Why this page first**
Highest-leverage gap from the audit: there's a parallel mobile repo whose Claude session needs this contract written down. API drift between repos is the highest-risk class of cross-repo work.

**Validation**
- PostToolUse hook fired on the Write — graph rebuilt automatically.
- `node scripts/wiki-graph.mjs neighbors mobile-api-contract` confirms wiring.
- All file:line citations in the page were sourced from the live codebase via an Explore subagent — verifiable.

---

## 2026-04-29 — Claude Code hooks for wiki workflow

**What was done**
Added two hooks to `.claude/settings.json` so the wiki workflow stops being best-effort and becomes harness-enforced.

- `PostToolUse` on `Edit|Write|MultiEdit` → runs `node scripts/wiki-graph.mjs auto`. The new `auto` subcommand reads the hook input from stdin, gates on `tool_input.file_path` matching `wiki/*.md`, and rebuilds `wiki/.graph.json` silently. Non-matching paths and malformed JSON exit 0 silently — never blocks tool flow.
- `Stop` (no matcher → fires on every Claude stop) → emits a JSON `systemMessage` reminding to append a dated entry to `wiki/log.md` if anything significant happened in the turn. Soft nudge, does not block Stop.

**Files changed**
- `scripts/wiki-graph.mjs` — added `auto` subcommand for stdin-gated hook entrypoint.
- `.claude/settings.json` — added `hooks.PostToolUse` + `hooks.Stop` blocks; preserved all 48 existing `permissions.allow` entries.

**Why this matters**
Previously the "rebuild graph after wiki edit" and "log session work" loops relied on Claude remembering. With hooks, the harness runs them — Claude's discretion is no longer required.

---

## 2026-04-29 — Level 2 + Level 4 tooling wired up

**What was done**
Added the Karpathy gist's Level 2 (fast local search) and Level 4 (graph relationships) tooling. Both implemented as pure-Node scripts under `scripts/`, no new dependencies.

**Files created / changed**
- `scripts/wiki-search.mjs` — Level 2: regex search across all wiki `.md` files; `-c` flag prints 2-line context per match.
- `scripts/wiki-graph.mjs` — Level 4: walks wiki/, parses minimal frontmatter, extracts every `[[slug]]` reference (frontmatter + body), persists `wiki/.graph.json`. Subcommands: `build`, `stats`, `neighbors <slug>`, `orphans`, `category <name>`, `broken`.
- `.gitignore` — added `wiki/.graph.json` (regenerable artefact).
- `CLAUDE.md` — added "Wiki tooling" subsection under the LLM Wiki section with usage and an upgrade note (swap JSON for `node:sqlite` past ~1000 nodes).
- `wiki/index.md` — added a "Tooling" section table.

**Decisions taken**
- Karpathy's gist names `qmd` for Level 2; on npm `qmd` is a dead placeholder package (v0.0.0, no code). Substituted with a pure-Node text searcher to avoid shipping a squatted dep.
- Bash version of `wiki-search` was scrapped because `rg` is not on PATH in Git Bash on this machine (only buried inside VS Code's bundled extensions). Pure-Node path is portable across shells.
- For Level 4 the gist suggests SQLite; v1 uses JSON because (a) the graph is tiny (11 nodes today) and inspectable, (b) zero deps, (c) Node 22+ ships `node:sqlite` built-in so the upgrade is one swap when needed.

**Smoke tests**
- `wiki-search OpenRouter` → 7 hits across concepts, decisions, entities, synthesis, index, log.
- `wiki-search -c hollandaise` → context preview from `raw-index/knowledge-base.md`.
- `wiki-graph stats` → 11 nodes, 23 edges. By category: concept 2, decision 2, entity 3, raw-index 2, synthesis 2.
- `wiki-graph neighbors prompt-system` → outgoing 2, incoming 3.
- `wiki-graph broken` → none.
- `wiki-graph orphans` → none.

---

## 2026-04-29 — Wiki initialisation from existing markdown

**What was done**
Initialised the LLM Wiki Brain by auditing every markdown file under `docs/`, `knowledge-base/`, `prompts/`, `tasks/`, and the repo root, and creating a structured wiki alongside the originals (no relocations, no deletions).

**Pages created**
- `wiki/index.md` — master catalog
- `wiki/log.md` — this file
- `wiki/entities/culinaire-kitchen-platform.md`
- `wiki/entities/store-locations-system.md`
- `wiki/entities/prompt-system.md`
- `wiki/concepts/technical-architecture.md`
- `wiki/concepts/data-flow-architecture.md`
- `wiki/decisions/openrouter-migration.md`
- `wiki/decisions/duplicate-recipe-refinement-prompt.md`
- `wiki/synthesis/project-status.md`
- `wiki/synthesis/lessons-index.md`
- `wiki/raw-index/knowledge-base.md`
- `wiki/raw-index/landing-page-creative-brief.md`

**Decisions taken during this session**
- `knowledge-base/` and `prompts/` stay where they are. Both are read by code at runtime (pgvector sync, prompt loader, mobile fetch endpoint, runtime guard). The wiki documents them via pointer pages under `wiki/raw-index/` and `wiki/entities/` instead of moving them.
- `raw/` is conceptual ("immutable source content"), not a literal folder. No `raw/` directory was created.
- `tasks/lessons.md` and `tasks/todo.md` stay in `tasks/`. Wiki gets `wiki/synthesis/lessons-index.md` and `wiki/synthesis/project-status.md` as discoverable surfaces.
- `CLAUDE.md` stays in place; `wiki/index.md` links to it as the most important document in the project.
- Duplicate prompt file at `prompts/recipe/recipeRefinementPrompt.md` is logged in `wiki/decisions/duplicate-recipe-refinement-prompt.md` and added to `tasks/todo.md` for cleanup. Not deleted yet.

**Gaps and questions identified**
- Phase 6 in `tasks/todo.md` is partially captured in `wiki/synthesis/project-status.md` (read was truncated at line 60) — recommend a follow-up read of the full file to backfill remaining shipped items and any "Up Next" entries.
- No wiki coverage yet for: the Purchasing v1 work (POs, approvals, receiving, credit notes), the Stock Room, Recipe Lab/Patisserie Lab/Spirits Lab as distinct entities, the Community / The Bench, or RBAC roles + permissions architecture. These are real pieces of the product per `CLAUDE.md` and `docs/architecture/overview.md` but have no dedicated docs to migrate from.
- Mobile repo is separate; web side has the API contract but no architectural doc describing the cross-repo handshake (commit `128a119`, prompt runtime guard tests in `c263bad`). Would benefit from a `wiki/concepts/mobile-api-contract.md`.
- `tasks/lessons.md` was only read to ~line 60 — the lessons-index lists 1–8 explicitly; remaining ~37 entries should be skimmed and added to the index in a follow-up session.

**Originals preserved**
No files moved. No files deleted. Wiki is purely additive.

## 2026-05-26 — Recipe purge FK fix + schema drift catalog

**Problem**: Server logged `Recipe archive purge failed` on every startup. PG error 23503: `recipe_version_recipe_id_fkey` FK had no ON DELETE rule, so `purgeArchivedRecipes` couldn't delete recipes that had any version rows.

**Fix shipped**:
- Edited `packages/server/src/db/schema.ts` — added `onDelete: "cascade"` to `recipeVersion.recipeId` FK, `onDelete: "set null"` to `prepTask.recipeId` and `prepMenuSelection.recipeId`.
- Wrote `packages/server/scripts/fix-recipe-fk-cascade.ts` — targeted tsx migration that applied the two real FK changes (`recipe_version` → CASCADE, `prep_menu_selection` → SET NULL) in a transaction. Verified via `scripts/check-recipe-fks.ts`.
- `drizzle-kit push` aborted before applying anything (pg_stat_statements_info bug + unrelated drift it wanted to surface). Used the targeted script instead.

**Drift surfaced (NOT fixed today, see synthesis page)**:
1. `prep_task.recipe_id` — code declares FK with SET NULL, DB has no constraint at all.
2. `knowledge_document.file_path` — column dropped from code, DB still holds 18 rows.
3. Five unique constraints declared but missing on live DB (`guide.guide_key`, `model_option.model_id`, `bench_channel.channel_key`, `recipe.slug`, `store_location.store_key`).
4. `drizzle-kit push` bug: tries to drop `pg_stat_statements_info` view, postgres rejects.

**Wiki pages touched**
- Created `wiki/synthesis/schema-drift-may-2026.md` — full drift catalog + safe migration workflow.
- Updated `wiki/index.md` — added synthesis entry.
- Appended `tasks/lessons.md` — lesson #50 (never `drizzle-kit push` blind).

**Rule going forward**: until the drift list is zero, all schema changes go through targeted tsx scripts under `packages/server/scripts/` following the `apply-ckm-feedback.ts` pattern. No `drizzle-kit push`.

## 2026-06-16 — Org-admin permissions + supplier address

Fixed two onboarding blockers and added supplier addresses (branch `fix/ck-web/org-create-admin-role-state`):
- **Org admin → inventory perms**: new org creators (system role Subscriber) got 403 "Insufficient permissions" on inventory/purchasing routes. `getUserWithRolesAndPermissions` now unions an `ORG_ADMIN_PERMISSIONS` set when the user is `admin` of any org; `handleCreateOrganisation` re-mints the JWT (exported `setAuthCookies`) so perms apply without re-login. See lesson #51.
- **Location-less org resolution**: `resolveOrgId` (8 copies) derived org from location context only → 400 for location-less admins. `LocationContext` now exposes `organisationId` from membership; each `resolveOrgId` falls back to it.
- **Supplier address**: `supplier` table gained the 6-field address block (mirrors organisation/store_location). Migration via targeted tsx script `scripts/add-supplier-address.ts` (no `drizzle-kit push`, per lesson #50). Wired through Zod schemas, `createSupplier`/`updateSupplier`, client `Supplier` type, and the `SupplierManager` form. Verified create+update round-trip via API.

## 2026-06-17 — Single .env consolidation (branch: feature/ck-web/centralise-env)

Collapsed `.env`, `.env.production.local`, `.env.example`, `packages/client/.env.test`, and `packages/client/.env.test.example` into a single root `.env` with `DEV_*` / `PROD_*` prefixes. New `packages/server/src/utils/envShim.ts` runs immediately after `dotenv.config()` and copies the active set (per `APP_ENV`, default `dev`) into the unprefixed slots the app already reads. Boot guard in `db/index.ts` updated to honor `APP_ENV=prod` as the local opt-in for remote DB access (in addition to Render's `NODE_ENV=production`). Playwright config now reads `../../.env`. Scripts and `db/seed.ts` call `applyEnvPrefix()` after their own `dotenv.config()`. See [[single-env-file]] for full rationale and the latent JWT-secret bug it documents but does not fix.

## 2026-06-17 — Remove on-device prompt runtime (branch: feature/ck-web/remove-device-prompts)

Mobile pivoted to server-side chat on 2026-06-15 (shared-context decisions). Removed every on-device-runtime surface: `prompt.runtime` column + CHECK constraint, `routes/mobilePrompts.ts`, `controllers/mobilePromptsController.ts`, `errors/promptErrors.ts` (`PromptIsDeviceOnlyError`) + its middleware mapping, `setPromptRuntime` service + `PATCH /:name/runtime` controller, runtime field in create/get/list responses, client `OnDeviceRuntimeBanner.tsx` + `usePrompt.ts` hook + runtime toggle in `PromptsTab`. Data cleanup: one-shot `scripts/removeAntoineMobilePrompts.ts` deletes the two Antoine prompts (delete the script after running once against prod). Mobile RAG, feedback, feature-flags, and auth all stay. See [[remove-device-runtime-prompts]] for rollback commits.

## 2026-06-19 — Supplier read-gating fix + JWT-secret latent-bug documentation (branch: fix/ck-web/supplier-read-gating)

Re-gated the two supplier *read* routes (`GET /suppliers`, `GET /suppliers/:id/locations`) from `inventory:manage` to `inventory:count`, matching every other inventory read and unblocking the free-Subscriber / mobile Suppliers screen (was 403). Writes stay on `inventory:manage`. Added `packages/server/src/routes/inventory.test.ts` (introspects the real router, runs the actual permission middleware per route). Live-verified with real tokens: count → GET 200 + writes 403; manage → GET 200; no token → 401. Updated shared-context `api-contracts.md` (new "Endpoint I — Inventory Suppliers") and `web-needs.md` (DONE note for mobile Phase 1).

While verifying, **empirically confirmed** the long-documented latent JWT-secret bug: `authService.ts` captures `ACCESS_SECRET`/`REFRESH_SECRET`/`MFA_SESSION_SECRET` at module-load (before `applyEnvPrefix`), so dev silently uses the `"dev-access-secret"` fallback and ignores `DEV_JWT_ACCESS_SECRET`. Promoted from a buried "Limits" note to a first-class lesson (#53), a tracked `tasks/todo.md` item, and strengthened the [[single-env-file]] Limits entry with the empirical proof + full scope (prod unaffected; `CLIENT_URL` same class but cosmetic). Not fixed in this branch — kept the supplier PR focused.

## 2026-06-19 — Fix JWT-secret module-load capture (branch: fix/ck-web/jwt-secret-module-load)

Fixed the latent bug documented in [[single-env-file]] + lessons.md #53. `authService.ts` captured `ACCESS_SECRET`/`MFA_SESSION_SECRET` at module load (before `applyEnvPrefix`), so dev silently used the `"dev-access-secret"` fallback and ignored `DEV_JWT_ACCESS_SECRET`. Converted both to call-time getters (`accessSecret()`/`mfaSessionSecret()`) per lesson #3; removed the dead `REFRESH_SECRET` const (refresh tokens are random bytes hashed in the DB, never a JWT — an unused capture of the same bug class). Verified end-to-end on the running dev server: real `DEV_JWT_ACCESS_SECRET` token → 200, old fallback token → 401 (exact inversion of pre-fix). Regression locked by new `authService.test.ts` (rotates the env secret mid-run). Prod was always unaffected (Render injects the unprefixed secret at boot). Applying the fix invalidated dev tokens signed with the old fallback once — re-login. Full suite 395 passing.

## 2026-06-30 — Cloudflare Turnstile on login/register/forgot-password (branch: feature/ck-web/turnstile-auth)

Added hard-enforced Cloudflare Turnstile to the three unauthenticated auth endpoints. New `cloudflare` category in the Integrations panel stores the site + secret keys (encrypted, admin-rotatable, no rebuild). New `turnstileService.verifyTurnstileToken` (fail-closed) verifies tokens via Cloudflare siteverify; `authController` rejects login/register/forgot-password with 400 before any action when the check fails. New public `GET /api/auth/turnstile-config` serves only the site key to the browser. Frontend `TurnstileWidget` (zero npm dep, explicit-render) renders on all three pages; submit gated until solved; single-use token auto-resets on error. New page [[turnstile-bot-protection]]. Verified: 404 server + 22 client tests pass, tsc + lint clean both packages, curl smoke (real secret rejects bogus tokens via Cloudflare), and live browser render of the real challenge with the configured site key on all three pages. Turnstile's checkbox intentionally can't be auto-solved headlessly (CDP input denied) — the only manual step is a human solve for a full authenticated login.

## 2026-06-30 — Turnstile enforcement narrowed to web-only (ship review caught mobile break)

During `/ship` review of the Turnstile branch, the API-contract reviewer caught that making `turnstileToken` REQUIRED on `/api/auth/login` + `/register` would 400 every mobile request — mobile shares those endpoints ([[mobile-api-contract]]) and can't render the browser widget. Reworked to **web-only enforcement**: `turnstileToken` is now optional in the Zod schemas, and `enforceTurnstileForWeb()` only runs the check when a browser `Origin` header is present; native (no Origin) requests skip it. Added `authRateLimit` (20/min per IP, hashed) as the non-browser abuse backstop. Updated [[turnstile-bot-protection]] and [[mobile-api-contract]] (per its change protocol), plus shared-context `api-contracts.md` (new Endpoint J), `web-needs.md`, and `decisions.md` (web-only decision + mobile native-attestation follow-up question). Verified live: web (Origin) rejects missing/bogus tokens; mobile (no Origin) login/register/forgot-password flow through. Full suite 489 passing (server 416 incl. mobile-regression + forgot-password + config-endpoint + authRateLimit tests).

## 2026-07-01 — Sidebar: rename Test Kitchen, accordion groups, location replaces Open Beta

Three UX changes to the desktop sidebar ([[role-aware-navigation]]). (1) Renamed the "Test Kitchen" group to **Food Laboratory** in `navConfig.ts` (label + comments; route paths and `id` unchanged). (2) Turned the nav groups into an **accordion** — lifted open/closed state into `SidebarNav` as a single `openSectionId`, made `SidebarGroup` a controlled component (`open`/`onToggle`), so expanding one group collapses the rest; groups start collapsed. (3) Removed the **"Open Beta"** badge under the title so the `LocationChip` sits in its place. `tsc --noEmit` clean on `@culinaire/client`; `navConfig.test.ts` unaffected (no label assertions).

## 2026-07-04 — Documented the Brain memory implementation plan

Moved the approved, fully-reviewed plan for **the Brain** (per-user + per-org AI memory) into the repo so it survives across machines.

- Added `docs/specs/brain-memory.md` — the canonical, resume-ready spec (native pgvector, two-tier scope, exact-scan recall, `recordMemory` never-rejects, flag-gated, phased 3 ways). Reviewed by CEO + Eng + Design + two outside-voice passes (16 findings folded).
- Added `wiki/concepts/brain-memory-plan.md` + index entry as the discovery hook: "brief me on the current plan" → show `docs/specs/brain-memory.md`.
- Added a pointer + Phase 1 task list to `tasks/todo.md`.
- Next: implement Phase 1 (T1-T10 + D-T1..D-T3) on `feature/ck-web/brain-spine`.

## 2026-07-05 — The Brain Phase 1 implemented (feature/ck-web/brain-spine)

- Implemented the full Phase-1 user-scope spine from `docs/specs/brain-memory.md`: T1–T10 + D-T1..D-T3. New table `brain_memory` (pgvector, NO ANN — exact scan per E3), `brainSanitize`/`brainCaptureService`/`brainWorker`/`brainRecallService`/`brainService`, chat capture in `handleSaveMessages`, `streamChat` await-parallelisation + recall splice + `brain_grounded` annotation, "Your Brain" page (`/your-brain`) + `BrainGroundedChip`/`MemoryRow`/`ProvenanceChip`/`BrainEmptyState`, permissions + flags (OFF) + `backfillBrainPermissions.ts`, admin `GET /api/brain/stats`.
- Verified: LIVE capture→embed→recall round-trip on local dev (Antoine recalled a prior-session hollandaise fix, grounded chip fired); curl auth matrix on all routes; browser walkthrough incl. 375px mobile, expand, delete, empty state; 21 Brain tests incl. A∦B isolation canary; full suites green (server 479 / client 42 / shared 51); tsc + lint + build clean. Flags reset to OFF (ship posture).
- Deviations documented in the spec's new "Implementation status" appendix (worker claims pending-only; no Phase-1 resolveActiveOrg; targeted DDL script instead of drizzle-kit push; Brain-block fallback append when `{{KITCHEN_CONTEXT}}` is missing; per-item sanitizeForPrompt).
- New wiki page: `entities/the-brain.md` (+ index entry). New lessons: #55 (admin-editable prompt lost the `{{KITCHEN_CONTEXT}}` placeholder — injection must not silently no-op; prod check required before enabling recall) and #56 (drizzle-kit push interactive/dangerous on this drifted DB — new tables ship as targeted idempotent DDL scripts; see `scripts/createBrainMemoryTable.ts`).

## 2026-07-08 — The Brain Phase 2 T11 (org tier) built + tested (feature/ck-web/brain-org-tier)

- Implemented T11 org-tier foundation from `docs/specs/brain-memory.md`: per-org shared memory recall + management with hard tenant isolation, resolved to a single active org. New `services/activeOrgService.ts` (`resolveActiveOrg` deterministic chain E-fold #8 with a mandatory live-membership recheck; `switchOrganisation` plumbing for T12/UI). Recall now two-tier — own `scope='user'` OR the active org's `scope='org'` — in both the exact-cosine scan and the `hasReadyMemory` gate (`brainRecallService.ts`); `activeOrgId` threaded `chatController → streamChat → recall`, resolved OUTSIDE the 2s budget race. `listMemories` gains the org tenant boundary + a `scope` filter; `deleteMemory` gains the org-admin-of-owning-org path (E5). Schema: `user.selected_organisation_id` (+FK) + `idx_brain_memory_org_scope`, shipped via idempotent `scripts/addBrainOrgTier.ts`.
- Verified: server suite 513/513; 17 real-DB org-tier integration tests incl. the **X∦Y** org-isolation canary and the **ex-member** canary (stale `selected_organisation_id` refused — no live membership → null); resolver unit rungs; delete-authorisation matrix; byte-identical recall-off regression; tsc clean; migration idempotent (run twice); live curl smoke on `/api/brain/memories` (401/200/400, scope filter) + non-admin org delete refused → 404 with the memory surviving.
- Deviations (deliberate): active-org resolved in `chatController` (the real recall splice), not `conversationController` (capture site, untouched — chat stays private); delete-matrix lives in the integration suite (needs a real DB) since no new route/permission was added; local dev DB was missing the Phase-1 `brain_memory` table so `createBrainMemoryTable.ts` ran before `addBrainOrgTier.ts` (prod already has it).
- Carried risk for T12: the capture upsert unique target `(user_id, source_type, source_ref)` excludes `scope`/`organisation_id` — harmless now (no org writers), but T12 must fix it before shipping org-scope ops writers or an ops event can scope-flip/clobber a private row.
- Not yet merged/deployed. Next: T12 (ops-event capture).

## 2026-07-08 — The Brain Phase 2 T12 (ops-event capture) built + tested (feature/ck-web/brain-org-tier)

- Implemented T12: the Brain now captures curated kitchen-ops events, so a colleague's actions become recallable "kitchen memory". New `recordOpsEvent` wrapper in `brainCaptureService.ts` — a discriminated union over 7 event types + a `buildOpsBody` switch that builds a **deterministic plain-English template** per event (chosen over the spec's LLM ops distiller: free, instant, zero injection surface; free-text sanitized per-field via `sanitizeMemoryText` BEFORE framing, lesson #57). Fired `void recordOpsEvent(...)` after each write commits at 9 call-sites: PO submitted/approved/received (controller, `scope='org'`, `sourceRef=${poId}:${stage}`), waste/stock/prep (service, `scope='org'`), recipe saved/refined (`scope='user'` — recipes have no org column), menu created/updated (`scope='org'` via `getUserOrgContext`, gated to semantic fields only so nightly analytics writes don't spam re-embeds).
- **No schema/migration change.** The T11 "carried risk" (add org to the upsert unique index) was WITHDRAWN after analysis: ops `sourceRef`s are globally-unique entity UUIDs + fixed per-type scope, so `(user_id, source_type, source_ref)` already can't collide across orgs; adding `organisation_id` would break user-scoped recipe dedup (Postgres NULL-distinct → duplicate inserts) and `NULLS NOT DISTINCT` would break chat.
- Verified: server suite 522/522; 20 template/posture unit tests + the T12 ops canary (adminY logs waste → worker embeds → colleague userY recalls it, userX in another org does not — the first true end-to-end "kitchen memory" proof); tsc clean; live curl smoke — `POST /api/waste` produced a `brain_memory` row `scope='org'`, `source_type='waste'`, templated body "Waste logged: 1.500 kg of …", `status=ready`, embedded. Flags reset to OFF; fixtures cleaned.
- Not yet committed/merged. Next: T13 (recall in Labs + Copilot).

## 2026-07-08 — The Brain Phase 2 T13 (recall in the Creative Labs) built + tested (feature/ck-web/brain-org-tier)

- Implemented T13: Recipe/Patisserie/Spirits Lab generation + recipe refinement are now grounded in the recalled `## Brain Memory` block, the same as chat. All three Labs share `recipeService.generateRecipe`, so one splice covers them: recall query seeded from the brief + domain params (`request`, `cuisine`, `spiritBase`, `pastryType`, `drinkStyle`, `mainIngredients`), `recallMemoriesWithBudget` fired concurrently with the RAG search, and `brainRecall?.block` injected into `buildUserMessage` in D5 order (kitchen context → Brain → RAG → request). `activeOrgId` resolved in `recipeController.recipeHandler` (and `handleRefineRecipe`) via `resolveActiveOrg`, threaded through `RecipeInput.activeOrgId` / new optional `refineRecipe(userId, activeOrgId)` params. The retry path reuses the same user message, so grounding carries across attempts.
- **Scope: Labs only — Copilot deferred.** "Kitchen Copilot" is the prep module and `generateTasksFromSelections` is pure scoring math with NO LLM call, so there is no prompt to ground; wiring Copilot recall requires first adding an AI step to prep (a net-new feature). No schema/migration; no API-contract change (the Labs "grounded in your Brain" chip rides a future response field, deferred to the Your-Brain UI work ~T14).
- Verified: server suite 529/529; 7 new splice tests (`recipeService.test.ts` + `recipeRefinementService.test.ts`) capturing the exact prompt handed to `generateObject` — assert the block appears in D5 order when recall hits, is byte-identical (no Brain text) when recall returns null, the query is seeded per-domain, and org is threaded; tsc clean. Live LLM smoke was NOT runnable locally (recipe generation + embedding recall both need an OpenRouter key, absent in this `.env`) — the unit tests are the authoritative proof of the splice.
- Not yet committed. Next: T14 (rich "Your Brain" UI — run `/plan-design-review` first).

## 2026-07-08 — The Brain T14 slice 1 (Labs grounded chip) built + tested (feature/ck-web/brain-labs-chip)

- Closed the T13 deferral: the "Grounded in your Brain" trust chip now appears on Recipe/Patisserie/Spirits Lab results, matching chat. Recall already ran in the Labs (T13) but its `memories` metadata was discarded — now `generateRecipe` returns `memories` (ids + titles + sourceType only, never bodies), `recipeController.recipeHandler` adds an additive `brainGrounded` field to the JSON response, `BrainGroundedChip` gained a direct `memories` prop alongside the chat `annotations` path (chat unchanged, backward-compat tested), and `RecipeLabPage` (one shared component for all three Labs) renders the chip after the hero. No schema/migration; no API-contract break (the recipe endpoints are web-only; mobile doesn't call them).
- Verified: server suite 531/531 (+2 recipe tests: memories returned on hit, null on miss), client suite 50/50 (+4 BrainGroundedChip tests: renders from memories prop, hidden when empty/null, chat annotations path still works, dismissible); tsc + build green; live smoke — `generateRecipe` for "a miso glazed cod variation" returned `memories:[{title:"Miso Glazed Cod",sourceType:"recipe"}]` (the exact chip data) against the real recall/embedding stack.
- First slice of T14 (chosen: slice it, Labs chip first). Merged as PR #47.

## 2026-07-08 — The Brain T14b (rich "Your Brain" self-service controls) built + tested (feature/ck-web/brain-your-brain-controls)

- Turned "Your Brain" from read-only+delete+search into a management surface (spec D8 / design D-T4): pin (sorts first), correct (edit → re-embed), scope-toggle (private↔shared), scope tabs [Private | Shared], source-type filter chips, and a distinct warm no-match empty state.
- Backend: added `brain_memory.is_pinned` (boolean, default false) + partial index `idx_brain_memory_pinned` via idempotent `scripts/addBrainPinColumn.ts` (targeted DDL, not drizzle-kit push; applied to prod). New `pinMemory`/`correctMemory`/`toggleScope` in `brainService.ts` behind a single `canManage` auth helper (own row OR org-admin of the owning org — refactored `deleteMemory` to share it). `correctMemory` reuses the exact re-embed reset from capture's upsert (embedding=null, status='pending', attemptCount=0, nextAttemptDttm=null). Share (user→org) promotes to `resolveActiveOrg`; un-share (org→user) requires org-admin of the owning org. Routes `PATCH /memories/:id/pin|:id|:id/scope`, all `brain:manage`.
- Frontend: `useBrainMemories` gained scope+sourceType filters and optimistic pin/correct/toggleScope mutations (no loading flashes); new `ScopeToggle` segmented control (tablist a11y, 2-way per D-T4, default Private); `MemoryRow` gained hover-revealed pin/edit(inline textarea)/scope actions + pinned star + shared badge; `BrainEmptyState` gained a `hasQuery` no-match variant. The share UI is gated on `useLocation().hasLocationAccess` (the server is the real boundary).
- Verified: server 544/544 (route auth matrix for the 3 PATCH routes + real-DB integration for pin/correct→re-embed/scope-toggle incl. the org-admin boundary and colleague-visibility), client 58/58, tsc + build green, local migration idempotent, and a live HTTP PATCH smoke where the DB reflected pin=true/scope=org/body edited and the running worker re-embedded the corrected body against real OpenRouter. Independently reviewed APPROVE by the pr-reviewer agent. Merged as PR #48.

## 2026-07-08 — Added pr-reviewer subagent + shipped session PRs

- Ported the ARCHOS `pr-reviewer` subagent into `.claude/agents/pr-reviewer.md` (adapted to this monorepo; un-ignored `.claude/agents/`). Independent/adversarial reviewer — correctness + security + project rules, CI flake-vs-real, low-risk fixes, VERDICT output; does NOT merge (human stays the ship gate). Reviewed PR #47 and #48 (both APPROVE). Merged as PR #50.
- Shipped this session: #46 (T11–T13) earlier; #47 (Labs chip), #49 (handoff doc), #50 (pr-reviewer), #48 (T14b, with its prod `is_pinned` migration run backup-first). Prod healthy.

## 2026-07-11 — The Brain Phase 3 built + shipped end-to-end (T18 · T16 · T17) — Phase 3 complete

- Context in: Phase 2 finished (T14c PR #54 org-admin surface, T15 PR #55 org digest), and the Phase 3 **signal-capture prep** (Kimball star schema — `dim_date` 2025–2075, `dim_scope`, `fact_brain_recall`, `fact_brain_corpus`, `brain_memory.last_recalled_dttm`) shipped as PR #57 and was prod-migrated, so the design signal for the intelligence layer was accruing. `/plan-eng-review` then **un-parked** Phase 3 (superseding the 2026-07-09 park) with mechanisms + configs locked and tuning values deferred to real-data settings. Built in three sequential lanes.
- **Lane 1 — T18 (PR #59)**: extracted recall ranking weights to `site_setting`s (`brain_rank_similarity_weight` 0.7 · `brain_rank_recency_weight` 0.2 · `brain_rank_recency_halflife_days` 30, byte-identical at defaults, half-life floored at 0.001); `brainAnalyticsService` read fns (`getRecallStats`/`getCorpusStats`, analytics WHERE on the indexed `date_key`); admin dashboards in Settings → Brain (`GET /api/brain/analytics`); admin re-embed panel (`POST /api/brain/reembed-failed`). Also set `fileParallelism:false` in the server vitest config to stop a cross-file shared-DB race (a global `reembedFailedMemories()` test was clobbering another file's poisoned-row assertion).
- **Lane 2 — T16 (PR #60)**: `brainDistillService.summarizeMemories()` (ops-hardened `claude-haiku`); `brainCompactionService` picks the coldest N over a per-scope cap (`last_recalled_dttm` NULLS FIRST), summarizes → INSERTs a `digest` memory, and **soft-archives** the sources (`status='archived'`, reversible — recall/list already filter `status='ready'`); nightly under `withAdvisoryLock(brainCompaction)`, off unless `brain_compaction_enabled` + `brain_compaction_cap` > 0.
- **Lane 3 — T17 (PR #61)**: the design pass ran this session (not deferred) and we built the **full generation** — **ops-action nudges** that act on a user's most recent ready ops memory (PO/waste/stock/prep/menu) and deliver one short suggestion to the **existing notification bell** (D-T5's "For you" NudgeCard is superseded — the app has no operator dashboard to host it yet). `runNudges()` daily under `withAdvisoryLock(brainNudge)`, triple-gated (`brain_enabled` ≠ false AND `brain_nudges_enabled` === "true" AND `brain_nudge_rate_limit` > 0), per-user 7-day rate limit, dedupe on source `related_entity_id`; `generateNudgeText` is fail-soft `claude-haiku` with the untrusted body sanitized + delimited. Per-user opt-in `user.brain_nudges_opt_in` (off) + `GET|PUT /api/brain/nudges/opt-in` (`brain:read`, self-service, zod) + `NudgeOptIn` toggle on Your Brain; `NotificationBell` now renders `BRAIN_NUDGE` (and backfills `BRAIN_DIGEST`, which had been silently falling back to the "Approval needed" label).
- **pr-reviewer (PR #61): APPROVE** — independently confirmed the triple gate, no IDOR (both endpoints use `req.user.sub` only), prompt-injection hardening, no memory bodies logged, idempotent migration. Two non-blocking standards findings + one real dev-DB bug fixed in a follow-up commit: (a) the `brain_nudge_rate_limit` setting is now backfilled by the migration itself (`Number(undefined)→NaN→0` would silently disable nudges); (b) a partial index `idx_user_brain_nudges_opt_in` on the queried boolean (schema + migration); (c) the nudge test's `afterAll` had written the string `"false"` into that numeric setting on the shared dev DB — replaced the blanket fallback with real per-key defaults and repaired the value. See lesson #62.
- **Prod migration + merge**: ran `APP_ENV=prod … addBrainNudgeOptIn.ts` against the Render DB (the local `.env` holds both `DEV_`/`PROD_DATABASE_URL`; the `envShim` + `assertNotRemoteInDev` require `APP_ENV=prod` to target prod), **verified the connected host + before/after state** (column MISSING→boolean, index absent→present, rate_limit MISSING→2), then merged PR #61 `--no-ff`. Verified across the lanes: client 65/65, server 574/574, tsc + build green, CI green on both T17 commits. **Phase 3 complete; the Brain now spans capture → recall → management → org tier → digest → analytics → ranking/compaction/nudges, all flag-gated and off by default where user-facing.**

---

## 2026-07-14 — Tenant-isolation remediation: ~51 cross-tenant holes fixed, prod exposure cleared, required real-DB gate

- **Trigger**: while prepping to clear sample catalog data for org *Almost French Pâtisserie* (org 2, 0 local ingredients), Stock Room → Catalog showed a full 55-item list — org 1's (*Comfort Spoon Co.*) catalog. Root cause: a dropped org filter. `listIngredients` chained `.where()` on a `$dynamic()` query, and **chained `.where()` REPLACES the prior clause instead of ANDing it**, so `isNull(deletedAt)` overwrote `eq(organisationId, orgId)` — the default catalog load returned every tenant's rows. Proven by running the real service against local data (55→0 after fix).
- **Red-team audit** (5 parallel domain auditors): the leak was **systemic, not a one-off** — ~51 cross-tenant holes, all the same shape (newer by-id reads/mutations reached a resource by id **without threading the caller's org/owner and checking it**; older endpoints did it right). Domains: inventory, purchasing/receiving, menu/recipe, stock-take, Bench, org-management, conversations, recipes. Worst: `GET /organisations/:id` returned any org's join key + decrypted member PII by integer enumeration → tenant takeover.
- **Model made explicit** (the yardstick): **user-first, then organisation** — user-owned rows (menu_item, recipe, conversation, message) by `user_id`/`guestSessionToken`; org-shared rows (ingredient, supplier, store_location, PO, stock, org Bench channels) by `organisation_id` + `user_organisation` membership; Administrator is an intentional superuser.
- **Fixes**: 8 PRs (#64 p0 · #65 inventory · #66 purchasing · #67 menu/stock-take · #68 bench · #69 conversations/identity · #70 recipes · #71 integration tests), all merged under strict protection (verified the combined lint+tsc+575-tests+build before merging). Patterns: single `and(...conds)` not chained `.where()`; `getIngredient/getMenuItem` preflights; `AND organisation_id` in by-id WHEREs; validate client-supplied `storeLocationId`; **404 not 403** for "not yours"; org guard before status/transition checks.
- **Review fleet** (9 aligned agents: 6 pr-reviewers + completeness critic + hygiene sweep + adversarial bypass tester) caught what the first pass missed: **2 more holes** (private-recipe email exfiltration; unguarded global admin image routes → PR #70), **1 real bypass** (pin a foreign channel's message id, read it back), 2 missed inventory preflights, 3 receiving status-before-guard oracles, the org-enumeration oracle, and hygiene. All fixed + re-verified.
- **Prod exposure check** ([docs/security/prod-exposure-check.md](../docs/security/prod-exposure-check.md)): **no breach**. 22/22 contamination detectors = 0 (write-side IDORs never exploited); both prod orgs are company-internal (no external tenant); org-enumeration PII vector had a 4-person internal blast radius, now fixed. `audit_log` empty (reads unlogged) — recommend enabling auditing.
- **Durable gate**: `packages/server/src/tenantIsolation.integration.test.ts` + new CI job `Tenant isolation (real DB)` (throwaway pgvector Postgres → `drizzle-kit push` → seed 2 orgs/2 users → assert isolation on live queries), made a **required** status check on `main`. CI debugged: build `@culinaire/shared` before the suite; pgvector image + `CREATE EXTENSION` for `db:push`.
- **Docs**: full ledger [docs/security/tenant-isolation-audit.md](../docs/security/tenant-isolation-audit.md); wiki decision [[tenant-isolation-remediation]] + synthesis [[tenant-isolation]] + lesson #65. Original data task (clear the prod sample catalog, backup first) still pending.

## 2026-07-14 — Full prod backup + canonical backup-folder convention

- Took a full prod `pg_dump` (`-Fc --no-owner --no-privileges`, 63 MB, 669 objects / 84 tables, `pg_restore --list` validated) ahead of the pending sample-catalog cleanup, at `~/culinaire-prod-backups/culinaire_prod_full_2026-07-14_094717.dump`. Ran it in the background — the Render (Singapore) link is slow and a 63 MB dump exceeds a foreground shell timeout (first attempt was SIGTERM'd at a 28 MB partial, which was deleted).
- Codified the location so backups are never scattered: **one home-relative folder `~/culinaire-prod-backups/` on every machine** (see [[db-backup-location]]), outside any repo, never committed. Reinforced in lesson #63 and the `feedback_backup-before-destructive-prod` auto-memory.

## 2026-07-14 — UoM foundation + recipe-based selling (replaces the FOH-zone approach)

- Reframed "selling": a sale is a **menu-item event** that explodes the recipe and deducts each ingredient from stock — not a raw base-unit deduction. Grounded in a deep-research pass (Toast/R365/Apicbase/MarginEdge, 16 claims confirmed / 9 refuted) and 6 rounds of plan review (21 written decisions D1–D13). The earlier FOH-zone branch was discarded (preserved in a git stash) and this was built fresh on `feature/ck-web/uom-and-recipe-selling`.
- **Unit model**: `ingredient.stock_unit` (count unit, e.g. bottle) distinct from `base_unit` (ml); one `unitConversionService.resolveToBase` (row-beats-family, D9) applied at **every** stock flow — receiving (qty + cost so WAC stays per base), transfers, consumption/waste, stock take — closing a pre-existing bug where those flows pushed raw quantities into `stock_level`.
- **Selling**: new `sale` header + `consumption_log.sale_id`; `saleService.recordSale` (preflight-then-commit D1, one-level prep D2, org boundary D11), `voidSale` (D7, double-void-guarded), idempotency (D13), two-phase CSV with per-row-content keys (D3/D12). Each depletion writes a `consumption_log` row tagged `menu_item_id` + `sale_id`, so `yieldVarianceService` now gets real actual-usage data. Costing stays WAC (D4).
- **UI**: Menu & Costing → **Record sale** modal (manual + CSV + void history); Catalog "Stock" column shows the count unit (bottles).
- **Verified**: 576 server + 66 client unit tests, 23 real-DB E2E integration cases (`UOM_IT=1`) proving glass=150ml / 5 glasses=1 bottle / dish depletes+skips-free-text / resale / oversell / void / idempotency / CSV partial-re-import; full tsc + lint (0 errors) + build green. Docs: [[uom-and-recipe-selling]], [[reconciliation-matrix]], features catalog, lesson #66.

## 2026-07-15 — Kitchen-unit model (physical-reality units) replaces the display-lens approach

- User correction (after seeing "500 mL" in a stock panel): units are physical reality — every item has ONE kitchen unit it's counted in (flour g, oil ml, eggs each, **wine bottle**); packaging (case/bag) exists ONLY at ordering/receiving and converts at the receiving instant; recipes pour in ml against counted items via a content equivalence (1 bottle = 750 ml → 0.2 bottle per glass); FOH consumables/op supplies skip recipe math. This replaced the previous "stock_unit display lens" (which left ml as the default experience and would have shown flour as bags).
- **Schema**: `stock_unit`→`purchase_unit` (+`pack_qty` = kitchen units per package), new `content_qty`/`content_unit`, `consumption_log.base_qty`, `menu_item.linked_ingredient_id` (hidden 1:1 FOH sale links). Resolver order: base → packaging → explicit row (D9) → content equivalence (runtime division) → family → throw.
- **Two pre-existing bugs fixed**: `purchaseOrderService.receiveLine` added received qty RAW (2 cases would add 2, not 24 — now resolver-converted, cost too); consumption aggregations summed as-entered qty across mixed units (now sum `base_qty`; forecasts + yield variance updated).
- **Migration**: `changeKitchenUnit` (atomic stock÷factor, costs×factor incl. FIFO + supplier costs) + `backfillKitchenUnits.ts` flipped 17 wine-class items (incl. a 375 ml half-bottle) — Sancerre now reads 0.67 bottles, Belicard 8 bottles @ $15.
- **UX**: Catalog item block = Counted in / Contains / Purchased as; PO orders in packaging units (case of 12) with per-case cost; auto-PO suggests whole packages; DeliveryReceiving unit dropdown; recipe picker defaults to the measured unit with content-aware cost preview; Record-sale modal sells FOH consumables directly (auto-link, hidden from menu engineering).
- **Verified**: 31-case real-DB E2E (`UOM_IT=1`) — 2 cases=24 bottles @ $5, 5 glasses=1 bottle, void/idempotency/CSV, FOH direct sale, D9/D11 — + full regression (576 server, 66 client, tsc/lint/build green). UAT checklist rewritten (`docs/qa/uom-recipe-selling-uat.md`): mL appears nowhere except recipe lines. See [[uom-and-recipe-selling]], lesson #67.

## 2026-07-15 — Storage areas (count sheets) planned via CEO review; UAT parked at section A

- UAT surfaced the next gap live: user moved 4 bottles of Shiraz to the bar and logged it as "Internal usage — FOH" (`reason=foh_operations`) — the app's only vocabulary for an in-building move is *consume it*, a double-deduction trap for sellable stock (move −4, sale deducts again) that also poisons variance. Entry reversed (both locations back to 24 bottles).
- Deep research (verified against vendor docs): R365/xtraCHEF/Apicbase/Backbar ALL keep one venue stock number; "storage areas" organize the stocktake walk (shelf-to-sheet) + hold per-area pars — never live sub-ledgers (Backbar: "does not track real-time inventory by location"). Bar restocking = physical bottle-for-bottle ritual against pars.
- **Plan (CEO-reviewed, SELECTIVE EXPANSION, all 4 expansions accepted, 3-iteration adversarial spec loop: 11 issues found/fixed incl. a critical per-line stock overwrite in `updateStockLevelsFromSession`, final 9/10)**: `docs/specs/storage-areas-count-sheets.md`. Core: `storage_area` + `ingredient_storage_area` (+area par, sheet order) + zero-sum `stock_movement`; AREA-mode stocktakes sum to the one venue number (Unassigned bucket); restock pick list; last-counted snapshots; area spot checks (snapshot-only); ConsumptionLogger guardrail redirecting FOH "usage" of sellable items to a movement. `stock_level` gets ZERO new writers.
- Decisions: one-active-session rule kept for spot checks; reuse existing inventory permission keys; 3 deferred items in tasks/todo.md backlog.
- **UAT status**: section A (catalog kitchen units) partially tested; B–H pending. Kitchen-unit branch committed + pushed for merge; storage areas = next branch (`/plan-eng-review` first), then extend the UAT doc with an areas section.

## 2026-07-17 — Stock model locked + "Stock Room" → "Inventory" rename

- Re-ran industry research (3 agents, vendor docs + hospitality SOPs) to settle a modelling
  debate: does stock live *in* an area (retail warehouse framing) or at the venue? Confirmed the
  venue-level model is industry standard at our tier; "Stock room" (two words) is a *retail* term
  that reads as amateurish to chefs. Decision recorded: [[stock-model-and-storage-areas]].
- **Decisions locked with user:** (1) venue-level on-hand + areas-as-count-sheets is the standard;
  POS import depletes the venue pool via `consumption_log`, never an area — `store_location` is the
  only "where" axis. (2) per-area balances = deferred opt-in (hotel/high-control-bar requisition
  model). (3) Rename module **"Stock Room" → "Inventory"** everywhere incl. marketing. (4) Seed a
  minimal AU-worded default area set per location.
- **Code:** renamed labels (nav, KitchenOpsToolbar, InventoryPage, StorageAreasTab placeholders,
  StockMovementForm hint, landing Pricing/DayInTheLife/FeatureShowcase) — internal ids/routes/
  permissions were already `inventory`-based. Added `DEFAULT_AREA_NAMES` + `seedDefaultAreas()` to
  `storageAreaService.ts`, wired into `createStoreLocation` (transaction). Added idempotent
  `scripts/backfillDefaultStorageAreas.ts` for existing area-less locations.
- Branch: `feature/ck-web/inventory-rename-and-storage-area-standards`.

## 2026-08-04 — Purchasing P1 shipped to production

- **Merged PR #86** (`d73f1d8`) — order guides, order-to-par suggestions, receiving, plus the QA
  fixes and the catalog integrity gate. Render deploy **live** at 21:09:16, 0 errors in prod logs.
- **Production schema migration.** Wrote a read-only verifier
  (`packages/server/scripts/check-purchasing-p1-schema.ts`) that reports per table and column
  whether a target DB has what the branch expects. Prod was missing `order_guide`,
  `order_guide_item`, `ingredient.density_g_per_ml`, `menu_item.servings_per_sale` and all three
  `location_ingredient.suggested_par_*` columns, plus 8 guide rows. Merging without this would
  have broken the deploy, since `main` auto-deploys.
- **Corrected a dangerous note in the PR description.** It had said `drizzle-kit push` should run
  against production. It must not: push diffs the whole database and would have dropped
  `knowledge_document.file_path` with 18 live rows. See [[schema-drift-may-2026]]. The sanctioned
  path is a targeted, additive, idempotent script — `applyOrderGuideSchema.ts`, extended to cover
  every missing object and given the dotenv/`applyEnvPrefix` bootstrap it lacked (without it
  `APP_ENV` did not select a database at all).
- **Backup first:** `pg_dump -Fc`, 63 MB, verified restorable (902 objects, 88 data tables).
- **Audited `db:seed` before running it on prod:** 7 inserts, every one existence-guarded, zero
  updates, zero deletes, zero credential writes — additive only. It also added 5 new `brain_*`
  ranking/compaction settings (compaction off), which is expected but was not in the plan.
- **CI fix.** `checkCatalogIntegrity.test.ts` hit a live DB from a bare `describe()`, so it passed
  locally (`.env` supplies `DATABASE_URL`) and failed CI's unit job, which has none. Gated on DB
  availability. Deliberately not moved to the integration job: that Postgres is an empty
  throwaway where org 2 has no catalog, so all 8 checks would pass vacuously. Lesson #65.
- **Final state:** lint, tsc, 890 tests (683 server / 122 client / 85 shared), build — all pass.
  Prod verifier reads 0 missing.

## 2026-08-16 — Reviewed PR #99 (compliance information architecture)

- **Adversarial review of `fix/ck-web/compliance-information-architecture` vs `main`**, post-merge
  of the 5 Roster Core slices (PRs #94–#98). Requirements moved from the standalone Compliance
  page into Settings → Users → Compliance; My Documents moved into User Profile; the remaining
  page renamed "Team Compliance" with its gate narrowed from four permissions to two
  (`compliance:read-all`, `compliance:verify`).
- **Permission-gate narrowing verified consistent across all three layers**: server
  `routes/compliance.ts` (unchanged — still gates each endpoint individually, e.g.
  `/documents/mine` on `read-own`, `/rules` and `/required-documents` on `manage-rules`, so the
  narrower page-level gate is a safe subset, not a functional regression), the `App.tsx` route
  guard, and `navConfig.ts`'s nav gate — both narrowed identically, both carry a comment pointing
  at the other. Administrator superuser bypass confirmed present and consistent in all three
  layers (`middleware/auth.ts` line 132, `useHasPermission.ts`, `navConfig.ts`'s
  `isItemVisible`). A `read-own`-only or `manage-rules`-only user now gets no nav entry and, on a
  direct `/compliance` hit, `RequirePermission`'s "isn't on your plan" empty state rather than a
  dead single-tab shell — covered by updated tests in `CompliancePage.test.tsx`.
- **Merge-conflict resolution in `App.tsx` verified clean** via three-way diff against both
  parents (branch tip `847f742`, main tip `b44791e`): the merge result is exactly branch's
  narrowed `/compliance` gate + comment, plus main's `/roster` route, byte-for-byte — nothing
  dropped or corrupted from either side. `navConfig.ts`'s claimed clean auto-merge verified the
  same way.
- **My Documents (Profile) and Requirements (Settings) tabs verified independently gated**: the
  Profile tab only appears for `hasPermission("compliance:read-own")`
  (`ProfilePage.tsx`), and the new Settings "Compliance" tab is filtered out of the tab bar
  entirely without `compliance:manage-rules` (`SettingsLayout.tsx`'s new `permission` field on
  `TabItem`, filtered before render). Neither tab's underlying component does its own gating —
  both rely on the parent, same pattern as before the move — but both endpoints they call
  (`/documents/mine`, `/required-documents`) are independently permission-gated server-side
  regardless.
- **`RequiredDocumentsTab` padding fix confirmed complete** across all three render branches:
  loading (`p-6 py-16`), error (`m-6`), ready (`p-6`).
- Ran the three touched/added test files locally (22 tests) — all pass, independent of CI. CI
  (`Typecheck, test, build`, `Tenant isolation (real DB)`) both green, `mergeStateStatus: CLEAN`.
- **Fixed directly (low-risk, docs-only):** `wiki/entities/staff-compliance-vault.md`'s "## Client"
  section described the pre-PR four-tab `CompliancePage` layout, now false — updated to describe
  the three relocated surfaces and their gates.
- **No blocking findings.** One cosmetic pre-existing nit noted, not introduced by this PR and out
  of its scope to fix: the Roster nav entry's comment in `navConfig.ts` ("same reasoning as
  Compliance above") references Compliance's old read-own-inclusive gate, which this PR narrowed —
  the comment is now slightly stale but not incorrect as general reasoning.
- Branch: `fix/ck-web/compliance-information-architecture`, PR #99. Not merged — reviewer does not
  merge.
