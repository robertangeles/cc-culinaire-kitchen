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
active_ind          boolean NOT NULL DEFAULT true
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
moved_at              timestamptz NOT NULL DEFAULT now()   -- domain event time
created_dttm / updated_dttm                                -- row lifecycle
CHECK (from_storage_area_id <> to_storage_area_id)
```
2NF. Service validates both areas belong to the same `store_location_id` + org (cross-tenant
guard) and the ingredient belongs to the org. Writes touch NO stock table.

**Timestamp convention (settled 2026-07-15, round 3 — an earlier eng-review "correction" to
`moved_dttm` was WRONG and is reverted).** The schema uses BOTH suffixes, deliberately:
`_dttm` for row lifecycle (130 columns: `created_dttm`, `updated_dttm`, `opened_dttm`,
`closed_dttm`) and `_at` for domain event times (22 columns: `sold_at`, `voided_at`,
`approved_at`, `submitted_at`, `wac_last_recomputed_at`). The decisive precedent is
`consumption_log` — the table `stock_movement` most directly parallels — which carries both at
once: `logged_at` for when the usage happened, plus `created_dttm`/`updated_dttm` for the row
(schema.ts:1856-1858). `stock_movement` follows it exactly: `moved_at` + `created_dttm`/
`updated_dttm`. Do not "fix" `moved_at` to `moved_dttm`.

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
  (`storage_area_id NULL`) so nothing is silently missed. Zero silent failures.
- **Sheet membership is computed CLIENT-SIDE** (eng review 2026-07-15, verified). There is
  no server-side item universe to anti-join against: `openSession` (stockTakeService.ts:80–142)
  inserts category rows from the `DEFAULT_CATEGORIES` constant and creates NO lines — lines
  are written on demand by `saveLineItem`. The sheet's item list is a client-side filter:
  ```typescript
  // CategoryCounter.tsx:39-43 — the ONLY item universe that exists today
  const categoryIngredients = locationIngredients.filter(
    (i) => (i.categoryOverride || i.ingredientCategory) === category.categoryName
      && i.activeInd !== false,
  );
  ```
  AREA mode mirrors it in the same component, over the same `locationIngredients` array,
  with the same `activeInd !== false` guard — parity by construction, not by test:
  ```typescript
  // CategoryCounter.tsx — AREA mode
  const areaIngredients = locationIngredients.filter((i) =>
    i.activeInd !== false && (
      area.isUnassigned
        ? !hasActiveAreaAssignment(i.ingredientId)
        : assignedAreas(i.ingredientId).includes(area.storageAreaId)
    ),
  );
  ```
  **Do NOT reuse `openOpeningCount`'s predicate** (`eq(locationIngredient.activeInd, true)`,
  stockTakeService.ts:172–183). It is STRICTER than the sheet's — it drops items whose
  `activeInd` is NULL, which CATEGORY sheets show today. Using it would break the exact
  parity property this section exists to protect.
  Server supplies the assignment map: `GET /locations/:locationId/storage-areas/assignments`
  → `{ ingredientId: storageAreaId[] }` for active areas, one call, fetched alongside the
  session.
- CATEGORY mode (or no areas defined): exactly today's behavior; new columns stay NULL.
- **E4 spot check** (`spot_storage_area_id` set): session covers ONLY that area's assigned
  items; approval **never touches `stock_level`** — it refreshes the area snapshot and shows
  drift vs that area's previous count. UI labels it "Spot check — does not adjust site stock"
  everywhere (list, review, history). Full sessions may be CATEGORY or AREA mode; only
  AREA-mode full sessions update area snapshots.
- **Spot checks are exempt from the session lock and the HQ approval gate** (eng review
  2026-07-15, supersedes F1 for spot checks only). As originally specced, a spot check
  inherited both `openSession`'s one-active-session-per-location lock
  (stockTakeService.ts:86–97) and the `inventory:hq` approval gate (inventory.ts:150) — so a
  bartender's "quick Bar check" would hold the location's only session slot until an HQ user
  approved it, blocking every real count meanwhile. That makes E4 slower than the full count
  it exists to avoid, and operators would route around it by not using it. Both gates exist
  to protect stock writes; a spot check provably has none (that invariant is this plan's
  centre, with a test asserting it). So:
  - `openSession`: skip the active-session conflict check when `spotStorageAreaId` is set,
    and a spot check does not itself block a later full session.
  - Spot checks self-approve on submit (no `PENDING_REVIEW` state, no HQ round-trip);
    they refresh the area snapshot and nothing else.
  - Route stays under `inventory:count`, not `inventory:hq`.
  Full AREA-mode and CATEGORY-mode sessions keep F1 and the HQ gate exactly as today.

### E1 area snapshot — derived, not stored
"Bar: 5 · Stock Room: 19 — as of Mon" = latest APPROVED session line (full AREA-mode or spot)
per `(ingredient, storage_area)`, query-time. No snapshot table → nothing to drift or backfill.

The concrete query (NOT `MAX(created_dttm)` — a session created earlier but approved later
must win). Two corrections from eng review 2026-07-15, both verified against schema.ts:

1. **`stock_take_line` has NO `session_id`.** It links via `category_id`
   (schema.ts:1674–1678), so the join goes through `stock_take_category`.
2. **`stock_take_session` has no approval-timestamp column.** It has `approved_by_user_id`
   but no `approved_at` (full def at schema.ts:1600-1625). `approveSession`
   (stockTakeService.ts:572–573) sets `closed_dttm` at approval, so `closed_dttm` filtered on
   `session_status = 'APPROVED'` IS the approval timestamp here.
   *(Precision, corrected round 3: an `approved_at` column DOES exist elsewhere — on
   `purchase_order`, schema.ts:1896. It is unrelated to stock takes; don't let it mislead you
   into thinking the stock-take path has one.)*

```sql
SELECT DISTINCT ON (l.storage_area_id, l.ingredient_id)
       l.storage_area_id, l.ingredient_id, l.counted_qty, s.closed_dttm AS counted_at
FROM stock_take_line l
JOIN stock_take_category c ON c.category_id = l.category_id
JOIN stock_take_session s ON s.session_id = c.session_id
WHERE s.store_location_id = $1
  AND s.session_status = 'APPROVED'
  AND l.storage_area_id IS NOT NULL
ORDER BY l.storage_area_id, l.ingredient_id, s.closed_dttm DESC;
```
(`autoApproveOpeningSession` also sets `closed_dttm`, but opening-count lines can never carry
a `storage_area_id`, so `l.storage_area_id IS NOT NULL` already excludes them.)
Composite index to serve it (stated query: the DISTINCT ON above):
`idx_stock_take_line_area ON stock_take_line (storage_area_id, ingredient_id)` partial
`WHERE storage_area_id IS NOT NULL`. One query per location (optionally filtered by
ingredient for the modal) — never N+1 per ingredient.

## Server changes

1. **`storageAreaService.ts`** (new): CRUD areas (org+location scoped), assign/unassign items,
   set `area_par_level` + `sort_order`, list areas with item counts. Deactivating an area with
   assignments: soft (`is_active_ind = false`), history intact.
2. **`stockMovementService.ts`** (new): create movement (same-location + same-org validation;
   `base_qty` via `resolveToBase` — consistent with `consumption_log.base_qty`, which is
   populated the same way at `consumptionLogService.ts:201`. Note `resolveToBase` IS
   `convertToBase` — `unitConversionService.ts:147` is `export const resolveToBase = convertToBase;`
   — so this is the same resolver the count sheets use, not a second one); list movements
   merged into the item transaction feed.
   **Feed integration (verified 2026-07-15).** `getIngredientTransactions`
   (`ingredientService.ts:1177`, route `inventory.ts:118`) is ALREADY a 4-source spread-merge
   at `:1279-1316` (`stock_take_line`, `consumption_log`, `waste_log`, `inventory_transfer_line`),
   sorted by `occurredAt` desc. Adding a 5th source is one more `...movementRows.map(...)` block.
   Two corrections to the earlier text:
   - The label "⇄ Moved 4 bottle · Stock Room → Bar" **does not match how the feed renders**.
     `TransactionDayList.tsx:22-23` drives labels from a `TYPE_CONFIG` map + lucide icons; the
     `reason` field carries the detail line. Add `movement` to the `TransactionEvent["type"]`
     union (`TransactionDayList.tsx:10-18`) and a `TYPE_CONFIG.movement` entry
     (label "Area Move", icon `ArrowRightLeft`), with `reason = "${fromArea} → ${toArea}"` —
     mirroring how `transfer_loc` already formats `"${r.fromLocation} → ${r.toLocation}"`
     (`ingredientService.ts:1312`).
   - **Trap:** the existing type discriminant is misleading. Bare `"transfer"` means
     *consumption_log*; inter-location transfers are `"transfer_loc"`. Do not reuse either
     name for area movements — hence `"movement"`.
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
   - **CRITICAL — the uncounted-area guard (eng review 2026-07-15).** The claim that
     "existing category-status machinery enforces every group submitted" was FALSE. Verified:
     ```typescript
     // checkAndAdvanceSession, stockTakeService.ts:518-521 — auto-advance path
     const claimed = categories.filter((c) => c.categoryStatus !== "NOT_STARTED");
     const allClaimedDone = claimed.length > 0 && claimed.every(
       (c) => c.categoryStatus === "SUBMITTED" || c.categoryStatus === "APPROVED",
     );
     // submitSessionForReview, stockTakeService.ts:389 — manual path, comment reads:
     //   "Unclaimed (NOT_STARTED) categories are left as-is."
     // gate at :410-413 only requires >=1 SUBMITTED and 0 IN_PROGRESS.
     ```
     Unclaimed groups are excluded from both gates BY DESIGN — that is what makes CATEGORY
     cycle counts work, and skipping a category there is safe because those items get no
     line and their stock is never written. In AREA mode the same behaviour CORRUPTS stock:
     Shiraz sits on the Stock Room sheet and the Bar sheet, nobody claims Bar, the session
     advances, and the summing fix writes `SUM(lines) = 5` — silently deleting the 1.5
     bottles at the bar. No error, no flag. Same bug class as the per-line overwrite.
     **Both paths need the guard** (`submitSessionForReview` AND `checkAndAdvanceSession` —
     the auto-advance path fires on every category submit and would otherwise walk straight
     past a guard that only lives on the manual path). AREA mode only:
     ```
     uncounted = active areas WITH assignments whose categoryStatus = 'NOT_STARTED'
     if (uncounted.length) throw new ValidationError(
       "Bar hasn't been counted — Shiraz and 3 other items live there too. " +
       "Count it, or remove those items from Bar.")
     ```
     CATEGORY mode keeps today's cycle-count behaviour untouched.
     **Refinement (outside voice #1):** the precise invariant is narrower — corruption needs
     an item with lines in ≥1 area AND an assigned area still NOT_STARTED. The guard above is
     a deliberate superset: it also blocks a fully-uncounted area whose items nobody touched
     (harmless). Chosen for a legible error message over a precise one; revisit only if
     operators hit the false block in practice. The **Unassigned** group is exempt from the
     guard — an unassigned item that is never counted gets no line, so its stock is never
     written (identical to CATEGORY-mode cycle-count semantics).
   - **`saveLineItem` must resolve session mode (eng review 2026-07-15).** It currently calls
     `getPreviousCount` unconditionally and stores `expectedQty`/`varianceQty`
     (stockTakeService.ts:670–738), and receives only `categoryId` — no session-mode context.
     In AREA mode `getPreviousCount` (:800–813) returns the first matching line for the
     ingredient across ALL categories of the previous session, i.e. an arbitrary area's count.
     The "area lines keep NULL variance" guarantee is prose with no code behind it. Fix: join
     `categoryId` → session, and in AREA mode leave `expectedQty`/`varianceQty`/`variancePct`
     NULL; CATEGORY mode unchanged. Venue-level variance is still computed per ingredient over
     `SUM(lines)` at review/approval.
   - `upsertStockLevel` (module-private, defined stockTakeService.ts:903, signature
     `(storeLocationId, ingredientId, qty, userId, retryCount = 0)`, called at :889-894) takes
     a `userId` it writes to `lastCountedByUserId`. A summed multi-area quantity has no single
     counter — pass the session's `approvedByUserId`. It already does optimistic-locking retry
     on version conflict, so the summing variant inherits that for free.
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

- **Prerequisite (re-verified 2026-07-15, narrower than first written)**: the server ALREADY
  selects `itemType` — `ingredientService.ts:435-473` includes `itemType: ingredient.itemType`
  in `listLocationIngredients`. The gap is client-side ONLY: the `LocationIngredient` interface
  (`useInventory.ts:46-81`) omits it, so the value arrives over the wire but is untyped. The
  fix is one line in that interface — **no server change** (the earlier "add it to the
  location-items select" instruction was wrong; the select already has it).
  `ConsumptionLogger.tsx:73` types the selected item as `typeof locationItems[number]`, so it
  inherits the fix automatically.
- **Client** (`ConsumptionLogger.tsx`): reason = FOH + item type ∈ {FOH_CONSUMABLE,
  KITCHEN_INGREDIENT} → intercept before submit: *"Taking stock to the bar or front of house?
  That's a move, not usage — stock stays at this site until it's sold or wasted."*
  Buttons: **[Record as movement]** (opens the E2 movement form prefilled) / [Log as usage
  anyway] (escape hatch — staff spritz comps etc. exist). OPERATIONAL_SUPPLY unaffected
  (napkins to the floor ARE consumed). Exact strings verified against `ITEM_TYPES`
  (`packages/shared/src/constants/inventory.ts:8-36`) — three values, no fourth.
  Insertion point: `handleSubmit` (`ConsumptionLogger.tsx:126-157`), immediately before
  `await logConsumption({...})`.
- **Server**: stays permissive (this is data hygiene, not access control), but the movement
  route is the sanctioned path. This matches what's already there rather than relaxing
  anything: `consumption_log.reason` is a bare `varchar(30) NOT NULL` (schema.ts:1853) with
  no CHECK, no pg enum, and no shared constant — the reason vocabulary exists ONLY in
  `ConsumptionLogger.tsx:17-26`, and `consumptionLogController.ts:49-50` checks `if (!reason)`
  and nothing more. Client-side is where reason semantics already live.
- **Data repair (step 0)**: delete the 4-bottle `foh_operations` row via the existing
  consumption-log delete path (it already restores stock via `resolveToBase`) → Patisserie
  back to 24 bottles; verify with the same SQL used to find it.

## Client changes

1. **Areas admin** — ~~new "Areas" sub-tab in Stock Room~~. **Corrected 2026-07-15: there are
   no sub-tabs in Stock Room.** `InventoryPage.tsx:47-56` is a flat top-level tab bar —
   `dashboard` ("Dashboard"), `setup` ("Setup"), `stock-take` ("Stock Take"), `log`
   ("Transfers"), plus org-admin-only `review` ("Review"), `requests` ("Requests"),
   `ingredients` ("Catalog"). Areas becomes a **new top-level `areas` tab in that bar**,
   org-admin-gated alongside `review`/`requests`/`ingredients`. Contents unchanged:
   per-location area list (create/rename/reorder/deactivate), per-area item assignment picker,
   per-item area par + drag ordering (E3, `sort_order`). Empty state invites: "Create your
   first area — Stock Room, Bar, FOH counter…".
2. **Ingredient modal** (`IngredientCatalog.tsx`): "Storage areas" chips per current location
   + E1 snapshot rows inside Stock Across Locations: `Bar 5 bottle · counted Mon` with the
   venue number unchanged as the headline. Read-only here; edit lives in the Areas tab.
3. **Stock take flow**: when the location has active areas, new sessions default to AREA mode
   (toggle back to category available at creation). Group cards = areas; keypad unchanged
   (counts in kitchen units — bottles, kg, each).
4. **Movement quick action**: "Move between areas" on the Transfers surface + the guardrail
   redirect. Form: item → qty (kitchen unit) → from-area → to-area → note. Precise location
   (verified): the `log` tab of `InventoryPage.tsx` (labelled "Transfers") already renders a
   two-pill toggle at `:152-175` — `TransferSubView = "usage" | "transfers"` → `ConsumptionLogger`
   or `TransferList`. Add a third pill, `"movement"`. There is no separate Transfers route or
   page; it all lives inside `InventoryPage.tsx`.
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
- Spot-check approvals log `session_mode=AREA, spot=true, stock_effect=none`. (Corrected in
  eng review 2026-07-15 — the earlier `session_type=AREA_SPOT` contradicted this plan's own
  schema. `session_type` is the pre-existing REGULAR/OPENING column, schema.ts:1606; this
  plan adds `session_mode` and `spot_storage_area_id`. The two stay orthogonal: `session_type`
  answers "what is this count for?", `session_mode` answers "how is it walked?" — an OPENING
  count walked by area composes cleanly, and no existing `session_type === "OPENING"` branch
  has to be rewritten.)
- No new dashboards required; the restock list IS the operator-facing signal.

## Build order (each step verifiable)

**Ships as THREE branches, in order** (eng review 2026-07-15). Same total scope — CEO-locked,
not reduced — split so the 5% that writes stock gets its own review instead of competing for
attention with the 95% that doesn't. Each fits CLAUDE.md's 2-day branch cap; B1 delivers the
reported bug fix on day one rather than day five.

| Branch | Steps | Scope | Risk |
|---|---|---|---|
| **B1** `feature/ck-web/storage-areas-and-movements` | 0, 1a, 2, 3 | `storage_area` + `ingredient_storage_area` + `stock_movement` + areas CRUD/assignment + guardrail intercept | Low — zero stock writes |
| **B2** `feature/ck-web/storage-areas-count-sheets` | 1b, 4 | stock-take columns + AREA-mode counting + summing fix + uncounted-area guard + `saveLineItem` mode | **HIGH — the only branch that changes stock writes** |
| **B3** `feature/ck-web/storage-areas-snapshot-ui` | 5, 6, 7 | snapshot, restock list, spot check, Areas admin polish | Low — read-mostly |

**Dependency note (eng review):** `stock_movement.from_storage_area_id` is
`NOT NULL FK → storage_area`, so movements cannot ship before areas exist — B1 must carry
`storage_area` + `ingredient_storage_area` + enough Areas admin UI to create an area and
assign items to it, or the movement form has no from/to to offer. B1 is therefore
"areas exist and you can record a move"; B2 is "count by area"; B3 is "see it and act on it".
Schema step 1 splits: **1a** (B1) = `storage_area`, `ingredient_storage_area`,
`stock_movement`, their FK indexes, and 3 of the 4 CHECKs (reserved name, quantity > 0,
from ≠ to). **1b** (B2) = the 5 nullable stock-take columns, the partial index, and the
`session_mode` CHECK. One idempotent script per branch.

Sequential — B2 needs B1's tables, B3 needs B2's area lines to have anything to snapshot.
No parallel worktree lanes; all three touch `services/` and `routes/inventory.ts`.

Step 8 (regression) and step 9 (docs) run per branch, not once at the end.

0. Data repair: delete the 4-bottle foh_operations row (stock restores to 24) → verify SQL.
   **DONE 2026-07-15** — Patisserie back to 24 bottles, verified.
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
9. Docs (exact paths verified 2026-07-15 — features.md and reconciliation-matrix live in
   `wiki/`, NOT `docs/`): new wiki concept page `wiki/concepts/storage-areas.md`, plus
   `wiki/index.md` + `wiki/log.md`; `wiki/synthesis/features.md`;
   `wiki/concepts/reconciliation-matrix.md` (add the movement = zero-sum row);
   `../cc-culinaire-shared-context/api-contracts.md`; `tasks/lessons.md` entry
   ("moves are not consumption"). Then `pnpm wiki:graph build` + `pnpm wiki:lint`.

## Test coverage (eng review 2026-07-15 — audit found 24 gaps across 27 paths, 3 critical)

Every path below is written alongside its feature code, not deferred. Grouped by branch.

**B1 — `stockMovementService` + guardrail**
- `stockMovementService.test.ts` (unit): movement create writes zero stock delta — assert
  `stock_level` row byte-identical before/after. Cross-location areas → 400. `from === to`
  → 400. Cross-org ingredient → 404. `base_qty` resolved via `resolveToBase`.
- `ConsumptionLogger.test.tsx` (unit): reason=FOH + itemType `KITCHEN_INGREDIENT` → intercept
  fires. Reason=FOH + `OPERATIONAL_SUPPLY` (napkins) → NO intercept. "Log as usage anyway"
  submits the original consumption log unchanged (escape hatch must survive).
- Integration per route: 200 / 401 no token / 403 no permission / 400 invalid / 404 cross-org.

**B2 — AREA mode. The critical three.**
- **CRITICAL** `approveSession` AREA mode, item counted in two areas → assert
  `stock_level.current_qty` **itself** equals the SUM (5 cellar + 1.5 bar → 6.5), not the
  session return value. This is the test that catches the per-line-overwrite bug.
- **CRITICAL** `approveSession` AREA mode, one assigned area left NOT_STARTED → throws
  `ValidationError`, and `stock_level` is unchanged. Assert on BOTH paths:
  `submitSessionForReview` (manual) and `checkAndAdvanceSession` (auto-advance on category
  submit). A guard on only one path is the bug, not the fix.
- **CRITICAL — REGRESSION** CATEGORY-mode approval is byte-identical before/after this change.
  B2 modifies `updateStockLevelsFromSession`, `checkAndAdvanceSession`, and `saveLineItem` —
  all three are on the existing CATEGORY path. Cycle counts (some categories deliberately
  NOT_STARTED) must still approve. Non-negotiable.
- `saveLineItem` AREA mode → `expectedQty`/`varianceQty`/`variancePct` are NULL; CATEGORY
  mode → unchanged `getPreviousCount` values.
- Unassigned bucket: item in zero areas appears on the Unassigned sheet, counts, and sums in.
  Unassigned left uncounted does NOT block approval (exempt from the guard) and writes no
  stock for those items.
- Fractional precision: 5 + 1.5 = 6.5 survives `numeric(10,3)` round-trip.
- Sheet membership (client unit): AREA filter and CATEGORY filter both admit an item whose
  `activeInd` is NULL — the parity property, asserted directly.
- Reserved name: `POST storage-areas` with `area_name = 'Unassigned'` → 400 with the plain
  message, never a raw constraint error.
- Deactivating an area with assignments → soft (`active_ind = false`), history intact,
  in-flight sessions unaffected.

**B3 — snapshot, restock, spot check**
- Snapshot `DISTINCT ON`: a session created EARLIER but approved LATER wins (the ordering
  the query exists to get right). Opening-count lines excluded.
- Spot check: approval leaves `stock_level` byte-identical. Runs while a full count is open
  (lock exemption). Self-approves without `PENDING_REVIEW`. Reachable with `inventory:count`
  alone, no `inventory:hq`.
- Restock list: par 6, counted 2 → "bring up 4"; units asserted consistent with no resolver
  call. Par set but area never counted → "not counted yet", NOT "bring up 6".
- E2E: the user's original scenario end-to-end (move 4 to Bar → stock stays 24 → sell a
  150 mL glass → −0.2 bottles venue → spot-check Bar → snapshot updates, stock untouched).

**Failure modes — all three former critical gaps now closed**
| Failure | Test? | Error handling? | User sees |
|---|---|---|---|
| Uncounted area → partial SUM deletes stock | yes (CRITICAL above) | `ValidationError` naming the area | Clear message, was **silent** |
| Per-line overwrite → last-area-wins | yes (CRITICAL above) | summing variant | Correct stock, was **silent** |
| AREA line carries arbitrary area's `expected_qty` | yes | NULL by construction | Nothing misleading, was **silent** |
| Movement double-submit | yes | idempotent-enough, no stock effect | Button disabled on submit |
| Spot check misread as full count | yes | labels at entry/review/history | "Snapshot only" banner |

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

- **F1 — Session concurrency**: ~~spot checks obey the existing one-active-session-per-location
  lock (`stockTakeService.openSession` ConflictError)~~. **SUPERSEDED for spot checks only,
  eng review 2026-07-15** — F1 + the `inventory:hq` approval gate together made a spot check
  slower than the full count it exists to avoid. Spot checks are now exempt from both (see
  "Spot checks are exempt from the session lock and the HQ approval gate" above); they write
  no stock, which is what both gates protect. F1 stands unchanged for full sessions: one
  active full count per location, no concurrent full counts in v1.
- **F2 — Permissions**: reuse the existing inventory permission keys. No new permission key,
  no seed change, no prod backfill. **Audit complete (eng review 2026-07-15)** — the repo has
  exactly three inventory keys and every new route maps onto one:
  | Route | Key | Precedent |
  |---|---|---|
  | `GET` storage-areas / assignments / snapshot / restock-list | `inventory:count` | `GET /locations/:locId/ingredients` (inventory.ts:137) |
  | `POST/PATCH/DELETE` storage-areas, `PUT` areas/:id/items | `inventory:manage` | `PATCH /locations/:locId/ingredients/:id` (:138) |
  | `POST/GET` stock-movements | `inventory:count` | `POST /consumption-logs` (:187) |
  | stock-take create w/ `sessionMode` | `inventory:manage` | `POST /stock-takes` (:143) |
  | spot-check create + self-approve | `inventory:count` | see spot-check exemption above |
  Full-session approve stays `inventory:hq` (:150), unchanged. Split into `inventory:areas`
  later only if a real role needs it.
- **AREA-mode variance representation**: per-line `expected_qty`/`variance_qty` stay NULL for
  area lines; variance is computed per ingredient over `SUM(lines)` at review/approval —
  venue-level, matching today's semantics. The review screen shows one variance row per item.

## NOT in scope (named)
Live per-area ledgers (industry-refuted at this tier); area-level `stock_level` keying;
"counted + moved since" arithmetic on snapshots (display stays honest-simple; revisit if
operators ask); per-area variance analytics; receiving directly into an area; bottle-for-bottle
empty-swap tracking; per-order supply allowance (already deferred).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T1 (P1, human: ~3h / CC: ~25min)** — stockTakeService — Guard AREA-mode approval against uncounted areas
  - Surfaced by: Architecture — spec claimed "existing category-status machinery already enforces this"; verified FALSE at stockTakeService.ts:518-521 and :389
  - Files: `packages/server/src/services/stockTakeService.ts`
  - Verify: integration test — one area NOT_STARTED → ValidationError on BOTH `submitSessionForReview` and `checkAndAdvanceSession`; `stock_level` unchanged
- [ ] **T2 (P1, human: ~2h / CC: ~15min)** — stockTakeService — Replace per-line upsert with GROUP BY SUM for AREA mode
  - Surfaced by: spec's own critical finding, re-verified at stockTakeService.ts:872-897
  - Files: `packages/server/src/services/stockTakeService.ts`
  - Verify: 5 cellar + 1.5 bar → assert `stock_level.current_qty` = 6.5 (not the return value)
- [ ] **T3 (P1, human: ~1h / CC: ~10min)** — stockTakeService — CATEGORY-mode regression suite
  - Surfaced by: Test review REGRESSION RULE — B2 modifies 3 functions on the existing CATEGORY path
  - Files: `packages/server/src/services/stockTakeService.test.ts`
  - Verify: cycle count with NOT_STARTED categories still approves; CATEGORY approval byte-identical
- [ ] **T4 (P1, human: ~1h / CC: ~10min)** — stockTakeService — Resolve session mode in `saveLineItem`, NULL variance for area lines
  - Surfaced by: Outside voice #3 — the NULL guarantee had no code behind it; `getPreviousCount` (:800-813) returns an arbitrary area's count
  - Files: `packages/server/src/services/stockTakeService.ts`
  - Verify: unit — AREA line → expected/variance/variancePct NULL; CATEGORY line unchanged
- [ ] **T5 (P2, human: ~2h / CC: ~15min)** — stockTakeService — Exempt spot checks from session lock + HQ gate
  - Surfaced by: Outside voice #4 — F1 + `inventory:hq` (inventory.ts:150) made spot checks slower than full counts
  - Files: `packages/server/src/services/stockTakeService.ts`, `packages/server/src/routes/inventory.ts`
  - Verify: spot check opens while a full count is active; self-approves; `stock_level` unchanged; reachable with `inventory:count` only
- [ ] **T6 (P2, human: ~1h / CC: ~10min)** — storageAreaService — Snapshot query via `category_id` join + `closed_dttm`
  - Surfaced by: Architecture — spec's query joined `l.session_id`, which does not exist (schema.ts:1674-1678); no approval-timestamp column exists
  - Files: `packages/server/src/services/storageAreaService.ts`
  - Verify: unit — session created earlier but approved later wins; opening-count lines excluded
- [ ] **T7 (P2, human: ~2h / CC: ~15min)** — CategoryCounter — AREA sheet membership client-side, parity with category filter
  - Surfaced by: Architecture — no server-side item universe exists (`openSession` creates no lines); `openOpeningCount`'s predicate is stricter than the sheet's
  - Files: `packages/client/src/components/inventory/CategoryCounter.tsx`, `packages/server/src/routes/inventory.ts`
  - Verify: unit — item with `activeInd: null` appears on BOTH an AREA sheet and a CATEGORY sheet
- [ ] **T8 (P2, human: ~30min / CC: ~5min)** — useInventory — Add `itemType` to `LocationIngredient`
  - Surfaced by: Guardrail prerequisite — server already selects it (ingredientService.ts:435-473); only the client interface omits it (useInventory.ts:46-81)
  - Files: `packages/client/src/hooks/useInventory.ts`
  - Verify: guardrail intercept fires for wine, not for napkins

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAN | 4 proposals, 4 accepted, 0 deferred; F1–F3 decided; 0 critical gaps open |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAN | 10 issues (4 arch, 2 code quality, 4 outside voice), all folded; 3 critical gaps found → all closed; 24 test gaps → all added to plan |
| Outside Voice | adversarial spec loop + eng-review pass (Claude subagent; codex not installed) | Independent 2nd opinion | 4 | CLEAN | Spec loop: 11 found → 11 fixed. Eng-review pass: 6 found → 4 actioned, 1 suppressed (conf 4/10), 1 stale |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | optional (Areas admin tab, B3) |

- **CROSS-MODEL:** codex unavailable (`npm install -g @openai/codex` for real cross-model
  coverage); both outside voices ran as fresh-context Claude subagents with code access.
  No cross-model tension — the eng-review outside voice found issues *beyond* the review
  rather than contradicting it. Its best catch (`submitSessionForReview` carries the same
  NOT_STARTED gap as `checkAndAdvanceSession`, so the guard must land on both paths)
  materially strengthened T1. Suppressed: shared-`closed_dttm` ambiguity (conf 4/10 — the
  `storage_area_id IS NOT NULL` filter already excludes opening counts). Dismissed as stale:
  "do the data repair first" — step 0 completed 2026-07-15.
- **HALLUCINATION SWEEP (2026-07-15, round 2 — every code claim in this doc re-checked):**
  25 claims verified against source. **19 TRUE** (kitchen-unit `base_unit` at schema.ts:1324;
  the three `ITEM_TYPES` strings; `location_ingredient.par_level`; `consumption_log.base_qty`;
  `pack_qty` + auto-PO `suggestedPackages` at autoPoSuggestService.ts:150-151;
  `counted_qty` base-normalized; `IngredientCatalog.tsx` "Stock Across Locations" at :773;
  `docs/qa/uom-recipe-selling-uat.md`; `uomAndSelling.integration.test.ts`;
  `navPermissions.test.ts`; `backfillNavPermissions.ts`; `migrateUomRecipeSelling.sql`;
  the `bench_channel` drizzle-push block, documented at `wiki/synthesis/schema-drift-may-2026.md`;
  `storage_area`/`stock_movement` confirmed absent). **6 CORRECTED** — all client-side, all
  now fixed inline above: (1) "Areas sub-tab in Stock Room" — no sub-tabs exist, it's a flat
  tab bar; (2) the guardrail prerequisite told us to change a server select that already has
  the field — client-only, one line; (3) the "⇄ Moved" feed label doesn't match how
  `TransactionDayList` renders; (4) `features.md`/`reconciliation-matrix` are in `wiki/`, not
  `docs/`; (5) `upsertStockLevel` line ref + full signature; (6) the movement quick action's
  host is a pill toggle inside `InventoryPage.tsx`, not a Transfers page.
  Two subagent claims were themselves wrong and were rejected on re-check: `resolveToBase` and
  `convertToBase` are NOT different functions (`unitConversionService.ts:147`:
  `export const resolveToBase = convertToBase;`), and `area_par_level` being "fictitious" is
  expected — this plan introduces it.
- **ROUND 3 — the eng review's own error, caught at implementation (2026-07-15).** The round-1
  "naming correction" of `moved_at` → `moved_dttm` was WRONG, and its justification ("no `_at`
  column exists anywhere in the schema") was fabricated — the schema has 22 `_at` columns. The
  spec's original `moved_at` was correct: `_at` is this schema's convention for *domain event*
  times and `_dttm` for *row lifecycle*, and `consumption_log` (the nearest sibling table)
  carries both at once — `logged_at` + `created_dttm`/`updated_dttm` (schema.ts:1856-1858).
  Reverted. Also corrected: "no `approved_at` exists" overstated a true finding — `stock_take_session`
  has none, but `purchase_order` does (schema.ts:1896). The `is_active_ind` → `active_ind`
  correction stands (verified: `locationIngredient.activeInd`, schema.ts:1531).
  Lesson recorded in `tasks/lessons.md`: a reviewer's confident claim is not evidence either.
- **ENG REVIEW — what changed:** the spec asserted three things about the code that are not
  true, each of which would have shipped a silent stock bug: (1) the approval gate does not
  block uncounted groups, on either path; (2) `stock_take_line` has no `session_id` and there
  is no approval-timestamp column, so the snapshot query does not run; (3) there is no
  server-side item universe to anti-join the Unassigned bucket against — the sheet is a
  client-side filter whose predicate is looser than the one the spec borrowed. Scope is
  unchanged from CEO review; delivery is now three sequential branches so the one branch that
  writes stock (B2) gets its own review.
- **VERDICT:** CEO + ENG CLEARED — ready to implement. Start with B1
  (`feature/ck-web/storage-areas-and-movements`).

NO UNRESOLVED DECISIONS
