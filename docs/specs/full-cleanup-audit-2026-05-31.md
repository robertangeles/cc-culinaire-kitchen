

Good. I've now verified the key findings against the actual code. Let me note what I've confirmed and what's already fixed:

**Already fixed / false positives to exclude:**
- WasteLogger `saveEdit` missing `finally` -- line 319-321 shows it already has `finally { setSavingEdit(false); }`. EXCLUDE.
- `menuItemIngredient.menuItemId` (line 828) "no .references() FK constraint AND no index" -- line 828 does lack `.references()` to menuItem, but line 863 shows `idx_menu_item_ingredient_ingredient` exists on `ingredientId`, and line 830 has `.references()` on `ingredientId`. The audit was about `menuItemId` specifically -- confirmed: `menuItemId` on line 828 has NO `.references()` and NO index. The indexes at line 860-866 are on `ingredientId` and `prepComponentId`, not on `menuItemId`. CONFIRMED BUG.
- `inventory_transfer_line.fifoBatchId` "no index" -- line 1882-1885 shows indexes exist for `transferId` and `ingredientId` but NOT for `fifoBatchId`. CONFIRMED.
- `prep_task.menuItemId` and `recipeId` "no indexes" -- line 983-990 shows indexes on `prepSessionId`, `ingredientId`, `prepComponentId` but NOT on `menuItemId` or `recipeId`. CONFIRMED.
- `prepMenuSelection.recipeId` and `menuItemId` "no indexes" -- line 1025-1034 shows no index builder at all. CONFIRMED.
- `ingredientCrossUsage.ingredientId` "no index" -- line 1036-1053 shows no index builder. CONFIRMED.
- `CreateIngredientSchema` missing `itemType` and `fifoApplicable` -- lines 51-74 confirm they are absent. `UpdateIngredientSchema` at line 93-94 has them. CONFIRMED BUG.

Here is the consolidated, prioritized fix list:

---

## PRIORITIZED FIX LIST

### CRITICAL (data corruption)

**C1. IngredientCatalog edit modal: pack-cost round-trip corrupts unitCost**
- File: `packages/client/src/components/inventory/IngredientCatalog.tsx`
- Lines: 399-401 (init), 745 (save)
- Problem: Edit modal reconstructs pack cost as `unitCost * packQty` for display. If user clears packQty and saves, the inflated pack-cost value is stored as unitCost. Root cause of the "$4,550 egg carton" class of bugs.
- Fix: Stop reconstructing pack cost from unitCost. Either (a) always display and edit unitCost directly with a read-only derived pack cost, or (b) store packCost as a separate field. On save, always derive `unitCost = cost / packQty` when packQty > 0, else `unitCost = cost`. Remove the `packCostInit` calculation at lines 399-401.
- Size: **L**
- Sequencing: Must be done BEFORE any cost recalculation fixes. Blocks C1-downstream.

---

### BUG (functional defects)

**B1. CreateIngredientSchema silently strips itemType and fifoApplicable**
- File: `packages/server/src/controllers/ingredientController.ts`
- Lines: 51-74
- Problem: Client sends `itemType` and `fifoApplicable` on create, but Zod strips them. UpdateIngredientSchema (line 93-94) already has both. New ingredients always get DB defaults.
- Fix: Add to CreateIngredientSchema:
  ```ts
  itemType: z.enum(["KITCHEN_INGREDIENT", "FOH_CONSUMABLE", "OPERATIONAL_SUPPLY"]).optional(),
  fifoApplicable: z.string().optional(),
  ```
- Size: **S**
- Batch: safe to batch independently

**B2. handleUpdateMenuItem passes req.body to service with NO Zod validation**
- File: `packages/server/src/controllers/menuIntelligenceController.ts`
- Lines: 80-88
- Problem: Any arbitrary field in req.body reaches the service layer unsanitized. Injection surface.
- Fix: Add a Zod schema for menu item updates (partial of menuItemSchema plus `unitsSold: z.number().int().optional()`) and validate `req.body` before passing to `updateMenuItem`.
- Size: **M**
- Batch: safe to batch independently

**B3. wasteLog insert never populates storeLocationId**
- File: `packages/server/src/services/wasteService.ts`
- Lines: 82-94
- Problem: Every waste log row has `storeLocationId = NULL`. Location-scoped waste queries return empty.
- Fix: Accept `storeLocationId` in the insert, source it from user's `selectedLocationId` (same pattern as prepService.ts:223).
- Size: **M**
- Batch: safe to batch independently

**B4. menuItem insert never populates storeLocationId**
- File: `packages/server/src/services/menuIntelligenceService.ts`
- Lines: 40-47
- Problem: All menu items have `storeLocationId = NULL`. Location-scoped menu queries return inconsistent results.
- Fix: Accept `storeLocationId` in `createMenuItem` signature and pass into `.values()`.
- Size: **M**
- Batch: safe to batch independently

**B5. menuItemIngredient.menuItemId has no FK constraint and no index**
- File: `packages/server/src/db/schema.ts`
- Line: 828
- Problem: Primary join column for "get all ingredients for a menu item" -- the hottest query in Menu Intelligence -- does a sequential scan. No FK means orphan rows on menuItem deletion.
- Fix: Add `.references(() => menuItem.menuItemId, { onDelete: 'cascade' })` to line 828, and add `index('idx_menu_item_ingredient_menu_item').on(table.menuItemId)` to the index builder at line 860.
- Size: **S**
- Batch: batch with other schema index fixes (B6, B7, B8)

**B6. menuItem table has zero indexes and zero FK constraints on userId/storeLocationId**
- File: `packages/server/src/db/schema.ts`
- Lines: 773-810
- Problem: No FK on userId or storeLocationId. No indexes for the userId + storeLocationId filter used by getMenuItems.
- Fix: Add `.references(() => user.userId)` to userId (line 775), `.references(() => storeLocation.storeLocationId)` to storeLocationId (line 776), add index builder with `index('idx_menu_item_user').on(table.userId)` and `index('idx_menu_item_store').on(table.storeLocationId)`.
- Size: **M**
- Batch: batch with B5, B7, B8

**B7. wasteLog.storeLocationId has no FK and no index**
- File: `packages/server/src/db/schema.ts`
- Line: 904
- Problem: Sequential scan on every location-scoped waste query.
- Fix: Add `.references(() => storeLocation.storeLocationId)` and add an index builder: `(table) => [index('idx_waste_log_store').on(table.storeLocationId)]`.
- Size: **S**
- Batch: batch with B5, B6, B8

**B8. prepSession.storeLocationId has no FK and no index**
- File: `packages/server/src/db/schema.ts`
- Line: 932
- Problem: Sequential scan on every location-scoped prep query.
- Fix: Add `.references(() => storeLocation.storeLocationId)` and add an index builder: `(table) => [index('idx_prep_session_store').on(table.storeLocationId)]`.
- Size: **S**
- Batch: batch with B5, B6, B7

**B9. Prep session mutators allow modification of ended sessions**
- File: `packages/server/src/services/prepService.ts`
- Lines: 373, 448, 848
- Problem: `saveMenuSelections`, `generateTasksFromSelections`, and `updateTaskStatus` never check `isEndedInd`. A chef can mutate an ended session.
- Fix: After ownership verification in each function, add: `if (session.isEndedInd) throw new Error('Cannot modify an ended prep session');`
- Size: **M**
- Sequencing: Must be done BEFORE B10 (which depends on correct lifecycle guards)

**B10. updateTaskStatus applies stock adjustment on every status change, not just completed transitions**
- File: `packages/server/src/services/prepService.ts`
- Lines: 871-905
- Problem: Changing pending->in_progress calls `addStock` even though nothing was deducted. Completing twice deducts twice. The code checks `if (status === 'completed') deduct ELSE add` with no previous-status comparison.
- Fix: Read task's previous status before update. Only deduct when transitioning TO 'completed' from non-completed. Only add back when transitioning FROM 'completed' to non-completed.
- Size: **M**
- Sequencing: depends on B9 (ended session guard)

**B11. updateTaskStatus creates phantom stock when un-completing a task with no stock_level row**
- File: `packages/server/src/services/prepService.ts`
- Lines: 893-901
- Problem: If original deduction failed (no stock_level row), un-completing calls `addStock` which creates a new stock row with phantom quantity.
- Fix: Before calling `addStock` on un-complete, verify a `stock_level` row exists for that ingredient+location. Skip addStock if no row exists.
- Size: **S**
- Sequencing: depends on B10

**B12. PrepDashboard uses wrong check for session-ended state**
- File: `packages/client/src/components/copilot/PrepDashboard.tsx`
- Line: 327
- Problem: Checks `session?.actualCovers != null` instead of `session?.isEnded`. Sessions ended without logging covers (via "End without logging" button) still show the active prep dashboard.
- Fix: Add `isEnded: boolean` to PrepSession interface (between lines 46-58). Change line 327 to `if (session?.isEnded)`.
- Size: **S**
- Batch: safe to batch with B13

**B13. PrepSession/PrepTask interfaces missing fields from server response**
- File: `packages/client/src/components/copilot/PrepDashboard.tsx` lines 25-58, `packages/client/src/pages/KitchenCopilotPage.tsx` lines 45-78
- Problem: PrepTask missing `ingredientId`, `useBy`, `isOverPrep`. PrepSession missing `isEnded`. Server sends these but TypeScript cannot see them.
- Fix: Add to PrepTask: `ingredientId: string | null; useBy: string | null; isOverPrep: boolean;`. Add to PrepSession: `isEnded: boolean;`. Apply to both files.
- Size: **S**
- Batch: batch with B12

**B14. IngredientCatalog EditIngredientModal save handler has no try/finally**
- File: `packages/client/src/components/inventory/IngredientCatalog.tsx`
- Lines: 736-758
- Problem: If `onSave` throws, `setSaving(false)` is never reached. Save button stays disabled permanently.
- Fix: Wrap in try/finally: `try { await onSave({...}); } finally { setSaving(false); }`
- Size: **S**
- Batch: batch with B15

**B15. IngredientCatalog AddIngredientForm save handler has no try/finally**
- File: `packages/client/src/components/inventory/IngredientCatalog.tsx`
- Lines: 937-961
- Problem: Same as B14 -- if `onSave` throws, `setSaving(false)` never runs.
- Fix: Wrap in try/finally: `try { await onSave({...}, ...); } finally { setSaving(false); }`
- Size: **S**
- Batch: batch with B14

**B16. TransferForm "Confirm Send" reads stale React state after handleSubmit**
- File: `packages/client/src/components/inventory/TransferForm.tsx`
- Lines: 546-552
- Problem: `handleSubmit()` sets error via `setError`, but `!error` on line 548 reads the pre-handleSubmit value (stale closure). Confirm-send always proceeds even if handleSubmit set an error.
- Fix: Make `handleSubmit` return a boolean success indicator. Gate `confirmSent` on that return value instead of reading `error` state.
- Size: **M**
- Batch: safe to batch independently

**B17. endSession does not check isEndedInd -- allows double-ending**
- File: `packages/server/src/services/prepService.ts`
- Lines: 1144-1169
- Problem: Calling endSession on an already-ended session overwrites actualCovers.
- Fix: Add `eq(prepSession.isEndedInd, false)` to the WHERE clause on line 1158, or guard after fetch.
- Size: **S**
- Batch: batch with B9

**B18. prepService N+1 query in stock lookup loop**
- File: `packages/server/src/services/prepService.ts`
- Lines: 627-636
- Problem: Per-row DB call inside the stockRows loop to fetch baseUnit. Reintroduces N+1 pattern.
- Fix: Batch-load baseUnit for all catalogIds in a single query before the loop. Build a `Map<ingredientId, baseUnit>`. Replace the per-row query at lines 631-635 with a map lookup.
- Size: **M**
- Batch: safe to batch independently

**B19. PurchaseOrderForm pre-populates unitCost in wrong unit denomination**
- File: `packages/client/src/components/inventory/PurchaseOrderForm.tsx`
- Lines: 140, 189-195
- Problem: Pre-populates per-base-unit cost as the PO line cost. When orderedUnit differs from baseUnit (e.g. ordering cases but cost is per-egg), total is wrong.
- Fix: Convert per-base-unit cost to per-ordered-unit cost using the unit conversion table, or populate from supplier's packCost/costPerUnit.
- Size: **L**
- Sequencing: depends on C1 (cost model clarity)

---

### STALE (dead code / unused declarations)

**S1. Unused useState declarations across client components**
- All safe to batch independently, all size **S**

| # | File | Line | What to remove |
|---|------|------|----------------|
| S1a | `packages/client/src/components/inventory/IngredientCatalog.tsx` | 806 | `const [packCost, setPackCost] = useState(...)` |
| S1b | `packages/client/src/components/inventory/StockTakeSession.tsx` | 35-37 | `flagModalOpen`, `flagReason`, `flaggedCats` useState lines |
| S1c | `packages/client/src/components/recipes/RecipeCard.tsx` | 135 | `const [copied, setCopied] = useState(...)` |
| S1d | `packages/client/src/components/recipes/RecipeForm.tsx` | 156 | `setFlavourProfile` setter (replace with `const flavourProfile = ''`) |
| S1e | `packages/client/src/components/menu/MenuItemDetail.tsx` | 55 | `setIngYield` setter (replace with `const ingYield = '100'`) |
| S1f | `packages/client/src/pages/ProfilePage.tsx` | 363-368 | Six address-related useState declarations with never-called setters |
| S1g | `packages/client/src/components/inventory/ConsumptionLogger.tsx` | 159, 180 | `handleStartEdit` and `handleDelete` useCallback blocks |

**S2. Mise-en-place feature chain (entire dead feature)**
- Files to delete (all safe to batch):
  - `packages/client/src/components/menu/MiseEnPlaceSheet.tsx` (size **S**)
  - `packages/client/src/hooks/useMiseEnPlace.ts` (size **S**)
  - `packages/server/src/services/misePlaceService.ts` (size **S**)
  - Route at `packages/server/src/routes/menuIntelligence.ts` line 77 (size **S**)
  - Import + handler in `packages/server/src/controllers/menuIntelligenceController.ts` lines 34, 300 (size **S**)

**S3. Unused shared package exports**
- All safe to batch, all size **S**

| # | File | Lines | What to remove |
|---|------|-------|----------------|
| S3a | `packages/shared/src/types/index.ts` | 3-30 | MessageRole, MessageSchema, Message, ChatRequestSchema, ChatRequest, ChatResponseSchema, ChatResponse (keep HealthResponse) |
| S3b | `packages/shared/src/utils/index.ts` | 1-6 | `generateId()` function |
| S3c | `packages/shared/src/constants/inventory.ts` | 132-138 | SESSION_TYPES and SessionTypeKey |
| S3d | `packages/shared/src/constants/inventory.ts` | 216-222 | FORECAST_STATUS and ForecastStatusKey |

**S4. prepMath tested-only exports (no production callers)**
- File: `packages/server/src/services/prepMath.ts`
- Lines: 27, 34, 146
- `DEFAULT_PREP_BUFFER`, `attachRateFor`, `scaledLineQuantity` -- test-only. Document or delete.
- Size: **S**
- Batch: safe to batch independently

---

### CLEANUP

**CL1. Duplicate PrepTask/PrepSession interfaces**
- Files: `packages/client/src/components/copilot/PrepDashboard.tsx` lines 25-63, `packages/client/src/pages/KitchenCopilotPage.tsx` lines 45-83
- Problem: Identical interfaces duplicated. Changes to one require manual sync.
- Fix: Extract to `packages/shared/src/types/prep.ts` and import from both.
- Size: **M**
- Sequencing: do AFTER B13 (which adds missing fields)

**CL2. Duplicate calcLineCost logic (client vs server)**
- Files: `packages/client/src/components/menu/MenuItemFormModal.tsx` lines 123-143 vs `packages/server/src/services/menuIntelligenceService.ts` lines 150-187
- Problem: Same formula maintained in two places.
- Fix: Extract to `@culinaire/shared`.
- Size: **M**
- Batch: safe to batch independently

**CL3. getIngredientCrossUsage accepts optional userId -- unsafe API shape**
- File: `packages/server/src/services/prepService.ts`
- Line: 939
- Problem: `userId?: number` allows callers to bypass ownership check.
- Fix: Change to `userId: number` (required).
- Size: **S**
- Batch: safe to batch independently

---

### INCONSISTENT (non-breaking but should align)

**I1. Missing FK indexes on prep/cross-usage tables**
- All safe to batch with B5-B8, all size **S**

| # | File | Lines | Index to add |
|---|------|-------|--------------|
| I1a | `packages/server/src/db/schema.ts` | 956-957 | `idx_prep_task_menu_item` on prepTask.menuItemId, `idx_prep_task_recipe` on prepTask.recipeId |
| I1b | `packages/server/src/db/schema.ts` | 1028-1029 | Indexes on prepMenuSelection.recipeId and .menuItemId (add index builder) |
| I1c | `packages/server/src/db/schema.ts` | 1046 | `idx_cross_usage_ingredient` on ingredientCrossUsage.ingredientId (add index builder) |
| I1d | `packages/server/src/db/schema.ts` | 1877 | `idx_transfer_line_fifo_batch` on inventoryTransferLine.fifoBatchId |

**I2. wasteService/prepService toRow mappers omit storeLocationId and organisationId**
- Files: `packages/server/src/services/wasteService.ts` lines 37-50/548-561, `packages/server/src/services/prepService.ts` lines 35-48/1175-1190
- Fix: Add the fields to the Row interfaces and map them.
- Size: **M** (touches interfaces + mappers + tests)
- Batch: safe to batch independently

**I3. prepService toTaskRow omits prepComponentId and userId**
- File: `packages/server/src/services/prepService.ts`
- Lines: 50-72, 1192-1216
- Fix: Add both fields to PrepTaskRow and toTaskRow.
- Size: **S**
- Batch: safe to batch with I2

**I4. IngredientCatalog list vs edit modal shows different cost values**
- File: `packages/client/src/components/inventory/IngredientCatalog.tsx`
- Lines: 308, 322-324
- Problem: List shows per-unit cost, edit modal shows pack cost. No label explains the difference.
- Fix: Clarify column header to "Cost/unit" or show pack cost consistently.
- Size: **S**
- Sequencing: do AFTER C1

**I5. Inconsistent ownership/lifecycle checks across prep mutators**
- File: `packages/server/src/services/prepService.ts`
- Lines: 787, 373, 448, 866
- Problem: Each function checks a different subset of {ownership, isEndedInd}.
- Fix: Extract `assertSessionWritable(sessionId, userId)` helper doing both checks.
- Size: **M**
- Sequencing: do AS PART OF B9

---

## EXECUTION ORDER

**Phase 1 -- Critical + blocking bugs (do first):**
C1 -> B19 (sequenced)

**Phase 2 -- Independent bugs (batch in parallel):**
B1, B2, B3, B4, B14, B15, B16, B18

**Phase 3 -- Schema indexes (single migration, one batch):**
B5, B6, B7, B8, I1a, I1b, I1c, I1d

**Phase 4 -- Prep lifecycle guards (sequenced):**
B9 + B17 + I5 -> B10 -> B11

**Phase 5 -- Client type fixes (batch):**
B12, B13

**Phase 6 -- Dead code cleanup (batch):**
S1a-g, S2, S3a-d, S4

**Phase 7 -- Structural cleanup (batch):**
CL1 (after B13), CL2, CL3, I2, I3, I4 (after C1)
