---
title: Formula Catalog
category: concept
created: 2026-06-01
updated: 2026-06-01
related: [[technical-architecture]], [[data-flow-architecture]], [[schema-drift-may-2026]]
---

Complete catalog of every formula in the CulinAIre Kitchen cost, stock, prep, and forecasting engine. Each formula is independently verified with forward and backward proofs. This page is the single source of truth for how numbers flow through the system.

---

## Unit Conversion

Two conversion systems exist in the codebase. They serve different purposes and must not be confused.

**System A: `shared/utils/units.ts`** -- Static, deterministic, hard-coded conversion factors for standard culinary units. Used by the menu cost engine (`menuIntelligenceService.ts`) and anywhere a formula needs mass-to-mass or volume-to-volume conversion without a DB round-trip. No custom units. Throws `IncompatibleUnitsError` on cross-family conversion (mass vs volume vs count).

**System B: `unitConversionService.ts`** -- DB-backed, per-ingredient custom conversions (e.g., "case" = 12 each). Used by the stock take flow (`stockTakeService.ts`) and anywhere the entered unit is ingredient-specific. Falls through to the ingredient's `base_unit` identity when the entered unit matches.

| ID | Name | Formula | Source | Precision | Test |
|---|---|---|---|---|---|
| F-UC-01 | Static unit conversion | `result = qty * TO_REFERENCE[from] / TO_REFERENCE[to]` | `shared/utils/units.ts:163-164` | IEEE 754 float (no rounding) | `units.test.ts` |
| F-UC-02 | DB-backed base conversion | `baseQty = enteredQty * factor` | `unitConversionService.ts:81` | IEEE 754 float (no rounding) | `unitConversionService.test.ts` |

### F-UC-01 Static Unit Conversion

**Category:** Unit Conversion
**Source:** `packages/shared/src/utils/units.ts:163-164`
**Function:** `convertUnit(quantity, fromUnit, toUnit)`

**Formula:**
```
inReference = quantity * TO_REFERENCE[fromUnit]
result      = inReference / TO_REFERENCE[toUnit]
```

**Conversion factors (TO_REFERENCE):**
- Mass (reference: g): mg=0.001, g=1, kg=1000
- Volume (reference: ml): ml=1, l=1000, tsp=4.92892, tbsp=14.7868, cup=236.588, floz=29.5735
- Count (reference: each): each=1, dozen=12, portion=1

**Inputs:**
- `quantity`: number, any finite value
- `fromUnit`: BaseUnit, must be in same family as toUnit
- `toUnit`: BaseUnit, must be in same family as fromUnit

**Output:** number (converted quantity)
**Precision:** No rounding -- raw IEEE 754 float division.
**Guard:** Throws `IncompatibleUnitsError` if families differ (mass vs volume vs count). Identity returns input unchanged.

**Forward proof:** `convertUnit(50, "g", "kg")` = 50 * 1 / 1000 = 0.05
**Backward proof:** Given 0.05 kg, `convertUnit(0.05, "kg", "g")` = 0.05 * 1000 / 1 = 50 g. Lossless within IEEE 754 precision.

**Chain:**
- Feeds: F-MC-01 (computeLineCost) via `convertToBaseUnit` wrapper
- Fed by: User input from MenuItemFormModal dropdown

**Conversion system:** Self (this IS System A)
**Test file:** `packages/shared/src/utils/units.test.ts`
**Last verified:** 2026-06-01

---

### F-UC-02 DB-Backed Base Conversion

**Category:** Unit Conversion
**Source:** `packages/server/src/services/unitConversionService.ts:81`
**Function:** `convertToBase(ingredientId, enteredQty, enteredUnit)`

**Formula:**
```
factor  = unit_conversion.to_base_factor WHERE ingredient_id AND from_unit
baseQty = enteredQty * factor
```

**Inputs:**
- `ingredientId`: UUID string
- `enteredQty`: number >= 0
- `enteredUnit`: string (e.g., "case", "bag", "box")

**Output:** `{ baseQty: number, baseUnit: string }`
**Precision:** No rounding -- raw float multiplication.
**Guard:** Throws if unit is unrecognised (no matching `unit_conversion` row AND enteredUnit does not match ingredient's baseUnit). Identity (entered = base) returns qty unchanged.

**Forward proof:** Ingredient base_unit="each", unit_conversion row: case->12. `convertToBase(id, 5, "case")` = 5 * 12 = 60 each.
**Backward proof:** Given 60 each, divide by factor: 60 / 12 = 5 cases. Lossless for integer factors.

**Chain:**
- Feeds: F-ST-01/02 (stock take variance) via `stockTakeService.saveLineItem`
- Fed by: Staff unit entry in stock take UI

**Conversion system:** Self (this IS System B)
**Test file:** `packages/server/src/services/unitConversionService.test.ts`
**Last verified:** 2026-06-01

---

## Stock

| ID | Name | Formula | Source | Precision | Test |
|---|---|---|---|---|---|
| F-SK-01 | Add stock | `newQty = currentQty + addQty` | `stockService.ts:52` | String storage (no rounding) | PENDING |
| F-SK-02 | Deduct stock | `newQty = currentQty - deductQty` | `stockService.ts:109` | String storage (no rounding) | PENDING |
| F-ST-01 | Stock take variance qty | `variance = counted - expected` | `stockMath.ts:19` | No rounding | `stockMath.test.ts` |
| F-ST-02 | Stock take variance pct | `variancePct = (variance / expected) * 100` | `stockMath.ts:28` | No rounding; null when expected=0 | `stockMath.test.ts` |

### F-SK-01 Add Stock

**Category:** Stock
**Source:** `packages/server/src/services/stockService.ts:52`
**Function:** `addStock(storeLocationId, ingredientId, addQty, tx)`

**Formula:**
```
newQty = Number(current.currentQty) + addQty
```

**Inputs:**
- `storeLocationId`: UUID string
- `ingredientId`: UUID string
- `addQty`: number > 0
- `tx`: DB transaction (optimistic locking with version check)

**Output:** Updated `stock_level.current_qty` stored as String.
**Precision:** Stored as `String(newQty)` -- no explicit rounding. Relies on JS float addition.
**Guard:** Optimistic locking via `version` column. Retries up to 2 times on conflict. Throws after max retries. Creates new row if none exists (with `currentQty = String(addQty)`).

**Forward proof:** currentQty="100", addQty=25 => newQty = 100+25 = 125, stored as "125".
**Backward proof:** Given newQty=125 and addQty=25, currentQty = 125-25 = 100. Lossless.

**Chain:**
- Fed by: `receivingService.confirmReceipt` (delivery receiving), `transferService` (transfer receive)
- Feeds: `stock_level.current_qty` which feeds F-FC-02, F-PO-02, stock take expected qty

**Conversion system:** Neither -- operates in base units already.
**Test file:** PENDING
**Last verified:** 2026-06-01

---

### F-SK-02 Deduct Stock

**Category:** Stock
**Source:** `packages/server/src/services/stockService.ts:109`
**Function:** `deductStock(storeLocationId, ingredientId, deductQty, tx)`

**Formula:**
```
newQty = Number(current.currentQty) - deductQty
```

**Inputs:**
- `storeLocationId`: UUID string
- `ingredientId`: UUID string
- `deductQty`: number > 0

**Output:** Updated `stock_level.current_qty` stored as String. Can go negative (no floor).
**Precision:** Stored as `String(newQty)` -- no explicit rounding.
**Guard:** Optimistic locking with version check. Retries up to 2 times. Throws if no stock_level row exists.

**Forward proof:** currentQty="100", deductQty=25 => newQty = 100-25 = 75, stored as "75".
**Backward proof:** Given newQty=75 and deductQty=25, currentQty = 75+25 = 100. Lossless.

**Chain:**
- Fed by: `transferService` (transfer send), `consumptionLogService` (consumption deduction)
- Feeds: `stock_level.current_qty`

**Conversion system:** Neither -- operates in base units already.
**Test file:** PENDING
**Last verified:** 2026-06-01

---

### F-ST-01 Stock Take Variance Qty

**Category:** Stock
**Source:** `packages/server/src/services/stockMath.ts:19`
**Function:** `varianceQty(countedQty, expectedQty)`

**Formula:**
```
variance = countedQty - expectedQty
```

**Inputs:**
- `countedQty`: number (physically counted)
- `expectedQty`: number (previous approved count)

**Output:** number. Positive = surplus, negative = shrinkage.
**Precision:** No rounding.

**Forward proof:** counted=95, expected=100 => variance = -5 (shrinkage of 5).
**Backward proof:** Given variance=-5 and expected=100, counted = 100 + (-5) = 95. Lossless.

**Chain:**
- Fed by: `stockTakeService.saveLineItem` which provides countedQty (via F-UC-02) and expectedQty (previous approved session)
- Feeds: F-ST-02 (variancePct), `stock_take_line.variance_qty` column

**Conversion system:** Neither -- input already in base units via F-UC-02.
**Test file:** `packages/server/src/services/stockMath.test.ts`
**Last verified:** 2026-06-01

---

### F-ST-02 Stock Take Variance Pct

**Category:** Stock
**Source:** `packages/server/src/services/stockMath.ts:28`
**Function:** `variancePct(variance, expectedQty)`

**Formula:**
```
variancePct = (variance / expectedQty) * 100
// Returns null when expectedQty = 0 (division undefined)
```

**Inputs:**
- `variance`: number (output of F-ST-01)
- `expectedQty`: number

**Output:** number | null. Percentage relative to expected.
**Precision:** No rounding. Stored as `String(variancePct)` in `stock_take_line`.

**Forward proof:** variance=-5, expected=100 => variancePct = (-5/100)*100 = -5.0%.
**Backward proof:** Lossy -- given variancePct=-5.0% and expected=100, variance = -5.0/100 * 100 = -5. Recoverable for integers but float precision can drift.

**Chain:**
- Fed by: F-ST-01 (varianceQty)
- Feeds: `stock_take_line.variance_pct` column, StockTakeReview UI variance display

**Conversion system:** Neither.
**Test file:** `packages/server/src/services/stockMath.test.ts`
**Last verified:** 2026-06-01

---

## WAC (Weighted Average Cost)

| ID | Name | Formula | Source | Precision | Test |
|---|---|---|---|---|---|
| F-WAC-01 | WAC recompute | `wac = SUM(batch.qty * batch.cost) / SUM(batch.qty)` | `wacService.ts:129-131` | SQL numeric (DB-side precision) | PENDING |

### F-WAC-01 WAC Recompute

**Category:** WAC
**Source:** `packages/server/src/services/wacService.ts:129-131`
**Function:** `recompute(inputs, tx)` -- SQL CTE

**Formula (SQL):**
```sql
wac = CASE
        WHEN COALESCE(SUM(b.original_quantity::numeric), 0) = 0 THEN NULL
        ELSE SUM(b.original_quantity::numeric * COALESCE(b.unit_cost, 0)::numeric)
             / NULLIF(SUM(b.original_quantity::numeric), 0)
      END
```

In plain math:
```
wac = SUM(original_quantity_i * unit_cost_i) / SUM(original_quantity_i)
      for all fifo_batch rows at (store_location_id, ingredient_id)
```

**Inputs:**
- `WacRecomputeInput[]`: array of `{ storeLocationId, ingredientId }` pairs
- `tx`: DB transaction (must be same tx that inserted FIFO batches)
- Reads from: `fifo_batch` table (original_quantity, unit_cost)

**Output:** Updated `location_ingredient.weighted_average_cost`. NULL when total quantity is 0.
**Precision:** PostgreSQL `numeric` type -- arbitrary precision at DB level.
**Guard:** NULL-safe via COALESCE and NULLIF. Runs inside the receiving transaction for atomicity.

**Forward proof:** Batch A: qty=100, cost=$2.00. Batch B: qty=50, cost=$3.00. WAC = (100*2 + 50*3) / (100+50) = 350/150 = $2.333...
**Backward proof:** Lossy -- WAC is a weighted mean; cannot recover individual batch costs from the aggregate.

**Chain:**
- Fed by: `receivingService.confirmReceipt` (which creates FIFO batches, then calls recompute)
- Feeds: `location_ingredient.weighted_average_cost` which feeds F-MC-02 (resolveUnitCost fallback path), cost displays in inventory UI

**Conversion system:** Neither -- all values in base unit cost.
**Test file:** PENDING
**Last verified:** 2026-06-01

---

## Menu Cost

| ID | Name | Formula | Source | Precision | Test |
|---|---|---|---|---|---|
| F-MC-01 | Line cost | `(qtyInBase * unitCost) / (yieldPct / 100)` | `menuIntelligenceService.ts:192` | `.toFixed(2)` | `menuIntelligenceService.phase3.test.ts` |
| F-MC-02 | Resolve unit cost | Priority: caller override > ingredient.preferred > ingredient.unitCost > "0" | `menuIntelligenceService.ts:120-148` | String passthrough | `menuIntelligenceService.phase3.test.ts` |
| F-MC-03 | Food cost | `foodCost = (SUM(lineCost) / servings) * (1 + qFactor/100)` | `menuIntelligenceService.ts:404-406` | `.toFixed(2)` | PENDING |
| F-MC-04 | Food cost % | `foodCostPct = (foodCost / sellingPrice) * 100` | `menuIntelligenceService.ts:408` | `.toFixed(2)` | PENDING |
| F-MC-05 | Contribution margin | `CM = sellingPrice - foodCost` | `menuIntelligenceService.ts:409` | `.toFixed(2)` | PENDING |
| F-MC-06 | Menu mix % | `mixPct = (unitsSold / totalUnitsSold) * 100` | `menuIntelligenceService.ts:442` | `.toFixed(2)` | PENDING |
| F-MC-07 | Classification | Star/Plowhorse/Puzzle/Dog matrix | `menuIntelligenceService.ts:455-470` | Categorical | PENDING |
| F-MC-08 | Total revenue | `totalRevenue = SUM(sellingPrice_i * unitsSold_i)` | `menuIntelligenceService.ts:504` | `.toFixed(2)` | PENDING |
| F-MC-09 | Total food cost | `totalFoodCost = SUM(foodCost_i * unitsSold_i)` | `menuIntelligenceService.ts:505` | `.toFixed(2)` | PENDING |
| F-MC-10 | Overall food cost % | `overallPct = (totalFoodCost / totalRevenue) * 100` | `menuIntelligenceService.ts:518` | `.toFixed(1)` | PENDING |

### F-MC-01 Line Cost

**Category:** Menu Cost
**Source:** `packages/server/src/services/menuIntelligenceService.ts:192`
**Function:** `computeLineCost(quantity, unit, unitCost, yieldPct, ingredientId)`

**Formula:**
```
qtyInBase = convertToBaseUnit(qty, fromUnit, toUnit)  // via F-UC-01; identity if no conversion
lineCost  = (qtyInBase * cost) / (yieldPct / 100)
```

**Inputs:**
- `quantity`: string (parsed to float)
- `unit`: string (e.g., "g", "kg")
- `unitCost`: string (parsed to float, per base unit)
- `yieldPct`: string (parsed to float, 1-100)
- `ingredientId`: string | null (null = free-text row, no conversion)

**Output:** string, `.toFixed(2)`
**Precision:** `.toFixed(2)` -- rounds to 2 decimal places.
**Guard:** Returns "0.00" if qty, cost, or yieldPct is NaN or yieldPct is 0. Throws IncompatibleUnitsError on cross-family unit mismatch.

**Forward proof:** qty=500g, base_unit=kg. cost=$12/kg, yield=80%. qtyInBase = convertUnit(500, g, kg) = 0.5. lineCost = (0.5 * 12) / (80/100) = 6 / 0.8 = 7.50.
**Backward proof:** Lossy -- `.toFixed(2)` truncates. Given lineCost=7.50 and cost=12, yield=80%, qtyInBase = 7.50 * 0.8 / 12 = 0.5. Recoverable for clean numbers.

**Chain:**
- Fed by: F-UC-01 (unit conversion), F-MC-02 (resolved unit cost)
- Feeds: F-MC-03 (food cost summation), `menu_item_ingredient.line_cost` column

**Conversion system:** System A (`shared/utils/units.ts`)
**Test file:** `packages/server/src/services/menuIntelligenceService.phase3.test.ts`
**Last verified:** 2026-06-01

---

### F-MC-02 Resolve Unit Cost

**Category:** Menu Cost
**Source:** `packages/server/src/services/menuIntelligenceService.ts:120-148`
**Function:** `resolveUnitCost(callerUnitCost, ingredientId)`

**Formula (priority cascade):**
```
1. If callerUnitCost is a positive finite number  => use it (manual override)
2. If ingredientId is null/undefined              => return callerUnitCost or "0"
3. Lookup ingredient row:
   a. ingredient.preferredUnitCost (from WAC flow) => use if non-null
   b. ingredient.unitCost (org default)            => use if non-null
   c. fallback                                     => "0"
```

**Inputs:**
- `callerUnitCost`: string | null | undefined
- `ingredientId`: string | null | undefined

**Output:** string (unit cost)
**Precision:** String passthrough -- no arithmetic, no rounding.

**Forward proof:** callerUnitCost="0", ingredientId=UUID, ingredient.preferredUnitCost="12.40" => returns "12.40".
**Backward proof:** N/A -- selection logic, not arithmetic.

**Chain:**
- Fed by: F-WAC-01 (WAC recompute writes `ingredient.preferredUnitCost` indirectly via `location_ingredient.weighted_average_cost`), manual user input
- Feeds: F-MC-01 (computeLineCost)

**Conversion system:** Neither.
**Test file:** `packages/server/src/services/menuIntelligenceService.phase3.test.ts`
**Last verified:** 2026-06-01

---

### F-MC-03 Food Cost

**Category:** Menu Cost
**Source:** `packages/server/src/services/menuIntelligenceService.ts:393-406`
**Function:** `recalculateItemCosts(menuItemId)`

**Formula:**
```
totalIngredientCost = SUM(parseFloat(ingredient_i.lineCost))
perServing          = servings > 1 ? totalIngredientCost / servings : totalIngredientCost
qFactor             = parseFloat(qFactorPct)
foodCost            = qFactor > 0 ? perServing * (1 + qFactor / 100) : perServing
```

**Inputs:**
- All `menu_item_ingredient` rows for the menu item (each has `line_cost` from F-MC-01)
- `menu_item.servings`: integer >= 1
- `menu_item.q_factor_pct`: string (quality factor percentage, 0-100)

**Output:** Updated `menu_item.food_cost` as `.toFixed(2)`.
**Precision:** `.toFixed(2)`.
**Guard:** servings defaults to 1 (via `?? 1`). qFactor of 0 skips the multiplier.

**Forward proof:** 3 ingredients with lineCosts $2.50, $3.00, $1.50. servings=2, qFactor=10%. totalIngredientCost = 7.00. perServing = 7.00/2 = 3.50. foodCost = 3.50 * 1.10 = 3.85.
**Backward proof:** Lossy -- `.toFixed(2)` rounds. Given foodCost=3.85, qFactor=10%, perServing = 3.85/1.10 = 3.5. totalIngredientCost = 3.5 * 2 = 7.00. Recoverable for clean numbers.

**Chain:**
- Fed by: F-MC-01 (line costs)
- Feeds: F-MC-04, F-MC-05, F-MC-09, `menu_item.food_cost` column

**Conversion system:** Neither.
**Test file:** PENDING
**Last verified:** 2026-06-01

---

### F-MC-04 Food Cost Percentage

**Category:** Menu Cost
**Source:** `packages/server/src/services/menuIntelligenceService.ts:408`
**Function:** `recalculateItemCosts(menuItemId)` (inline)

**Formula:**
```
foodCostPct = sellingPrice > 0 ? (foodCost / sellingPrice) * 100 : 0
```

**Inputs:**
- `foodCost`: number (from F-MC-03)
- `sellingPrice`: number (parsed from `menu_item.selling_price`)

**Output:** Updated `menu_item.food_cost_pct` as `.toFixed(2)`.
**Precision:** `.toFixed(2)`.
**Guard:** Returns 0 when sellingPrice is 0 or negative (avoids division by zero).

**Forward proof:** foodCost=$3.85, sellingPrice=$18.00 => (3.85/18.00)*100 = 21.39%.
**Backward proof:** Given pct=21.39%, sellingPrice=$18.00, foodCost = 21.39/100 * 18.00 = $3.85. Lossy at `.toFixed(2)` boundary.

**Chain:**
- Fed by: F-MC-03
- Feeds: F-MC-10 (avg food cost %), classification display

**Conversion system:** Neither.
**Test file:** PENDING
**Last verified:** 2026-06-01

---

### F-MC-05 Contribution Margin

**Category:** Menu Cost
**Source:** `packages/server/src/services/menuIntelligenceService.ts:409`

**Formula:**
```
contributionMargin = sellingPrice - foodCost
```

**Inputs:**
- `sellingPrice`: number
- `foodCost`: number (from F-MC-03)

**Output:** Updated `menu_item.contribution_margin` as `.toFixed(2)`.
**Precision:** `.toFixed(2)`.

**Forward proof:** sellingPrice=$18.00, foodCost=$3.85 => CM = $14.15.
**Backward proof:** Given CM=$14.15 and sellingPrice=$18.00, foodCost = 18.00-14.15 = $3.85. Lossless within precision.

**Chain:**
- Fed by: F-MC-03
- Feeds: F-MC-07 (classification), analysis dashboard

**Conversion system:** Neither.
**Test file:** PENDING
**Last verified:** 2026-06-01

---

### F-MC-06 Menu Mix Percentage

**Category:** Menu Cost
**Source:** `packages/server/src/services/menuIntelligenceService.ts:442`

**Formula:**
```
mixPct = totalUnitsSold > 0 ? (item.unitsSold / totalUnitsSold) * 100 : 0
```

**Inputs:**
- `item.unitsSold`: integer (units sold for this item)
- `totalUnitsSold`: integer (sum of unitsSold across all items in scope)

**Output:** Updated `menu_item.menu_mix_pct` as `.toFixed(2)`.
**Precision:** `.toFixed(2)`.

**Forward proof:** itemSold=30, totalSold=200 => mixPct = (30/200)*100 = 15.00%.
**Backward proof:** Given mixPct=15.00% and totalSold=200, unitsSold = 15.00/100 * 200 = 30. Lossy for non-integer results.

**Chain:**
- Fed by: CSV sales data import, manual entry
- Feeds: F-MC-07 (classification)

**Conversion system:** Neither.
**Test file:** PENDING
**Last verified:** 2026-06-01

---

### F-MC-07 Menu Engineering Classification

**Category:** Menu Cost
**Source:** `packages/server/src/services/menuIntelligenceService.ts:455-470`
**Function:** `recalculateMenu(userId, category)`

**Formula (decision matrix):**
```
avgCM  = MEAN(contributionMargin) across all items
avgMix = MEAN(menuMixPct) across all items

if unitsSold == 0          => "unclassified"
if CM >= avgCM AND mix >= avgMix => "star"       (high profit, high popularity)
if CM <  avgCM AND mix >= avgMix => "plowhorse"  (low profit, high popularity)
if CM >= avgCM AND mix <  avgMix => "puzzle"     (high profit, low popularity)
if CM <  avgCM AND mix <  avgMix => "dog"        (low profit, low popularity)
```

**Inputs:**
- All menu items' `contributionMargin` (from F-MC-05)
- All menu items' `menuMixPct` (from F-MC-06)

**Output:** Updated `menu_item.classification` (categorical string).
**Precision:** N/A (categorical).

**Forward proof:** 3 items. CMs: $14, $8, $12. Mixes: 40%, 35%, 25%. avgCM = $11.33. avgMix = 33.33%. Item 1: CM 14 >= 11.33 AND mix 40 >= 33.33 => star. Item 2: CM 8 < 11.33 AND mix 35 >= 33.33 => plowhorse. Item 3: CM 12 >= 11.33 AND mix 25 < 33.33 => puzzle.
**Backward proof:** N/A -- classification is a decision function, not invertible.

**Chain:**
- Fed by: F-MC-05, F-MC-06
- Feeds: UI classification badges, AI recommendations

**Conversion system:** Neither.
**Test file:** PENDING
**Last verified:** 2026-06-01

---

## Prep

| ID | Name | Formula | Source | Precision | Test |
|---|---|---|---|---|---|
| F-PR-01 | Scaled line quantity | `(qty * portions / servings) / (yieldPct / 100)` | `prepMath.ts:156` | No rounding | `prepMath.test.ts` |
| F-PR-02 | Suggested portions | `round(covers * attachRate * mix * buffer)` | `prepMath.ts:93-96` | `Math.round` | `prepMath.test.ts` |
| F-PR-03 | Attach rate | Category-based lookup (0.4-1.0) | `prepMath.ts:34-45` | Exact (lookup) | `prepMath.test.ts` |
| F-PR-04 | Prep needed | `max(0, totalQuantity - onHand)` | `prepMath.ts:221` | `Math.round(x * 1000) / 1000` | `prepMath.test.ts` |

### F-PR-01 Scaled Line Quantity

**Category:** Prep
**Source:** `packages/server/src/services/prepMath.ts:156`
**Function:** `scaledLineQuantity(quantity, expectedPortions, servings, yieldPct)`

**Formula:**
```
scaled = (quantity * (expectedPortions / servings)) / (yieldPct / 100)
```

**Inputs:**
- `quantity`: number (per-batch ingredient amount)
- `expectedPortions`: number (how many portions to prep)
- `servings`: number > 0 (batch yield; defaults to 1 if invalid)
- `yieldPct`: number > 0 (yield percentage; defaults to 100 if invalid)

**Output:** number (scaled quantity in original unit)
**Precision:** No rounding -- raw float arithmetic.
**Guard:** Non-finite inputs default to 0 (quantity, portions) or safe values (servings=1, yieldPct=100).

**Forward proof:** qty=1000g, portions=100, servings=4, yield=100%. scaled = (1000 * 100/4) / (100/100) = 25000g.
**Backward proof:** Given scaled=25000, servings=4, yield=100%, portions=100: qty = 25000 * (100/100) * 4/100 = 1000. Lossless.

**Iron rule:** `scaledLineQuantity(50, 8, 1, 100)` = 400. Must match legacy formula `qty * portions` when servings=1 and yield=100%.

**Chain:**
- Fed by: F-PR-02 (expectedPortions), menu item data (quantity, servings, yieldPct)
- Feeds: `aggregatePrepLines` (prep rollup)

**Conversion system:** Neither -- operates in recipe units.
**Test file:** `packages/server/src/services/prepMath.test.ts`
**Last verified:** 2026-06-01

---

### F-PR-02 Suggested Portions

**Category:** Prep
**Source:** `packages/server/src/services/prepMath.ts:93-96`
**Function:** `computeSuggestedSelections(covers, items, opts)`

**Formula:**
```
attachRate = attachRateFor(category)        // F-PR-03
totalSold  = SUM(unitsSold) within category group
mix        = hasHistory ? unitsSold / totalSold : 1 / groupSize
buffer     = opts.buffer ?? 1.25            // DEFAULT_PREP_BUFFER
raw        = covers * attachRate * mix * buffer
suggested  = covers > 0 ? max(0, round(raw)) : 0
```

**Inputs:**
- `covers`: number (expected guest count)
- `items`: array of `{ menuItemId, category, unitsSold }`
- `opts.buffer`: number (default 1.25 = 25% safety margin)

**Output:** `SuggestedSelection[]` with `{ menuItemId, suggestedPortions, basis }`
**Precision:** `Math.round` on the final result. Integer output.
**Guard:** Non-positive covers = 0 portions. Items grouped by normalised category.

**Forward proof:** covers=100, category="main" (attach=1.0), 2 items: A sold 60, B sold 40. totalSold=100. mixA=0.6, mixB=0.4. buffer=1.25. rawA = 100*1.0*0.6*1.25 = 75. rawB = 100*1.0*0.4*1.25 = 50. suggestedA = round(75) = 75, suggestedB = round(50) = 50.
**Backward proof:** Lossy -- `Math.round` destroys sub-integer precision. Cannot recover exact raw from integer suggested.

**Chain:**
- Fed by: User-entered covers, sales history (unitsSold)
- Feeds: F-PR-01 (expectedPortions)

**Conversion system:** Neither.
**Test file:** `packages/server/src/services/prepMath.test.ts`
**Last verified:** 2026-06-01

---

### F-PR-03 Attach Rate

**Category:** Prep
**Source:** `packages/server/src/services/prepMath.ts:34-45`
**Function:** `attachRateFor(category)`

**Formula (lookup):**
```
dessert/sweet/pastry/patisserie  => 0.4
starter/appetiser/small plate    => 0.5
side                             => 0.5
drink/beverage/cocktail/wine     => 0.5
soup/salad                       => 0.6
main/entree/pasta/pizza/burger   => 1.0
(unknown/empty)                  => 1.0
```

**Inputs:** `category`: string | null | undefined (free-text menu category)
**Output:** number (0.4-1.0)
**Precision:** Exact -- hard-coded constants.

**Forward proof:** category="Dessert" => 0.4. category="Main Course" => 1.0. category="" => 1.0.
**Backward proof:** N/A -- lookup table.

**Chain:**
- Feeds: F-PR-02 (attachRate input)
- Fed by: `menu_item.category` (free-text)

**Conversion system:** Neither.
**Test file:** `packages/server/src/services/prepMath.test.ts`
**Last verified:** 2026-06-01

---

### F-PR-04 Prep Needed (On-Hand Adjustment)

**Category:** Prep
**Source:** `packages/server/src/services/prepMath.ts:221-222`
**Function:** `attachOnHand(lines, stockByIngredientId, convertUnit)`

**Formula:**
```
onHand     = stock.qty (converted to line.unit if needed via convertUnit callback)
prepNeeded = max(0, totalQuantity - onHand)
```

**Inputs:**
- `lines`: AggregatedPrepLine[] (output of `aggregatePrepLines`)
- `stockByIngredientId`: Map of current stock levels
- `convertUnit`: callback for unit conversion

**Output:** AggregatedPrepLine with `onHandQty` and `prepNeeded` attached.
**Precision:** `Math.round(x * 1000) / 1000` -- rounds to 3 decimal places for both onHand and prepNeeded.
**Guard:** No stock record = onHand 0, prepNeeded = totalQuantity. Conversion failure = line returned unchanged.

**Forward proof:** totalQuantity=25000g, stock=5000g (same unit). onHand=5000. prepNeeded = max(0, 25000-5000) = 20000g.
**Backward proof:** Lossy -- 3-decimal rounding. Given prepNeeded=20000, onHand=5000, totalQuantity = 20000+5000 = 25000. Recoverable for integers.

**Chain:**
- Fed by: F-PR-01 (totalQuantity via aggregation), F-SK-01/02 (stock levels)
- Feeds: Prep dashboard task list

**Conversion system:** System A or B depending on caller-provided callback.
**Test file:** `packages/server/src/services/prepMath.test.ts`
**Last verified:** 2026-06-01

---

## PO (Purchase Order)

| ID | Name | Formula | Source | Precision | Test |
|---|---|---|---|---|---|
| F-PO-01 | PO line total | `SUM(orderedQty * unitCost)` | `poMath.ts:24-30` | `Math.round(total * 100) / 100` | PENDING |
| F-PO-02 | Suggested order qty | `max(parLevel - currentQty, reorderQty ?? 0)` | `poMath.ts:42-47` | No rounding | PENDING |
| F-PO-03 | Estimated line cost | `suggestedQty * preferredUnitCost` | `poMath.ts:53-57` | `.toFixed(2)` via `Number()` | PENDING |
| F-PO-04 | HQ routing decision | `totalValue >= thresholdAmount` | `poMath.ts:63-67` | Boolean (exact) | PENDING |

### F-PO-01 PO Line Total

**Category:** PO
**Source:** `packages/server/src/services/poMath.ts:24-30`
**Function:** `sumPOLineTotal(lines)`

**Formula:**
```
total = SUM(orderedQty_i * unitCost_i) for all lines
result = Math.round(total * 100) / 100
```

**Inputs:**
- `lines`: array of `{ orderedQty: number, unitCost: number }`
- Non-finite values default to 0.

**Output:** number, rounded to 2 decimal places.
**Precision:** `Math.round(total * 100) / 100` -- banker's rounding to cents.

**Forward proof:** Line A: qty=50, cost=$2.40. Line B: qty=25, cost=$3.60. total = 50*2.40 + 25*3.60 = 120 + 90 = 210. result = Math.round(21000)/100 = 210.00.
**Backward proof:** Lossy -- `Math.round` at cent boundary. Cannot recover individual line values from aggregate.

**Chain:**
- Fed by: PO line items from `purchase_order_line` table
- Feeds: F-PO-04 (routing decision), `thresholdService.calculatePOTotal`

**Conversion system:** Neither.
**Test file:** PENDING
**Last verified:** 2026-06-01

---

### F-PO-02 Suggested Order Qty

**Category:** PO
**Source:** `packages/server/src/services/poMath.ts:42-47`
**Function:** `suggestedOrderQty(parLevel, currentQty, reorderQty)`

**Formula:**
```
shortfall = max(parLevel - currentQty, 0)
suggested = shortfall > 0 ? max(shortfall, reorderQty ?? 0) : 0
```

**Inputs:**
- `parLevel`: number (target stock level)
- `currentQty`: number (current stock)
- `reorderQty`: number | null (minimum order quantity)

**Output:** number (suggested quantity to order)
**Precision:** No rounding.
**Guard:** Returns 0 when currentQty >= parLevel (no shortfall).

**Forward proof:** par=100, current=30, reorder=50. shortfall = max(70, 0) = 70. suggested = max(70, 50) = 70.
Another case: par=100, current=30, reorder=100. shortfall=70. suggested = max(70, 100) = 100 (reorder minimum wins).
**Backward proof:** Lossy -- max() destroys info about whether shortfall or reorderQty was the binding constraint.

**Chain:**
- Fed by: `stock_level.current_qty` (F-SK-01/02), `ingredient.par_level`, `ingredient.reorder_qty`
- Feeds: F-PO-03 (estimatedLineCost), auto-PO suggestion UI

**Conversion system:** Neither -- operates in base units.
**Test file:** PENDING
**Last verified:** 2026-06-01

---

### F-PO-03 Estimated Line Cost

**Category:** PO
**Source:** `packages/server/src/services/poMath.ts:53-57`
**Function:** `estimatedLineCost(suggestedQty, preferredUnitCost)`

**Formula:**
```
estimatedCost = Number((suggestedQty * preferredUnitCost).toFixed(2))
```

**Inputs:**
- `suggestedQty`: number (from F-PO-02)
- `preferredUnitCost`: number

**Output:** number, rounded to 2 decimal places.
**Precision:** `.toFixed(2)` then `Number()` coercion.

**Forward proof:** suggestedQty=70, cost=$2.40 => 70*2.40 = 168.00.
**Backward proof:** Lossy at `.toFixed(2)`. Given cost=168.00 and unitCost=$2.40, qty = 168.00/2.40 = 70. Recoverable for clean numbers.

**Chain:**
- Fed by: F-PO-02 (suggestedQty), `ingredient.preferred_unit_cost`
- Feeds: Auto-PO suggestion line display, supplier block totals

**Conversion system:** Neither.
**Test file:** PENDING
**Last verified:** 2026-06-01

---

### F-PO-04 HQ Routing Decision

**Category:** PO
**Source:** `packages/server/src/services/poMath.ts:63-67`
**Function:** `shouldRouteToHQ(totalValue, thresholdAmount)`

**Formula:**
```
routeToHQ = thresholdAmount !== null AND totalValue >= thresholdAmount
```

**Inputs:**
- `totalValue`: number (from F-PO-01)
- `thresholdAmount`: number | null (from `spend_threshold` table)

**Output:** boolean. True = needs HQ approval.
**Precision:** Exact comparison.
**Guard:** null threshold = no threshold configured = always DIRECT.

**Forward proof:** totalValue=210.00, threshold=200.00 => 210 >= 200 = true (route to HQ).
**Backward proof:** N/A -- boolean decision, not invertible.

**Chain:**
- Fed by: F-PO-01 (totalValue), `thresholdService.getThreshold` (resolution: location override > org default > null)
- Feeds: PO approval routing in `thresholdService.determineRouting`

**Conversion system:** Neither.
**Test file:** PENDING
**Last verified:** 2026-06-01

---

## Forecast

| ID | Name | Formula | Source | Precision | Test |
|---|---|---|---|---|---|
| F-FC-01 | Daily usage rate | `totalConsumed / max(1, elapsedDays)` | `forecastMath.ts:22-25` | No rounding | `forecastMath.test.ts` |
| F-FC-02 | Days until depletion | `floor(max(0, currentStock / dailyRate))` | `forecastMath.ts:35-38` | `Math.floor` | `forecastMath.test.ts` |
| F-FC-03 | Suggested reorder qty | `ceil(dailyRate * bufferDays)` | `forecastMath.ts:44-47` | `Math.ceil` | `forecastMath.test.ts` |
| F-FC-04 | Forecast confidence | `min(1, daysWithData / windowDays)` | `forecastMath.ts:53-58` | No rounding (output capped at 2dp in caller) | `forecastMath.test.ts` |

### F-FC-01 Daily Usage Rate

**Category:** Forecast
**Source:** `packages/server/src/services/forecastMath.ts:22-25`
**Function:** `dailyUsageRate(totalConsumed, elapsedDays)`

**Formula:**
```
safeDays   = max(1, elapsedDays)
dailyUsage = totalConsumed / safeDays
```

**Inputs:**
- `totalConsumed`: number (sum of consumption_log.quantity over period)
- `elapsedDays`: number (calendar days in the lookback window)

**Output:** number (units consumed per day)
**Precision:** No rounding.
**Guard:** elapsedDays floored to 1 to prevent division by zero.

**Forward proof:** totalConsumed=300, elapsedDays=30 => dailyUsage = 300/30 = 10.
**Backward proof:** Given dailyUsage=10 and elapsedDays=30, totalConsumed = 10*30 = 300. Lossless.

**Chain:**
- Fed by: `consumption_log` aggregate query in `forecastService.generateForecasts`
- Feeds: F-FC-02, F-FC-03

**Conversion system:** Neither.
**Test file:** `packages/server/src/services/forecastMath.test.ts`
**Last verified:** 2026-06-01

---

### F-FC-02 Days Until Depletion

**Category:** Forecast
**Source:** `packages/server/src/services/forecastMath.ts:35-38`
**Function:** `daysUntilDepletion(currentStock, dailyRate)`

**Formula:**
```
daysRemaining = dailyRate > 0 ? floor(max(0, currentStock / dailyRate)) : 0
```

**Inputs:**
- `currentStock`: number (from `stock_level.current_qty`)
- `dailyRate`: number (from F-FC-01)

**Output:** integer (whole days)
**Precision:** `Math.floor` -- conservative estimate (never overpromises).
**Guard:** Returns 0 when dailyRate <= 0. Callers use sentinel 999 for "no depletion forecast possible".

**Forward proof:** currentStock=150, dailyRate=10 => floor(max(0, 150/10)) = floor(15) = 15 days.
**Backward proof:** Lossy -- `Math.floor` destroys fractional days. Given 15 days and rate=10, stock = 15*10 = 150 (only recoverable when division is exact).

**Chain:**
- Fed by: F-FC-01, F-SK-01/02 (stock levels)
- Feeds: Forecast recommendation creation (threshold check: daysRemaining < leadTime + buffer)

**Conversion system:** Neither.
**Test file:** `packages/server/src/services/forecastMath.test.ts`
**Last verified:** 2026-06-01

---

### F-FC-03 Suggested Reorder Qty

**Category:** Forecast
**Source:** `packages/server/src/services/forecastMath.ts:44-47`
**Function:** `suggestedReorderQty(dailyRate, bufferDays)`

**Formula:**
```
reorderQty = ceil(dailyRate * (bufferDays ?? 14))
```

**Inputs:**
- `dailyRate`: number (from F-FC-01)
- `bufferDays`: number (default 14 = 2 weeks supply)

**Output:** integer (units to order)
**Precision:** `Math.ceil` -- always rounds up (never under-orders).

**Forward proof:** dailyRate=10, bufferDays=14 => ceil(10*14) = ceil(140) = 140.
Another: dailyRate=7.5, bufferDays=14 => ceil(105) = 105.
**Backward proof:** Lossy -- `Math.ceil` means given reorderQty=105, dailyRate = 105/14 = 7.5 only if original was exactly 7.5. Could have been 7.01-7.5.

**Chain:**
- Fed by: F-FC-01
- Feeds: `forecast_recommendation.suggested_order_qty`

**Conversion system:** Neither.
**Test file:** `packages/server/src/services/forecastMath.test.ts`
**Last verified:** 2026-06-01

---

### F-FC-04 Forecast Confidence

**Category:** Forecast
**Source:** `packages/server/src/services/forecastMath.ts:53-58`
**Function:** `forecastConfidence(daysWithData, windowDays)`

**Formula:**
```
window     = windowDays ?? 30
confidence = min(1, daysWithData / window)
```

**Inputs:**
- `daysWithData`: number (distinct days with consumption data)
- `windowDays`: number (default 30)

**Output:** number between 0 and 1.
**Precision:** No rounding in the pure function. Caller stores as `String(Number(confidence.toFixed(2)))`.

**Forward proof:** daysWithData=15, window=30 => min(1, 15/30) = 0.5.
**Backward proof:** Given confidence=0.5 and window=30, daysWithData = 0.5*30 = 15. Lossy when stored at `.toFixed(2)`.

**Chain:**
- Fed by: `consumption_log` day count
- Feeds: `forecast_recommendation.confidence`, forecast UI display

**Conversion system:** Neither.
**Test file:** `packages/server/src/services/forecastMath.test.ts`
**Last verified:** 2026-06-01

---

## Yield Variance

| ID | Name | Formula | Source | Precision | Test |
|---|---|---|---|---|---|
| F-YV-01 | Theoretical cost | `unitsSold * SUM(qty * unitCost / (yieldPct/100))` | `yieldVarianceService.ts:105-113` | Intermediate float | `yieldVarianceService.test.ts` |
| F-YV-02 | Actual cost | `SUM(consumption.qty * ingredient.preferred_unit_cost)` | `yieldVarianceService.ts:122` | SQL numeric | `yieldVarianceService.test.ts` |
| F-YV-03 | Yield variance | `actual - theoretical` | `yieldVarianceService.ts:139` | `.toFixed(2)` | `yieldVarianceService.test.ts` |
| F-YV-04 | Yield variance % | `(variance / theoretical) * 100` | `yieldVarianceService.ts:140` | `.toFixed(2)` | `yieldVarianceService.test.ts` |
| F-YV-05 | Variance threshold | Categorical: good/warning/alert | `yieldVarianceService.ts:141-142` | Exact | `yieldVarianceService.test.ts` |

### F-YV-01 Theoretical Cost

**Category:** Yield Variance
**Source:** `packages/server/src/services/yieldVarianceService.ts:105-113`
**Function:** `getYieldVariance(menuItemId)` (inline)

**Formula:**
```
perUnitRecipeCost = SUM((qty * unitCost) / (yieldPct / 100))  // for each ingredient row
theoretical       = perUnitRecipeCost * unitsSold
```

**Inputs:**
- `menu_item_ingredient` rows: quantity, unitCost, yieldPct
- `menu_item.units_sold`: integer

**Output:** number (total theoretical food cost for period)
**Precision:** Intermediate float -- no rounding until final output.
**Guard:** Skips ingredients where qty, cost, or yieldPct are non-finite or yieldPct is 0.

**Forward proof:** 2 ingredients: A: qty=0.5, cost=$12, yield=80%. B: qty=0.2, cost=$8, yield=100%. perUnit = (0.5*12)/(0.8) + (0.2*8)/(1.0) = 7.50 + 1.60 = 9.10. unitsSold=50. theoretical = 9.10*50 = $455.00.
**Backward proof:** Given theoretical=$455 and unitsSold=50, perUnit = 455/50 = $9.10. Cannot decompose to individual ingredients.

**Chain:**
- Fed by: `menu_item_ingredient` (quantity, unitCost, yieldPct), `menu_item.units_sold`
- Feeds: F-YV-03 (variance)

**Conversion system:** Neither (uses raw recipe quantities).
**Test file:** `packages/server/src/services/yieldVarianceService.test.ts`
**Last verified:** 2026-06-01

---

### F-YV-02 Actual Cost

**Category:** Yield Variance
**Source:** `packages/server/src/services/yieldVarianceService.ts:122`
**Function:** `getYieldVariance(menuItemId)` (SQL query)

**Formula (SQL):**
```sql
actual = COALESCE(SUM(c.quantity::numeric * COALESCE(i.preferred_unit_cost, 0)::numeric), 0)
         WHERE c.menu_item_id = :menuItemId
         AND c.logged_at BETWEEN period_start AND period_end
```

**Inputs:**
- `consumption_log` rows tagged with `menu_item_id`
- `ingredient.preferred_unit_cost`
- Period bounds from `menu_item.period_start/period_end`

**Output:** number (total actual food cost for period)
**Precision:** SQL numeric at DB level. `parseFloat` on retrieval.
**Guard:** COALESCE to 0 if no consumption data. Minimum `MIN_LOG_ROWS=1` consumption entries required; below that, returns "thin-data" status.

**Forward proof:** 3 consumption entries: 0.6kg @ $12/kg, 0.3kg @ $8/kg, 0.2kg @ $12/kg. actual = (0.6*12) + (0.3*8) + (0.2*12) = 7.20 + 2.40 + 2.40 = $12.00.
**Backward proof:** Lossy -- SUM aggregation; cannot recover individual entries.

**Chain:**
- Fed by: `consumption_log` entries (via B1 logging path), `ingredient.preferred_unit_cost`
- Feeds: F-YV-03 (variance)

**Conversion system:** Neither.
**Test file:** `packages/server/src/services/yieldVarianceService.test.ts`
**Last verified:** 2026-06-01

---

### F-YV-03 Yield Variance

**Category:** Yield Variance
**Source:** `packages/server/src/services/yieldVarianceService.ts:139`

**Formula:**
```
variance = actual - theoretical
```

**Inputs:**
- `actual`: number (from F-YV-02)
- `theoretical`: number (from F-YV-01)

**Output:** number. Positive = overuse (bad). Negative = underuse.
**Precision:** `Number(variance.toFixed(2))`.

**Forward proof:** actual=$490, theoretical=$455 => variance = $35 (overuse).
**Backward proof:** Given variance=$35 and theoretical=$455, actual = 455+35 = $490. Lossy at `.toFixed(2)` boundary.

**Chain:**
- Fed by: F-YV-01, F-YV-02
- Feeds: F-YV-04 (variancePct)

**Conversion system:** Neither.
**Test file:** `packages/server/src/services/yieldVarianceService.test.ts`
**Last verified:** 2026-06-01

---

### F-YV-04 Yield Variance Percentage

**Category:** Yield Variance
**Source:** `packages/server/src/services/yieldVarianceService.ts:140`

**Formula:**
```
variancePct = theoretical > 0 ? (variance / theoretical) * 100 : 0
```

**Inputs:**
- `variance`: number (from F-YV-03)
- `theoretical`: number (from F-YV-01)

**Output:** number (percentage).
**Precision:** `Number(variancePct.toFixed(2))`.

**Forward proof:** variance=$35, theoretical=$455 => (35/455)*100 = 7.69%.
**Backward proof:** Given pct=7.69% and theoretical=$455, variance = 7.69/100 * 455 = $34.99 (lossy from `.toFixed(2)`).

**Chain:**
- Fed by: F-YV-03
- Feeds: F-YV-05 (threshold classification)

**Conversion system:** Neither.
**Test file:** `packages/server/src/services/yieldVarianceService.test.ts`
**Last verified:** 2026-06-01

---

### F-YV-05 Variance Threshold Classification

**Category:** Yield Variance
**Source:** `packages/server/src/services/yieldVarianceService.ts:141-142`

**Formula:**
```
absPct = abs(variancePct)
threshold = absPct <= 3 ? "good" : absPct <= 8 ? "warning" : "alert"
```

**Inputs:**
- `variancePct`: number (from F-YV-04)

**Output:** "good" | "warning" | "alert"
**Precision:** Exact (categorical).
**Note:** Sign matters for interpretation (positive = overuse = bad), but threshold uses absolute value.

**Thresholds:**
- good: |pct| <= 3%
- warning: 3% < |pct| <= 8%
- alert: |pct| > 8%

**Forward proof:** variancePct=7.69% => abs=7.69. 7.69 > 3 AND 7.69 <= 8 => "warning".
**Backward proof:** N/A -- categorical.

**Chain:**
- Fed by: F-YV-04
- Feeds: UI variance pill color, Menu Intelligence list view

**Conversion system:** Neither.
**Test file:** `packages/server/src/services/yieldVarianceService.test.ts`
**Last verified:** 2026-06-01

---

## Auto-PO Suggest (Consumer Formulas)

The auto-PO suggestion service (`autoPoSuggestService.ts`) does not define its own formulas. It consumes F-PO-02 and F-PO-03 from `poMath.ts` and applies rounding for display:

| ID | Name | Formula | Source | Precision |
|---|---|---|---|---|
| F-AP-01 | Shortfall (display) | `Number(shortfall.toFixed(3))` | `autoPoSuggestService.ts:146` | 3 decimal places |
| F-AP-02 | Suggested qty (display) | `Number(suggestedQtyVal.toFixed(3))` | `autoPoSuggestService.ts:147` | 3 decimal places |
| F-AP-03 | Estimated total (running) | `Number((block.estimatedTotal + estimatedCost).toFixed(2))` | `autoPoSuggestService.ts:153` | 2 decimal places |

These are presentation-layer rounding wrappers, not independent formulas. The core logic lives in F-PO-02 and F-PO-03.

---

## Threshold (Consumer Logic)

The threshold service (`thresholdService.ts`) does not define formulas of its own. It:
1. Resolves the effective threshold via priority cascade: `location_override > org_default > null`
2. Calls `sumPOLineTotal` (F-PO-01) to compute the PO total
3. Calls `shouldRouteToHQ` (F-PO-04) to make the routing decision

**Resolution order (line 39-55):**
```
1. Check spend_threshold WHERE store_location_id = locationId AND org_id = orgId
   => If found, return Number(thresholdAmount)
2. Check spend_threshold WHERE store_location_id IS NULL AND org_id = orgId
   => If found, return Number(thresholdAmount)
3. Return null (no threshold = all POs go direct)
```

---

## Test Coverage Summary

| File | Test File | Status |
|---|---|---|
| `prepMath.ts` | `prepMath.test.ts` | Exists |
| `poMath.ts` | -- | PENDING |
| `stockMath.ts` | `stockMath.test.ts` | Exists |
| `forecastMath.ts` | `forecastMath.test.ts` | Exists |
| `menuIntelligenceService.ts` | `menuIntelligenceService.phase3.test.ts` | Exists (partial) |
| `yieldVarianceService.ts` | `yieldVarianceService.test.ts` | Exists |
| `unitConversionService.ts` | `unitConversionService.test.ts` | Exists |
| `shared/utils/units.ts` | `units.test.ts` | Exists |
| `wacService.ts` | -- | PENDING |
| `stockService.ts` | -- | PENDING |
| `stockTakeService.ts` | `stockTakeService.test.ts` | Exists |
| `thresholdService.ts` | -- | PENDING |
| `autoPoSuggestService.ts` | -- | PENDING |
| `forecastService.ts` | -- | PENDING (integration) |
