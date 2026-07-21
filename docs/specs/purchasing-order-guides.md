# Purchasing P1: order guides + order-to-par

> **Shipped 2026-07-20** on `feature/ck-web/purchasing-order-guides-p1`.
> Full plan, competitive research and the design review live in the CEO plan
> (`~/.gstack/projects/robertangeles-cc-culinaire-kitchen/ceo-plans/2026-07-20-ai-native-purchasing.md`).
> Phases 2–3 (usage-forecast pars, order-from-stocktake, NL ordering, OCR reconciliation)
> are deferred — see `tasks/todo.md`.

## Context

**The trigger.** During UAT the PO builder was called confusing: it opened on a catalogue
search with `PAR`, `MIN ORD` and `UNIT COST` columns all rendering `—`. To order, a chef had
to hunt the catalogue and work out quantities in their head.

**What research showed.** Every incumbent (MarketMan, xtraCHEF, Craftable, MarginEdge,
Apicbase) centres ordering on two patterns we didn't surface: a reusable per-supplier
**order guide**, and **order-to-par** (the system pre-fills `par − on-hand` so the operator
reviews and sends). Operators consistently praise saved lists and complain about
catalogue-browsing. The empty columns weren't a schema gap — par/reorder/cost columns existed
and the query selected them correctly; the data was simply never populated, and the
par-vs-stock engine that already existed (`poMath`, `autoPoSuggestService`) was siloed on a
separate Suggestions tab that the builder never called.

## What shipped

**Order guides** — `order_guide` + `order_guide_item`. A guide is a reusable per-supplier
list. Lines reference `ingredient_id` only; cost, pack size and the supplier minimum resolve
**live** at render from `ingredient_supplier`/`ingredient`, so a guide never holds stale
prices (2NF). `store_location_id` is nullable: `NULL` = an org-wide guide shared across
locations. P1 ships location-scoped behaviour; the nullable column means shareable guides
later are a flag flip, not a migration.

**Order-to-par in the PO builder.** Picking a guide sets the supplier and fills the draft with
every guide line already at `par − on-hand`, reusing `poMath.suggestedOrderQty` so the builder
and the Suggestions tab can never disagree. Each line shows `On hand N / par M · below par`,
has a `TO PAR` chip, and there's an `Order everything to par` action. Rows already at par stay
visible at 0 but are filtered out of the submitted PO.

**Guide authoring** — Purchasing → Guides. Create a guide against a supplier, add catalogue
items, reorder rows (the operator's shelf-to-sheet walk order), remove rows, save. The server
replaces the item set wholesale.

**Bulk par editor** — Inventory → Setup → Par Levels. None of the above is visible until pars
exist, and a fresh org has none. Writes only the rows actually changed, in batches of 8.
Honest framing: it speeds up data entry for operators who know their pars; it does not invent
them (forecast suggestions are P2 and need real depletion history).

### Bugs fixed along the way
- **`MIN ORD` was lying.** It rendered `location_ingredient.reorder_qty` (an internal reorder
  trigger) under a heading that reads as a supplier constraint, while the real
  `ingredient_supplier.minimum_order_qty` was never surfaced or validated — a PO could go out
  below an actual supplier minimum with nothing flagging it. The column now shows the real
  minimum (joined for the supplier this location buys from, else the preferred one) and guide
  lines warn inline when a quantity falls under it. Warn, not block: an operator may knowingly
  under-order.
- **Two divergent par engines.** `purchaseOrderService.getSuggestions` computed par differently
  from the live `autoPoSuggestService` and was called by no component. Deleted.
- **`clonePO` N+1** — two SELECTs per source line (~1,000 queries for a 500-line PO). Batch-loaded.
- **Cost source mismatch** — Suggestions used `preferred_unit_cost` while the form used
  `unit_cost`. Unified on `preferred_unit_cost` with location/org fallback.
- **Duplicate fetch** — the PO list and PO form each fired an identical ingredients GET on
  mount. In-flight requests are now shared (not cached — the entry drops when it settles).

## Decisions worth knowing

| Decision | Why |
|---|---|
| Guide lines reference `ingredient_id`, pricing resolved live | 2NF; a guide must never hold a stale price |
| `store_location_id` nullable from day one | shareable guides later without a breaking migration |
| Suggested par is a **separate** column from `par_level` | a forecast must never clobber the operator's hand-set par; the ordering engine reads only `par_level` |
| **Reused** `purchasing:draft` / `inventory:manage` | a new permission key would 403 every existing user unless backfilled before deploy (`nav-hide-not-authz`) |
| Row cap + debounce instead of a virtualiser | the catalogue is the fallback path now; not worth a dependency |
| AI-suggest-par dropped from P1 | org 2 has zero `consumption_log` rows, and a new operator has no history either — it could not function |

## Contracts

`OrderGuideSummary` and `OrderGuideItemView` live in `@culinaire/shared`, and
`orderGuideService.getGuideItems` is annotated with the shared type — so a server field rename
fails the build rather than silently rendering blank cells (`mfa-client-server-field-mismatch`).

## Routes

| Method | Path | Permission |
|---|---|---|
| GET | `/inventory/locations/:locId/order-guides` | `purchasing:draft` |
| POST | `/inventory/locations/:locId/order-guides` | `inventory:manage` |
| PATCH / DELETE | `/inventory/order-guides/:guideId` | `inventory:manage` |
| GET | `/inventory/order-guides/:guideId/items?locationId=` | `purchasing:draft` |
| PUT | `/inventory/order-guides/:guideId/items` | `inventory:manage` |

## Tests

- `orderGuide.integration.test.ts` (real DB, `TENANT_IT=1`) — guide → items → priced payload:
  `suggestedOrderQty = par − on-hand`, supplier minimum surfaced, cost from
  `preferred_unit_cost`, soft-deleted ingredient dropped, and the catalogue list exposes the
  real supplier minimum.
- `routes/inventory.test.ts` — the six order-guide routes 403 without the right permission.
- `PurchaseOrderForm.test.tsx` — guide prefill, both to-par actions, supplier-minimum warning,
  at-par rows excluded from the PO.
- `OrderGuideManager.test.tsx` — create against a supplier, walk order preserved on save,
  removed rows dropped.
- `BulkParEditor.test.tsx` — only changed rows written.

**Known flake:** the real-DB integration tests intermittently fail on Render (Singapore)
latency. Re-run before believing a failure.

## First run

Order-to-par shows nothing until pars exist. On a fresh org:
1. Inventory → Setup → **Par Levels** — set pars for the items you reorder.
2. Purchasing → **Guides** — create a guide for a supplier and add those items.
3. Purchasing → **Orders** → New PO — pick the guide; the draft arrives filled to par.
