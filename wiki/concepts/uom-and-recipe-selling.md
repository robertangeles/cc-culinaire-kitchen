---
title: Kitchen-Unit Model + Recipe-Based Selling
category: concept
created: 2026-07-14
updated: 2026-07-15
related: [[reconciliation-matrix]], [[formula-catalog]], [[technical-architecture]]
---

Every catalog item has ONE kitchen unit it is counted/stocked in (wine: bottle, flour: g); packaging exists only at the buy/receive boundary; a sale explodes the menu-item recipe and depletes kitchen units.

## The model (physical reality, not database fields)

A gram is not the same kind of thing as an "each" — you cannot add grams to cans. The
principles (set by the operator, validated against Toast/R365/Apicbase research):

1. **Kitchen unit** (`ingredient.base_unit`) — the ONE fixed answer to "what unit do I count
   this in when it's sitting in the kitchen": flour g, oil ml, eggs each, napkins each,
   **wine bottle**. `stock_level.current_qty`, pars, per-unit costs, and every display live in
   this unit. Partials are decimals (an open bottle counts as 0.7).
2. **Content equivalence** (`content_qty`/`content_unit`) — "1 bottle contains 750 ml". The
   ONLY reason ml appears anywhere: recipe lines may pour in ml against a counted item, and
   depletion divides at runtime (150 ml → 0.2 bottle — fractional-bottle depletion).
3. **Purchase packaging** (`purchase_unit` + `pack_qty`) — "a case of 12 bottles", "a 25 kg
   bag". Exists ONLY at ordering + receiving; converts to kitchen units at the moment of
   receiving (qty AND per-unit cost) and never touches the stock count.
4. **Quantity means unit + stage**: ordered (cases) → received (→ kitchen units) → stocked →
   recipe usage → sold/wasted — every stage resolves to the kitchen unit so numbers subtract.
5. **FOH consumables & op supplies skip recipes.** A can sells directly (an invisible
   auto-created 1:1 link — `menu_item.linked_ingredient_id`, hidden from menu engineering);
   napkins are logged manually as used.

## The resolver (one conversion path for every flow)

`unitConversionService.resolveToBase(ingredientId, qty, unit)` — used by receiving (both
paths), transfers, consumption, stock take, recipe costing, and selling:

1. unit == kitchen unit → qty
2. unit == purchase packaging label → × pack_qty
3. explicit `unit_conversion` row → × factor (operator intent beats derived — D9)
4. content equivalence → convert to content_unit, ÷ content_qty (runtime division, no stored
   repeating decimal)
5. same-family standard conversion (kg → g)
6. throw `IncompatibleUnitsError` — a setup error, never a guess

`consumption_log.base_qty` stores the resolved kitchen-unit qty at insert; ALL aggregations
(consumption summary, forecasts, yield-variance actual cost) sum `base_qty` — summing
as-entered quantities across mixed units is garbage (pre-existing bug, fixed). The second
pre-existing bug fixed: `purchaseOrderService.receiveLine` added received quantities raw with
no conversion — "2 cases" would have added 2 bottles, not 24.

## Selling

Selling a menu item explodes `menu_item_ingredient` (qty ÷ yield ÷ servings × qtySold,
resolver-converted) and deducts kitchen units, writing a `consumption_log` row per ingredient
tagged `menu_item_id` + `sale_id` — which feeds `yieldVarianceService` automatically.
Preflight-then-commit (a bad line aborts the whole sale), `voidSale` (double-void-guarded),
idempotency keys (manual + per-row-content CSV keys), oversell allowed + flagged.

## Changing a kitchen unit

`ingredientService.changeKitchenUnit(id, orgId, newUnit, factor)` converts stock, pars, FIFO
batches, and per-unit costs atomically (÷factor for quantities, ×factor for costs).
`scripts/backfillKitchenUnits.ts` used it to flip 17 wine-class items (ml → bottle, including
a 375 ml half-bottle) — the migration that turned "6000 mL" into "8 bottles".

## Where it lives

- Resolver: `services/unitConversionService.ts`. Selling: `services/saleService.ts` (+ routes
  under `/api/menu-intelligence`: items/:id/sales, sales/:saleId/void, consumables,
  consumables/:id/sales, sales/import/{preview,commit}, locations/:locId/sales).
- Item setup: Catalog edit modal — **Counted in / Contains / Purchased as** block.
- Purchasing: PO form orders in packaging units; auto-PO suggests whole packages (⌈shortfall ÷
  pack_qty⌉); receiving converts at the boundary.
- Tests: `services/uomAndSelling.integration.test.ts` (gated `UOM_IT=1`, 31 cases). Manual
  UAT: `docs/qa/uom-recipe-selling-uat.md`.

## Deferred (named)

Per-order supply allowance; multiple simultaneous pack sizes (beyond `unit_conversion` rows);
FIFO/FEFO layer depletion (whole-app, costing stays WAC); POS integration; density
(volume↔weight) conversions beyond the content fact; prep-as-stock; central-kitchen BOM.
