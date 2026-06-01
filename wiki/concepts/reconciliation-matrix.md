---
title: Reconciliation Matrix
category: concept
created: 2026-06-01
updated: 2026-06-01
related: [[formula-catalog]], [[technical-architecture]], [[data-flow-architecture]]
---

Cross-reference of every stock-affecting and cost-affecting operation in CulinAIre Kitchen. Each row documents the operation, its effects on stock and cost, what it must balance against, and which formulas from the [[formula-catalog]] it depends on.

---

## Stock and Cost Effects Matrix

| Operation | Stock Effect | Cost Effect | Must Balance Against | Formulas Used |
|---|---|---|---|---|
| **Delivery receiving** (`confirmReceipt`) | Increase: `addStock(location, ingredient, receivedQty)` | FIFO batch created (`fifo_batch.original_quantity`, `unit_cost`). WAC recomputed for `location_ingredient`. | PO line qty vs received qty (discrepancy tracked per line). FIFO batch total must equal received value. WAC must reflect all batches at location. | F-SK-01, F-WAC-01 |
| **Transfer send** (`transferService`) | Decrease at source: `deductStock(sourceLocation, ingredient, qty)` | No direct cost change. FIFO batches remain at source (cost follows batch, not transfer). | Transfer receive at destination must match send qty. Stock at source must not go below 0 without operational review. | F-SK-02 |
| **Transfer receive** (`transferService`) | Increase at destination: `addStock(destLocation, ingredient, qty)` | FIFO batch created at destination (unit_cost carried from source). WAC recomputed at destination. | Must match transfer send qty exactly. FIFO batch at destination inherits cost from source batches. | F-SK-01, F-WAC-01 |
| **Stock take approve** (`approveSession`) | Reset: `upsertStockLevel(location, ingredient, countedQty)` | No direct cost change. Variance = counted - expected (F-ST-01). | Previous approved count (expected) vs current count (counted). Variance qty and pct computed and stored per line. System-of-record stock becomes the counted qty. | F-ST-01, F-ST-02, F-UC-02 |
| **Consumption logging** (`consumptionLogService`) | Decrease: `deductStock(location, ingredient, consumedQty)` | Consumption cost = qty * WAC. Tagged with `menu_item_id` for yield variance tracking. | Actual cost (F-YV-02) must be trackable against theoretical cost (F-YV-01) per dish when yield variance is computed. | F-SK-02, F-YV-02 |
| **Waste logging** (`wasteService`) | Decrease: quantity removed from usable stock | Waste cost tracked: `qty * unit_cost`. Categorised by reason (spoilage, over-prep, etc.). | Waste value should be reconcilable against total food cost. Waste % = waste cost / total food cost. | F-SK-02 |
| **PO creation** | No immediate stock effect (stock changes on receipt, not on PO creation) | Line totals computed: `orderedQty * unitCost` per line. PO total = SUM of line totals. Threshold routing determines approval path. | PO total must equal SUM of line totals (F-PO-01). Routing decision (F-PO-04) must use server-computed total, never client-submitted. | F-PO-01, F-PO-04 |
| **Menu cost recalculation** (`recalculateItemCosts`) | No stock effect | Line cost per ingredient (F-MC-01). Food cost per serving (F-MC-03). Food cost % (F-MC-04). Contribution margin (F-MC-05). Classification (F-MC-07). | food_cost must equal SUM(line_costs) / servings * (1 + qFactor/100). food_cost_pct must equal food_cost / selling_price * 100. CM must equal selling_price - food_cost. All stored values must be refreshable and reproducible. | F-UC-01, F-MC-01 through F-MC-07 |

---

## Detailed Reconciliation Rules

### 1. Receiving -> Stock + FIFO + WAC

**Flow:**
```
PO submitted -> Delivery arrives -> receivingService.confirmReceipt()
  -> For each line:
       1. addStock(location, ingredient, acceptedQty)           [F-SK-01]
       2. Insert fifo_batch(original_quantity, unit_cost)
  -> wacService.recompute(affected pairs, tx)                   [F-WAC-01]
  -> All within a single DB transaction
```

**Balance checks:**
- `SUM(fifo_batch.original_quantity)` at a (location, ingredient) must be traceable to the sequence of receiving events
- WAC after recompute must satisfy: `WAC = SUM(batch.qty * batch.cost) / SUM(batch.qty)` across all FIFO batches for that (location, ingredient)
- Discrepancy per line: `received_qty - ordered_qty` tracked on the receiving session line (short, over, or damaged)
- Credit notes created for damaged/rejected lines

---

### 2. Transfer Send -> Stock Decrease at Source

**Flow:**
```
Transfer created (status: PENDING)
  -> transferService processes send side:
       1. deductStock(sourceLocation, ingredient, qty)          [F-SK-02]
       2. Transfer status -> IN_TRANSIT
```

**Balance checks:**
- `source.stock_level.current_qty` after deduct = `before - transferQty`
- Transfer record preserves the qty for the receive side to match against
- Optimistic locking (version check) prevents concurrent modification

---

### 3. Transfer Receive -> Stock Increase at Destination

**Flow:**
```
Transfer arrives at destination
  -> transferService processes receive side:
       1. addStock(destLocation, ingredient, qty)               [F-SK-01]
       2. Insert fifo_batch at destination (cost from source)
       3. wacService.recompute(destination pairs, tx)           [F-WAC-01]
       4. Transfer status -> COMPLETED
```

**Balance checks:**
- `destination.stock_level.current_qty` after add = `before + transferQty`
- Transfer send qty must equal transfer receive qty (same record)
- FIFO batch at destination carries cost from source (no markup in internal transfers)
- WAC at destination recomputed to include the new batch

---

### 4. Stock Take Approve -> Stock Reset

**Flow:**
```
Stock take session opened -> Categories claimed -> Lines counted
  -> For each line:
       1. convertToBase(ingredientId, rawQty, countedUnit)      [F-UC-02]
       2. getPreviousCount(ingredient, category) -> expectedQty
       3. varianceQty(baseQty, expectedQty)                     [F-ST-01]
       4. variancePct(variance, expectedQty)                    [F-ST-02]
  -> Session submitted for review -> Approved
  -> For each approved line:
       1. upsertStockLevel(location, ingredient, countedQty)
          // This REPLACES current_qty, not adds/subtracts
```

**Balance checks:**
- Stock after approval = counted qty exactly (not an adjustment -- a full reset)
- Variance = counted - expected; this is stored for audit trail but does not affect the reset
- Unit conversion (F-UC-02) must be applied before variance calculation; raw qty and base qty both stored
- Opening count sessions auto-approve (first count sets baseline; no previous count to compare)

---

### 5. Consumption -> Stock Decrease + Yield Tracking

**Flow:**
```
Consumption logged (manual or via prep completion)
  -> consumptionLogService:
       1. deductStock(location, ingredient, consumedQty)        [F-SK-02]
       2. consumption_log row created with menu_item_id tag
  -> Later, yieldVarianceService.getYieldVariance(menuItemId):
       1. theoretical = unitsSold * SUM(ingQty * cost / yield)  [F-YV-01]
       2. actual = SUM(consumption.qty * ingredient.cost)       [F-YV-02]  (SQL)
       3. variance = actual - theoretical                       [F-YV-03]
       4. variancePct = variance / theoretical * 100            [F-YV-04]
       5. threshold classification                              [F-YV-05]
```

**Balance checks:**
- `actual - theoretical` should trend toward zero for a well-run kitchen
- Positive variance = overuse (more actual cost than recipe predicts)
- Negative variance = underuse (less actual cost, possibly under-portioning)
- Threshold bands: good (<=3%), warning (3-8%), alert (>8%)
- Minimum `MIN_LOG_ROWS=1` consumption entries required; below that, "thin-data" status returned instead of unreliable variance

---

### 6. Waste Logging -> Cost Tracking

**Flow:**
```
Waste event logged via wasteService
  -> Stock decrease (ingredient removed from usable inventory)
  -> Waste cost = qty * unit_cost
  -> Categorised by waste reason for reporting
```

**Balance checks:**
- Waste value is a subset of total food cost -- it should be reconcilable against inventory movements
- Waste % of total food cost is a key operational metric
- Waste reason categorisation (spoilage, over-prep, expiry, etc.) enables root-cause analysis

---

### 7. PO Creation -> Line Totals + Threshold Routing

**Flow:**
```
PO created with line items
  -> sumPOLineTotal(lines)                                      [F-PO-01]
  -> determineRouting(poId, orgId, locationId):
       1. calculatePOTotal(poId) [server-side recomputation]
       2. getThreshold(orgId, locationId)
          // Priority: location override > org default > null
       3. shouldRouteToHQ(totalValue, threshold)                [F-PO-04]
  -> Route: DIRECT (send to supplier) or HQ_APPROVAL (queue for approval)
```

**Balance checks:**
- PO total must equal `SUM(orderedQty * unitCost)` across all lines -- server always recomputes, never trusts client
- Threshold resolution is deterministic: location-specific > org-wide > no threshold
- null threshold = all POs go direct (no approval required)
- PO total used for routing must be the server-computed value from `calculatePOTotal`, not any client-submitted value

---

### 8. Menu Cost Recalculation -> Full Cost Chain

**Flow:**
```
recalculateMenu(userId, category) triggers full refresh:
  -> For each menu item:
       1. recalculateItemCosts(menuItemId):
            a. SUM(lineCost) from menu_item_ingredient           [F-MC-01]
            b. perServing = total / servings
            c. foodCost = perServing * (1 + qFactor/100)         [F-MC-03]
            d. foodCostPct = foodCost / sellingPrice * 100       [F-MC-04]
            e. CM = sellingPrice - foodCost                      [F-MC-05]
       2. menuMixPct = unitsSold / totalUnitsSold * 100          [F-MC-06]
       3. Classification via avgCM/avgMix matrix                 [F-MC-07]
```

**Balance checks:**
- `food_cost` must equal `SUM(line_costs) / servings * (1 + qFactor/100)` at all times
- `food_cost_pct` must equal `food_cost / selling_price * 100`
- `contribution_margin` must equal `selling_price - food_cost`
- `SUM(menu_mix_pct)` across all items should equal 100% (within float precision)
- Classification is deterministic given CM and mix values relative to their means
- Recalculation is idempotent -- running twice with no data changes produces identical results

---

## Auto-PO Suggestion -> Reconciliation with Stock

**Flow:**
```
getAutoPoSuggestions(storeLocationId):
  -> For each ingredient WHERE current_qty < par_level:
       1. shortfall = par_level - current_qty
       2. suggestedQty = suggestedOrderQty(par, current, reorder) [F-PO-02]
       3. estimatedCost = estimatedLineCost(suggested, unitCost)   [F-PO-03]
  -> Group by preferred supplier
```

**Balance checks:**
- shortfall must be positive (WHERE clause ensures current < par)
- suggestedQty >= shortfall (reorder minimum may push it higher via max())
- estimatedCost is advisory only -- actual PO line cost may differ based on negotiated pricing
- Supplier grouping is for display convenience; no aggregation affects the per-line math

---

## Cross-Operation Invariants

These invariants must hold across operations:

1. **Stock conservation:** For any ingredient at any location, `current_qty` at time T must equal:
   ```
   initial_qty (from stock take)
   + SUM(received_qty)           -- receiving
   + SUM(transfer_in_qty)        -- transfers received
   - SUM(transfer_out_qty)       -- transfers sent
   - SUM(consumed_qty)           -- consumption
   - SUM(wasted_qty)             -- waste
   ```
   Any discrepancy between this computed value and the actual `current_qty` is a stock take variance.

2. **WAC consistency:** `location_ingredient.weighted_average_cost` must always equal `SUM(fifo_batch.original_quantity * fifo_batch.unit_cost) / SUM(fifo_batch.original_quantity)` for all active FIFO batches at that (location, ingredient). Recomputed eagerly after every receiving and transfer-receive event.

3. **Menu cost reproducibility:** `menu_item.food_cost` must be reproducible by re-running `recalculateItemCosts` with the current ingredient data. The stored value is a cache, not a source of truth.

4. **PO total integrity:** The routing decision must use a server-computed PO total, never a client-submitted value. `thresholdService.calculatePOTotal` re-reads PO lines from the database.

5. **Unit conversion consistency:** All quantities stored in `stock_level`, `fifo_batch`, `stock_take_line`, and `consumption_log` are in the ingredient's `base_unit`. Conversion (F-UC-01 or F-UC-02) happens at input time, not at read time.
