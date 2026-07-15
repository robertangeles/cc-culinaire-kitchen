# Plan: Storage areas as count sheets — know what's at the bar without corrupting stock

## Context

**The trigger.** During UAT the user moved 4 bottles of Shiraz to the bar and logged it as
"Internal usage — FOH" (`consumption_log.reason = 'foh_operations'`). Stock dropped 24 → 20.
But the bottles weren't consumed — they're sellable inventory sitting in the bar fridge. When
they later sell through Record Sale, the recipe explosion deducts them AGAIN (double-deduction),
and yield variance shows 4 bottles of phantom usage. The product's only vocabulary for
"restocked the bar" is *consume it* — that's the defect.

**The research (verified against vendor docs, 2026-07-15).** Mainstream systems (Restaurant365,
xtraCHEF/Toast, Apicbase) and even dedicated bar software (Backbar: *"Backbar does not track
real-time inventory by location"*) all converge on the same model:

- ONE live on-hand number per item per venue. Never per-area ledgers at this market tier.
- Named **storage areas** (Walk-In, Freezer, Liquor, Bar…) exist to organize the **stocktake
  walk** ("shelf-to-sheet") and hold per-area pars — an item can appear on multiple areas'
  count lists.
- Bar restocking is a physical ritual (bottle-for-bottle swap) driven by par levels, not a
  software ledger. Internal moves are at most an audit note, never a stock mutation.
- Variance = theoretical usage (from sales) vs the physical count, at venue level.

Why not sub-ledgers: every physical move would need a matching data entry or the ledgers drift
within days — a permanent nightly bookkeeping tax. The kitchen-unit model just established ONE
stored truth per item per site; splitting it per area re-introduces drift.

**Decisions locked (user, 2026-07-15):** Approach = storage areas as count sheets (B);
review mode = Selective Expansion; all four expansions accepted (E1 area snapshot, E2 movement
log, E3 shelf-to-sheet ordering, E4 area spot check).

## The model

- `stock_level` stays keyed `(store_location_id, ingredient_id)` — **untouched**. Selling,
  receiving, transfers, FIFO, WAC: zero changes.
- A **storage area** is a named place within one site (Stock Room, Bar, FOH Counter, Walk-in).
- An item is **assigned to one or more areas** (wine: Stock Room + Bar), each assignment
  carrying an optional per-area par and a shelf sort order.
- **Stocktakes walk area by area** when a site has areas; per-item area counts **sum to the
  venue count**. No areas defined → sessions behave exactly as today (category mode).
- **Area quantities are snapshots from counts** (stamped with the count date), never live
  ledgers. Movements are audit notes with zero stock effect.

```
  ORDER (case/bag) ──receive──▶ VENUE STOCK (kitchen units, ONE number) ──sale/waste──▶ gone
                                     ▲                │
                                     │ counts SUM up  │ organizes the walk
                                     │                ▼
                              ┌─ Stock Room count ─ Bar count ─ FOH count ─┐   ← count sheets
                              │  (per-area par → "bring up 4" restock list) │
                              └─ stock_movement: Stock Room → Bar (0 stock) ┘   ← audit only
```

## Schema (OLTP, 2NF; every FK indexed; naming per project standards)

### New: `storage_area`
```
storage_area_id     uuid PK default gen_random_uuid()
organisation_id     integer NOT NULL FK → organisation        (idx)
store_location_id   uuid NOT NULL FK → store_location         (idx)
area_name           varchar(50) NOT NULL
sort_order          integer NOT NULL DEFAULT 0
is_active_ind       boolean NOT NULL DEFAULT true
created_dttm / updated_dttm
UNIQUE (store_location_id, area_name)
CHECK (area_name <> 'Unassigned')   -- reserved sentinel for the AREA-mode bucket
```
`storageAreaService` also validates the reserved name server-side with a plain message
("'Unassigned' is reserved — choose a different area name") so the operator never sees a
raw constraint error.
2NF: all non-key columns depend only on the PK. OLTP.

### New: `ingredient_storage_area` (junction; entity names alphabetical ✓)
```
ingredient_storage_area_id  uuid PK
ingredient_id               uuid NOT NULL FK → ingredient      (idx)
storage_area_id             uuid NOT NULL FK → storage_area    (idx)
area_par_level              numeric(10,3) NULL    -- in the item's kitchen unit
sort_order                  integer NOT NULL DEFAULT 0   -- shelf-to-sheet order (E3)
created_dttm / updated_dttm
UNIQUE (ingredient_id, storage_area_id)
```
2NF. `area_par_level` follows the `location_ingredient.par_level` precedent (kitchen units).

### New: `stock_movement` (E2 — audit trail, ZERO stock effect by design)
```
stock_movement_id     uuid PK
organisation_id       integer NOT NULL FK                     (idx)
store_location_id     uuid NOT NULL FK → store_location       (idx)
ingredient_id         uuid NOT NULL FK → ingredient           (idx)
from_storage_area_id  uuid NOT NULL FK → storage_area         (idx)
to_storage_area_id    uuid NOT NULL FK → storage_area         (idx)
quantity              numeric(10,3) NOT NULL CHECK (quantity > 0)
unit                  varchar(20) NOT NULL
base_qty              numeric(12,4) NOT NULL   -- resolver-converted at insert (kitchen units)
user_id               integer NOT NULL FK
notes                 text NULL
moved_at              timestamptz NOT NULL DEFAULT now()
created_dttm / updated_dttm
CHECK (from_storage_area_id <> to_storage_area_id)
```
2NF. Service validates both areas belong to the same `store_location_id` + org (cross-tenant
guard) and the ingredient belongs to the org. Writes touch NO stock table.

### Extended: stock take tables (nullable columns — fully backward compatible)
```
stock_take_session  + session_mode varchar(10) NOT NULL DEFAULT 'CATEGORY'
                      CHECK (session_mode IN ('CATEGORY','AREA'))   -- typos fail loudly, never persist
                    + spot_storage_area_id uuid NULL FK → storage_area (idx)  -- E4; non-null ⇒ spot check
stock_take_category + storage_area_id uuid NULL FK → storage_area (idx)  -- AREA mode: one claimable group per area
stock_take_line     + storage_area_id uuid NULL FK → storage_area (idx)  -- AREA mode: one line per (ingredient, area)
```
- AREA mode: groups are areas (claim/parallel-count machinery reused wholesale — bartender
  claims Bar, chef claims Walk-in). Items assigned to N areas appear on N sheets; venue
  counted qty = `SUM(lines per ingredient)`. Variance stays venue-level (expected vs sum).
- **Unassigned bucket**: items with no area assignment get an "Unassigned" group
  (`storage_area_id NULL`) so nothing is silently missed. Zero silent failures. The item
  universe is EXACTLY the one existing session creation already uses (do not invent a new
  predicate — parity with CATEGORY mode is the correctness property), anti-joined against
  active-area assignments:
  ```sql
  -- Unassigned = session's normal item universe minus items assigned to an ACTIVE area here
  ... existing session item-sourcing query ...
  AND NOT EXISTS (
    SELECT 1 FROM ingredient_storage_area isa
    JOIN storage_area sa ON sa.storage_area_id = isa.storage_area_id
    WHERE isa.ingredient_id = <item.ingredient_id>
      AND sa.store_location_id = <session.store_location_id>
      AND sa.is_active_ind = true)
  ```
- CATEGORY mode (or no areas defined): exactly today's behavior; new columns stay NULL.
- **E4 spot check** (`spot_storage_area_id` set): session covers ONLY that area's assigned
  items; approval **never touches `stock_level`** — it refreshes the area snapshot and shows
  drift vs that area's previous count. UI labels it "Spot check — does not adjust site stock"
  everywhere (list, review, history). Full sessions may be CATEGORY or AREA mode; only
  AREA-mode full sessions update area snapshots.

### E1 area snapshot — derived, not stored
"Bar: 5 · Stock Room: 19 — as of Mon" = latest APPROVED session line (full AREA-mode or spot)
per `(ingredient, storage_area)`, query-time. No snapshot table → nothing to drift or backfill.
The concrete query (NOT `MAX(created_dttm)` — a session created earlier but approved later must
win; order by the session's approval timestamp, verify the exact column name at implementation):
```sql
SELECT DISTINCT ON (l.storage_area_id, l.ingredient_id)
       l.storage_area_id, l.ingredient_id, l.counted_qty, s.<approval_timestamp> AS counted_at
FROM stock_take_line l
JOIN stock_take_session s ON s.session_id = l.session_id
WHERE s.store_location_id = $1
  AND s.session_status = 'APPROVED'
  AND l.storage_area_id IS NOT NULL
ORDER BY l.storage_area_id, l.ingredient_id, s.<approval_timestamp> DESC;
```
Composite index to serve it (stated query: the DISTINCT ON above):
`idx_stock_take_line_area ON stock_take_line (storage_area_id, ingredient_id)` partial
`WHERE storage_area_id IS NOT NULL`. One query per location (optionally filtered by
ingredient for the modal) — never N+1 per ingredient.

## Server changes

1. **`storageAreaService.ts`** (new): CRUD areas (org+location scoped), assign/unassign items,
   set `area_par_level` + `sort_order`, list areas with item counts. Deactivating an area with
   assignments: soft (`is_active_ind = false`), history intact.
2. **`stockMovementService.ts`** (new): create movement (same-location + same-org validation;
   `base_qty` via `resolveToBase` — consistent with `consumption_log.base_qty`); list movements
   merged into the item transaction feed ("⇄ Moved 4 bottle · Stock Room → Bar").
3. **`stockTakeService`** (extend):
   - AREA-mode session creation: groups = active areas + Unassigned; sheets pre-sorted by
     `ingredient_storage_area.sort_order`. **Category names in AREA mode equal
     `area.area_name`; per-session uniqueness is guaranteed by the existing
     `UNIQUE(store_location_id, area_name)` on `storage_area` — do not substitute another
     naming scheme** (the `idx_stock_take_category_unique(sessionId, categoryName)`
     constraint depends on it).
   - **CRITICAL — the summing fix**: `updateStockLevelsFromSession`
     (stockTakeService.ts:872–896) currently iterates categories → lines and calls
     `upsertStockLevel` once PER LINE. In AREA mode an ingredient counted in two areas would
     get last-area-wins (Shiraz: Bar 1.5 overwrites Stock Room 5 → stock 1.5, not 6.5).
     For AREA-mode sessions replace that loop with one grouped query —
     `SELECT ingredient_id, SUM(counted_qty) FROM stock_take_line JOIN stock_take_category
     USING (category_id) WHERE session_id = $1 GROUP BY ingredient_id` — then ONE
     `upsertStockLevel` per ingredient with the sum. CATEGORY mode keeps the existing loop
     unchanged.
   - **`approveSession` (stockTakeService.ts:539) branches explicitly, all three named**:
     `spotStorageAreaId` non-null → skip `updateStockLevelsFromSession` entirely, refresh
     snapshot only; null + AREA mode → the new summing variant; null + CATEGORY mode →
     existing path untouched.
4. **Area snapshot + restock endpoints**: snapshot query above; restock list =
   `max(0, area_par_level − last_counted(area))` per assigned item with a par, in kitchen
   units + package hint via `pack_qty` (same pattern as auto-PO's `suggestedPackages`).
   **Units are already consistent — no conversion step**: under the kitchen-unit model
   `base_unit` IS the kitchen unit, `stock_take_line.counted_qty` is stored base-normalized
   by `saveLineItem`'s existing `convertToBase`, and `area_par_level` is defined in the same
   kitchen unit. par 6 (bottles) − counted 2 (bottles) = bring up 4. Do not add a resolver
   call here; assert unit consistency in the restock unit test instead.
5. **Routes** (`routes/inventory…`, thin, all behind existing inventory permission middleware —
   reuse the keys already gating catalog admin + stock takes; a NEW permission key only if
   audit finds no fit, then the full 6-step checklist from CLAUDE.md applies):
   - `GET/POST /locations/:locationId/storage-areas`, `PATCH/DELETE /storage-areas/:areaId`
   - `PUT /storage-areas/:areaId/items` (assign / par / order)
   - `GET /locations/:locationId/storage-areas/snapshot?ingredientId=…`
   - `GET /locations/:locationId/storage-areas/restock-list`
   - `POST /locations/:locationId/stock-movements`, `GET …/stock-movements`
   - stock-take create accepts `sessionMode` / `spotStorageAreaId`
   Integration tests per route: 200 happy / 401 no token / 403 no permission / 400 invalid /
   404 cross-org (tenant isolation asserted for every id param).

## Guardrail (the original bug)

- **Prerequisite (verified gap)**: `ConsumptionLogger.tsx` has no `itemType` on its items
  today — the intercept would silently never fire. First confirm `item_type` is returned by
  the inventory list endpoint and present in the `useInventory` item shape; if missing, add
  it to the location-items select and the hook's TypeScript type. The intercept reads
  `selectedItem.itemType`.
- **Client** (`ConsumptionLogger.tsx`): reason = FOH + item type ∈ {FOH_CONSUMABLE,
  KITCHEN_INGREDIENT} → intercept before submit: *"Taking stock to the bar or front of house?
  That's a move, not usage — stock stays at this site until it's sold or wasted."*
  Buttons: **[Record as movement]** (opens the E2 movement form prefilled) / [Log as usage
  anyway] (escape hatch — staff spritz comps etc. exist). OPERATIONAL_SUPPLY unaffected
  (napkins to the floor ARE consumed).
- **Server**: stays permissive (this is data hygiene, not access control), but the movement
  route is the sanctioned path.
- **Data repair (step 0)**: delete the 4-bottle `foh_operations` row via the existing
  consumption-log delete path (it already restores stock via `resolveToBase`) → Patisserie
  back to 24 bottles; verify with the same SQL used to find it.

## Client changes

1. **Areas admin** — new "Areas" sub-tab in Stock Room (admin-gated): per-location area list
   (create/rename/reorder/deactivate), per-area item assignment picker, per-item area par +
   drag ordering (E3, `sort_order`). Empty state invites: "Create your first area — Stock
   Room, Bar, FOH counter…".
2. **Ingredient modal** (`IngredientCatalog.tsx`): "Storage areas" chips per current location
   + E1 snapshot rows inside Stock Across Locations: `Bar 5 bottle · counted Mon` with the
   venue number unchanged as the headline. Read-only here; edit lives in the Areas tab.
3. **Stock take flow**: when the location has active areas, new sessions default to AREA mode
   (toggle back to category available at creation). Group cards = areas; keypad unchanged
   (counts in kitchen units — bottles, kg, each).
4. **Movement quick action**: "Move between areas" on the Transfers/Internal-Usage surface +
   the guardrail redirect. Form: item → qty (kitchen unit) → from-area → to-area → note.
5. **Spot check** (E4): "Spot check this area" from the Areas tab / stock-take tab; banner
   "Snapshot only — site stock is not adjusted" on entry, review, and history rows.
6. All copy in chef language; no location gets area features until it defines areas.

## Edge cases / shadow paths (traced)

- **Item in zero areas** during AREA-mode count → Unassigned bucket (never dropped).
- **Item in two areas, only one counted** (sheet submitted, other claimed but empty) →
  session cannot be approved until every group is submitted (existing category-status
  machinery already enforces this).
- **Area deactivated mid-session** → session snapshot of groups is taken at creation
  (existing pattern); deactivation affects future sessions only.
- **Double-submit / stale movement form** → movement create is idempotent-enough (no stock
  effect); rapid double-click guarded client-side (disable on submit — existing pattern).
- **Spot check misread as full count** → labeled at entry, review, approval, and history;
  approval writes no `stock_level`; integration test asserts stock unchanged.
- **Cross-org probes**: every new route 404s on ids outside the caller's org (tests).
- **Fractional kitchen units** (6.5 bottles split 5 cellar + 1.5 bar) → numeric(10,3) counts
  per line, sum preserves decimals — same precision as venue counts today.
- **Par without count** (area par set, area never counted) → restock list shows "not counted
  yet" rather than assuming zero (no false "bring up everything").

## Observability

- Movement + area CRUD go through the existing audit/logging middleware (pino), tagged with
  org/location/user like consumption logs.
- Spot-check approvals log `session_type=AREA_SPOT, stock_effect=none`.
- No new dashboards required; the restock list IS the operator-facing signal.

## Build order (each step verifiable)

0. Data repair: delete the 4-bottle foh_operations row (stock restores to 24) → verify SQL.
1. Schema: author the COMPLETE DDL (3 new tables, 5 nullable columns, all FK indexes, the
   partial index, ALL FOUR CHECK constraints (reserved name, session_mode, quantity > 0,
   from ≠ to), the UNIQUE constraints) as one idempotent script —
   `packages/server/src/scripts/migrateStorageAreas.sql` — applied with a single
   `psql "$DEV_DATABASE_URL" -f …` (drizzle-kit push still blocked by pre-existing
   bench_channel drift; same script is the prod apply artifact later); drizzle schema.ts
   updated to match. → verify: `\d` each table, FK indexes present, CHECKs reject bad input.
2. `storageAreaService` + routes + unit/integration tests → verify: suite green, curl 200/401/403/404.
3. `stockMovementService` + routes + guardrail intercept in ConsumptionLogger + tests
   → verify: movement writes zero stock delta (asserted), intercept shows for wine not napkins.
4. Stock take AREA mode (groups, sum-to-venue, Unassigned) + spot check (no stock write)
   + tests → verify: integration scenario counts 5 cellar + 1.5 bar → venue 6.5.
5. Snapshot + restock endpoints + tests → verify: par 6, counted 2 → "bring up 4 (≈1 box)".
6. Client: Areas admin tab (assignment, par, drag order), ingredient-modal chips + snapshot,
   stock-take area cards, movement form, spot-check flow.
7. UAT fixture: Patisserie gets Stock Room + Bar; Shiraz assigned to both, bar par 6;
   San Pellegrino → Bar; flour → Stock Room; napkins stay unassigned (proves the bucket).
8. Full regression (pnpm test, tsc ×3, lint, build) + extend `uomAndSelling.integration.test.ts`
   with an area scenario + new UAT section in `docs/qa/uom-recipe-selling-uat.md`.
9. Docs: wiki concept page `storage-areas` (+ index/log), features.md, reconciliation-matrix
   row (movement = zero-sum), api-contracts.md (shared context), tasks/lessons.md entry
   ("moves are not consumption").

## Verification (acceptance)

- Venue stock NEVER changes from: area create/assign, movement, spot-check approval. (Tests
  assert `stock_level` byte-identical before/after each.)
- AREA-mode full count: per-area lines sum to venue counted qty; variance identical to what
  CATEGORY mode would produce for the same totals. **The test asserts
  `stock_level.current_qty` itself after `approveSession`** (5 cellar + 1.5 bar → stock 6.5),
  not just the session return value — this is what catches the per-line-overwrite bug.
- Guardrail: wine + FOH reason → intercept; napkins + FOH reason → no intercept.
- The user's original scenario end-to-end: move 4 bottles to Bar (movement, stock stays 24) →
  sell a 150 mL glass (−0.2 bottles venue) → spot-check Bar → snapshot updates; no double
  deduction anywhere; variance clean.
- 401/403/404 matrix on every new route; Administrator bypass honored.

## Decisions from review (2026-07-15, user-approved)

- **F1 — Session concurrency**: spot checks obey the existing one-active-session-per-location
  lock (`stockTakeService.openSession` ConflictError). No concurrent counts in v1.
- **F2 — Permissions**: reuse the existing inventory permission keys — area CRUD/assignment
  under the key already gating catalog admin; counting/movements under the stock-take keys.
  No new permission key, no seed change, no prod backfill. (Audit exact keys at
  implementation start; split into `inventory:areas` later only if a real role needs it.)
- **AREA-mode variance representation**: per-line `expected_qty`/`variance_qty` stay NULL for
  area lines; variance is computed per ingredient over `SUM(lines)` at review/approval —
  venue-level, matching today's semantics. The review screen shows one variance row per item.

## NOT in scope (named)
Live per-area ledgers (industry-refuted at this tier); area-level `stock_level` keying;
"counted + moved since" arithmetic on snapshots (display stays honest-simple; revisit if
operators ask); per-area variance analytics; receiving directly into an area; bottle-for-bottle
empty-swap tracking; per-order supply allowance (already deferred).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAN | 4 proposals, 4 accepted, 0 deferred; F1–F3 decided; 0 critical gaps open |
| Outside Voice | adversarial spec loop (Claude subagent; codex not installed) | Independent 2nd opinion | 3 iterations | CLEAN | 11 issues found → 11 fixed (1 critical: per-line stock overwrite in AREA-mode approval); final quality 9/10 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | not yet run |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | optional (Areas tab UI) |

- **CROSS-MODEL:** codex unavailable; outside voice ran as a fresh-context Claude subagent
  with code access. It independently verified the kitchen-unit consistency claim
  (schema.ts:1324) and caught the critical `updateStockLevelsFromSession` per-line overwrite.
  No unresolved tension.
- **VERDICT:** CEO CLEARED (scope + strategy settled, spec loop clean 9/10) — eng review
  recommended before build.

NO UNRESOLVED DECISIONS
