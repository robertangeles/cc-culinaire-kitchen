Now I have enough grounding in the actual code. Here is the synthesis report.

# Mise en Place Prep Planner: Code Audit vs Industry Reality Synthesis

---

## What We Built vs What Kitchens Need

| Feature | Our Implementation | Industry Reality | Verdict |
|---|---|---|---|
| **Forecast formula** | `covers x attach_rate x menu_mix x buffer` in `prepMath.ts:93`. Math is algebraically sound, tested, O(N). | Chefs use `par_level - on_hand = prep_needed`. Par levels vary by day of week (weekday vs weekend). Forecasting off covers is valid for fine dining but misses the par-based mental model most kitchens use. | **PARTIAL** -- math is correct but the model skips on-hand inventory and day-of-week par differentiation, which is how 90% of kitchens actually think about prep quantities. |
| **Station assignment** | `prepMath.ts:118-135` maps catalog categories to stations (proteins->Grill, produce->Garde Manger, etc.). Recipe-path ingredients all land at "Other" (`prepService.ts:560-578`). | Station-based lists are the industry standard. ChefTalk: "I do prep lists by station. Each station should have its own prep list." Every prep app (FusionPrep, Opsi, Chefs Resources) uses station filtering. | **PARTIAL** -- the mapping exists and is sensible for catalog items, but recipe-only users (a large segment) get everything dumped into "Other", making station assignment useless for them. |
| **Priority tiering** | Three tiers: start_first, then_these, can_wait. Scored by cross-usage, prep time, and classification weight. | "Start with items requiring the longest preparation times" (Toast, ProChef). Stocks and braises go on at 7am; brunoise at 3pm. Priority is lead-time driven, not cross-usage driven. | **PARTIAL** -- tiering exists and is reasonable, but the scoring weights cross-usage (how many dishes share an ingredient) over lead time (how long it takes to prep). A 6-hour stock that appears in only one dish would score lower than a 5-minute dice that appears in 4 dishes. Real kitchens would reverse this. |
| **Prep list columns** | ingredientName, quantityNeeded, unit, station, prepTime, assignedTo, status. | Industry standard columns: ingredient, amount on hand, par (slow day), par (busy day), amount to prep, shelf life, portioning utensil, comments, cook initials. (ChefTalk 8-column layout; WebstaurantStore 5-column layout) | **GAP** -- we are missing on-hand quantity, par levels, shelf life per item, and portioning instructions. We show what to prep but not why that quantity (no par minus on-hand breakdown visible). |
| **Check-off interaction** | Click checkbox to toggle completed/pending. Skipped tasks have explicit "Undo" button. Completed tasks toggle on re-click but no "Undo" label. | "Glance, check mark, move on -- under 2 seconds per item" (paper benchmark). FusionPrep: tap item, see prep amount, tap complete. One tap. | **PARTIAL** -- functional but the discoverability gap between skip-undo and complete-undo is a UX inconsistency. The core interaction speed is acceptable for a web app on a tablet. |
| **Assign staff to tasks** | Inline text input with Save/Cancel, keyboard support (Enter/Escape). `PrepDashboard.tsx:178-207`. | Sous chef assigns stations, not individual tasks. "The kitchen manager or chef creates the prep lists... the employee running that station does the math" (ChefTalk). Assignment is per-station, not per-ingredient. | **OVER-BUILT** -- per-task assignment is more granular than kitchens actually use. Station assignment (already present) is closer to reality. Per-task naming adds friction without matching the brigade workflow. |
| **Sub-recipes / prep components** | `prep_component` table exists in schema (`schema.ts:1051-1114`). Forward-ready columns on `prep_task` (prepComponentId, useBy, isOverPrepInd) but never populated by `generateTasksFromSelections`. | "Sub-recipes and prep recipes (sauces, stocks, doughs) must be first-class citizens, not afterthoughts" (industry consensus). CrunchTime forecasts sub-recipes 15 levels deep. Parsley handles them natively. | **GAP** -- schema is ready but the feature is not wired. Sauces, stocks, and doughs that feed into multiple dishes are exactly what prep planning exists for, and we cannot plan them yet. |
| **Recipe scaling** | `prepMath.ts:146-157` scales by `quantity * (portions / servings) / (yieldPct / 100)`. Tested, safe. | "Recipe scaling with automatic unit conversions is non-negotiable -- every tool must do this" (industry table stakes). Meez, Galley, and Parsley all treat this as core. | **ALIGNED** -- the scaling formula is correct, handles servings > 1 and yield loss. This matches industry expectations. |
| **Ingredient merging** | `prepMath.ts:202-246` merges by catalog ID when available, by lowercased name when free-text. Same ingredient in different units stays separate (intentional). | Standard practice: aggregate all uses of the same ingredient across all dishes into one prep line. "Dice 5 lbs onions" not "dice 2 lbs for soup + 3 lbs for sauce." | **ALIGNED** -- the merging logic is correct and matches how a sous chef would consolidate a prep list. The unit-split behavior is a reasonable design choice. |
| **Forecast suggest UX** | Replaces all existing selections with suggested set. No confirmation, no undo. `PrepMenuSelector.tsx:217-229`. | Chefs manually tune quantities based on years of experience. A tool that overwrites their judgment without confirmation would be rejected. | **WRONG** -- the destructive overwrite with no undo is hostile to experienced chefs who have already fine-tuned their selections. This is a trust-destroying interaction. |
| **Menu items only (no recipes)** | Forecast only works for menu items. Recipe-only users never see the forecast panel (`PrepMenuSelector.tsx:400`). Clicking suggest silently switches to menu view. | Many kitchens, especially new ones or ones doing R&D, work recipe-first. Meez and Parsley both plan from recipes. | **GAP** -- recipe-only users get zero forecasting support. The feature is invisible to them with no explanation. |
| **Offline capability** | No offline support. All interactions require server round-trips. | "Offline-first is not optional. The app must cache the day's prep list locally" (mobile UX research). Kitchen wifi is notoriously spotty. SkyTab, Toast KDS, and FusionPrep all support offline. | **GAP** -- complete absence. A prep list that goes blank when wifi drops mid-service is unusable in a real kitchen. |
| **Print/export** | Not implemented. | "Printing and exporting kitchen-friendly prep sheets is still essential -- digital-only does not work on a busy line" (industry consensus). Apicbase users specifically complain about missing exportable prep overviews. | **GAP** -- no print view. Paper persists because it survives grease, water, and heat. A tool that cannot produce a printable station prep sheet loses a fundamental use case. |
| **Day-of-week par differentiation** | Not implemented. Single covers input. | ChefTalk 8-column layout includes separate par columns for slow days (Sun-Thu) and busy days (Fri-Sat). WebstaurantStore: "If you normally sell 25 porterhouse steaks on a Friday night service, the par level for that shift should be 25." | **GAP** -- we treat every day the same. A Friday prep list should look fundamentally different from a Tuesday prep list. |
| **On-hand inventory integration** | Not implemented. Prep quantities are calculated from covers forecast alone. | "Par Level - On Hand = Amount to Prep" is THE formula every kitchen uses (FoodDocs, WebstaurantStore, ChefTalk, Chefs Resources). | **WRONG** -- we calculate what the kitchen should have, not what they need to prep. Without subtracting what is already in the walk-in, every suggestion is inflated. This is the single biggest conceptual gap. |
| **Session lifecycle** | Create session -> select dishes -> generate tasks -> check off -> end session. | Two-phase: closing shift reviews tomorrow + morning walkthrough adjusts. Prep list updates throughout the day as deliveries arrive and 86s happen. | **PARTIAL** -- single-session-per-day model is reasonable but the lack of mid-day adjustment (re-running with updated on-hand after a delivery) limits real-world utility. |
| **Waste feedback loop** | Waste alert banner shows top waste items from the month. `PrepDashboard.tsx:273-287`. | "Experienced operators track which items get 86'd frequently and adjust par levels accordingly" (industry research). The feedback should reduce future prep, not just warn. | **PARTIAL** -- the alert is informative but does not actually adjust suggested quantities. A real feedback loop would reduce par/forecast for chronically over-prepped items. |

---

## Top 5 Things We Got Right

### 1. Core Forecast Math Is Sound
`prepMath.ts:93` implements `covers * attach_rate * menu_mix * buffer` correctly. The test suite at `prepMath.test.ts` has 21 cases covering empty inputs, zero covers, historical vs estimated mix, rounding, cross-category invariants, and yield scaling. The category-sum invariant (all items in a category sum to `covers * attach`) is explicitly verified. This is production-grade math that a sous chef can trust.

### 2. Ingredient Merging Works Like a Real Prep List
`prepMath.ts:202-246` correctly aggregates the same ingredient across multiple dishes into a single prep line, deduplicates contributing dish names, and keeps different units separate. This matches how a sous chef would consolidate -- "dice 5 lbs total onions" rather than listing onion work per dish. The test coverage confirms ID-keyed merge, name-keyed merge for free-text, and unit-split behavior.

### 3. Transaction Atomicity for Task Generation
`prepService.ts:599-650` wraps the entire generate flow (delete old tasks, delete old cross-usage, insert new tasks, insert cross-usage, update session counters) in a single `db.transaction`. A mid-write failure rolls back cleanly. This is exactly right -- a half-generated prep list would be worse than no prep list. Industry tools like CrunchTime and MarginEdge have been criticized for data corruption bugs; we avoid that class of problem.

### 4. Station Mapping Is Sensible for Catalog Items
`prepMath.ts:118-135` maps ingredient categories to kitchen stations in a way that matches the brigade system: proteins to Grill/Protein, produce to Garde Manger, dairy to Cold, bakery to Pastry. The ChefTalk forum consensus is that prep lists should be organized by station, and our mapping aligns with how a professional kitchen would divide work. The station badge renders correctly on the dashboard.

### 5. Authentication and Input Validation Are Thorough
Every prep route requires authentication middleware (`prep.ts:30`). Every controller handler validates input with Zod schemas (`prepController.ts:31-72`). Session ownership is verified on generate (`prepService.ts:437-445`), task updates (`prepService.ts:799`), and selections (`prepService.ts:415-416`). The defense-in-depth pattern (middleware + per-handler check) is correct. Covers are bounded 1-100,000, buffer 1-3. This meets OWASP A01 standards for most endpoints.

---

## Top 5 Gaps That Would Make a Chef Abandon This

### 1. No On-Hand Inventory Subtraction (Back to Paper Immediately)
**Severity: Critical -- this breaks the fundamental value proposition.**

Every kitchen in the world uses `Par - On Hand = Prep Amount`. Our tool calculates what the kitchen should have (forecast) but never subtracts what is already prepped, carried over, or sitting in the walk-in. A chef who prepped 20 portions of hollandaise yesterday and has 8 left over does not want to be told to make 20 again. Without this subtraction, every suggestion is wrong by the amount of existing inventory. The chef will do the math on paper anyway, which means our tool adds a step rather than removing one. This is why they will go back to a clipboard and a Sharpie.

### 2. No Print/Export for Station Prep Sheets
**Severity: High -- loses the brigade system entirely.**

Research is unequivocal: "Printing and exporting kitchen-friendly prep sheets is still essential." Chefs use laminated templates with dry-erase markers. Station prep sheets go on clipboards at each station. Our tool has no print view, no export, no PDF generation. A garde manger cook cannot take a tablet into the walk-in to check what they need -- they need a printed list in their hand. Without this, the tool is useful only for the sous chef at a desk, not for the cooks who actually do the prep.

### 3. Recipe-Only Users Are Invisible
**Severity: High -- excludes a major user segment.**

The forecast panel only renders when `menuData.hasMenuItems` is true (`PrepMenuSelector.tsx:400`). Recipe-only users -- new restaurants without POS data, R&D kitchens, catering operations -- never see forecasting, never get suggestions, and get every task assigned to station "Other" (`prepService.ts:560-578`). The research shows Meez and Parsley both serve recipe-first kitchens. We built exclusively for the Menu Intelligence path and left everyone else with a feature that is half-visible and half-functional.

### 4. No Day-of-Week Par Differentiation
**Severity: High -- makes the tool useless for weekly planning.**

The ChefTalk 8-column layout includes separate par columns for slow days and busy days. A steakhouse that sells 25 porterhouse on Friday and 8 on Tuesday needs different prep quantities. Our single covers input treats every day identically. A sous chef doing Monday prep will get Friday-sized suggestions (or vice versa) unless they manually remember to change the covers input. This is exactly the kind of mental overhead a digital tool should eliminate, and we do not.

### 5. No Offline Support
**Severity: High -- fails in the environment where it is used.**

Kitchen wifi is notoriously unreliable. Research confirms: "Offline-first is not optional." Toast KDS, SkyTab POS, and FusionPrep all support offline operation. Our entire prep workflow requires server round-trips for every interaction -- loading the session, checking off tasks, assigning staff. When wifi drops during morning prep (the most common time), the chef loses access to their entire prep list. Paper does not have this failure mode.

---

## Top 5 Bugs or Wrong Assumptions Found

### 1. Stale Closure Bug: `handleSuggest` Missing `bufferPct` Dependency
**File:** `PrepMenuSelector.tsx:235`
**Bug:** `useCallback` dependency array is `[forecastCovers]` but the callback reads `bufferPct` at line 199. If a chef types covers first, then changes the buffer percentage, then clicks "Suggest portions," the API call sends the stale buffer value from when covers was last set. The chef sees 30% on screen but the request uses 25%.
**Fix:** Add `bufferPct` to the dependency array. Effort: S.

### 2. Broken Access Control: `getIngredientCrossUsage` Lacks Session Ownership Check
**File:** `prepService.ts:865-866`
**Bug:** In the non-teamView path, the function filters by `sessionId` alone without verifying the session belongs to the requesting user. Any authenticated user who knows or guesses a session UUID can read another user's cross-usage data. This is OWASP A01 (Broken Access Control). Compare with `getPrepSession` (line 758-760) and `getSelections` (line 415-416) which both enforce ownership.
**Fix:** Add `eq(prepSession.userId, userId)` join to the non-teamView query. Effort: S.

### 3. Session-Ended Guard Uses Wrong Field
**File:** `PrepDashboard.tsx:250`
**Bug:** The "session complete" screen checks `session?.actualCovers != null`, but "End without logging" sets `isEndedInd=true` without setting `actualCovers`. Additionally, `toSessionRow` (`prepService.ts:1064-1078`) never exposes `isEndedInd` to the frontend. Result: the "session complete" UI is unreachable via the "End without logging" path. It works by accident because `onSessionUpdate(null)` clears the session, but the guard logic is semantically wrong and would break on page refresh or direct session fetch.
**Fix:** Expose `isEndedInd` in `toSessionRow` and check it in the dashboard guard. Effort: S.

### 4. Stale `completedAt` on Undo (completed -> pending)
**File:** `prepService.ts:788-794`
**Bug:** Setting status to "completed" writes `completedAt = new Date()`. Toggling back to "pending" updates `status` and `updatedDttm` but never clears `completedAt` to null. A task that was completed at 10:15am, unchecked at 10:20am, and re-completed at 11:00am retains the 10:15am timestamp. Any analytics, reporting, or historical views consuming `completedAt` will show incorrect completion times.
**Fix:** Add `if (status !== 'completed') updateValues.completedAt = null;`. Effort: S.

### 5. `saveMenuSelections` Not Wrapped in Transaction
**File:** `prepService.ts:369-388`
**Bug:** The function does DELETE (clear old selections) then INSERT (write new selections) without a transaction. If the INSERT fails after the DELETE succeeds, the chef's selections are silently wiped with no recovery. Compare with `generateTasksFromSelections` (line 599) which correctly uses `db.transaction`.
**Fix:** Wrap the delete+insert in `db.transaction`. Effort: S.

---

## Recommendations (Prioritized)

### P0 -- Fix Before Any Chef Sees This

| # | What | Effort | Impact |
|---|---|---|---|
| 1 | **Fix stale closure bug** -- add `bufferPct` to `handleSuggest` dependency array (`PrepMenuSelector.tsx:235`) | S | Prevents silent wrong forecasts. Trust-critical. |
| 2 | **Fix broken access control** -- add userId ownership check to `getIngredientCrossUsage` non-teamView path (`prepService.ts:865`) | S | OWASP A01 vulnerability. Security-critical. |
| 3 | **Fix session-ended guard** -- expose `isEndedInd` in `toSessionRow`, use it in `PrepDashboard.tsx:250` | S | Prevents unreachable UI state. Correctness-critical. |
| 4 | **Fix stale completedAt** -- clear to null when status transitions away from "completed" (`prepService.ts:794`) | S | Prevents incorrect analytics data. Data integrity. |
| 5 | **Wrap saveMenuSelections in transaction** (`prepService.ts:369-388`) | S | Prevents silent data loss on partial failure. |
| 6 | **Add missing FK indexes** on `prep_session` (userId, organisationId, storeLocationId), `prep_menu_selection` (prepSessionId, recipeId, menuItemId), `ingredient_cross_usage` (userId, prepSessionId, ingredientId) | S | Query performance on every page load and ownership check. |
| 7 | **Add ON DELETE rules** for `prep_task.menuItemId`, `prep_menu_selection.menuItemId`, and `prep_menu_selection.prepSessionId` per commit 0a687e3 lesson | S | Prevents FK violation errors when archiving menu items or deleting sessions. |

### P1 -- Required for Chef Adoption

| # | What | Effort | Impact |
|---|---|---|---|
| 8 | **Add on-hand inventory subtraction** -- integrate Stock Room quantities so suggestions become `forecast - on_hand`. Display the breakdown per item. | L | Transforms the tool from "tells me what I should have" to "tells me what I need to do." This is the #1 reason a chef would use or abandon the tool. |
| 9 | **Add print/export** -- generate a station-grouped, printable prep sheet (PDF or clean HTML print view) that a cook can clip to their station. | M | Bridges digital and physical workflow. Removes the "but I need paper on the line" objection. |
| 10 | **Add confirmation/merge for forecast suggest** -- instead of replacing all selections, show a diff ("Add 5 items, change 3 quantities, keep 7 unchanged") with Accept/Reject per item. | M | Respects chef expertise. Prevents loss of manual fine-tuning. Builds trust. |
| 11 | **Support recipe-path station assignment** -- when a recipe ingredient matches a catalog ingredient by name, inherit the catalog category for station mapping. Fallback: let the chef tag recipe ingredients by station. | M | Makes station assignment useful for recipe-only users. Currently half the user base gets "Other" on everything. |

### P2 -- Competitive Differentiation

| # | What | Effort | Impact |
|---|---|---|---|
| 12 | **Day-of-week par profiles** -- let chefs set different expected covers or par levels for each day of the week. Auto-suggest the right profile based on today's day. | M | Matches the ChefTalk 8-column standard. Eliminates "is this a Friday prep or a Tuesday prep?" confusion. |
| 13 | **Wire up prep components** -- connect the existing `prep_component` schema to `generateTasksFromSelections` so sauces, stocks, and doughs appear as hierarchical tasks with shelf life and use-by dates. | L | Sub-recipes are what make prep planning valuable. CrunchTime does this 15 levels deep. We have the schema but no execution. |
| 14 | **Offline-first prep list** -- cache today's session, tasks, and recipes in IndexedDB/localStorage. Allow check-off and assignment offline, sync on reconnect. | L | Removes the wifi-dependency failure mode. Matches Toast KDS and FusionPrep baseline expectations. |
| 15 | **Remove dead code** -- delete `MiseEnPlaceSheet.tsx`, `useMiseEnPlace.ts`, and evaluate orphaning the live-but-unreachable `/api/menu/mise-en-place` endpoint and `misePlaceService.ts`. | S | Reduces confusion and maintenance surface. These are confirmed dead by grep. |
| 16 | **New-item handling in forecast** -- items with zero sales history in a category with other sales should suggest at least 1 portion (or show a "New -- no sales data" indicator) instead of silently disappearing from the selection. | S | Prevents the "where did my new dish go?" confusion when a chef adds a new menu item. |
| 17 | **Fix formula explainer** -- change "x 25% buffer" to "+ 25% buffer" or "x 1.25" at `PrepMenuSelector.tsx:474`. | S | Prevents eroded trust from a mathematically misleading explanation. |

### P3 -- Future Considerations

| # | What | Effort | Impact |
|---|---|---|---|
| 18 | **Waste-to-forecast feedback loop** -- automatically reduce suggested quantities for ingredients with chronic over-prep patterns detected in waste logs. | L | Closes the loop from waste data to prep planning. Currently informational only. |
| 19 | **Shelf life visibility per task** -- show remaining shelf life on each prep task, color-coded (green > 2 days, amber 1-2 days, red < 1 day). Enable FIFO enforcement. | M | Matches ChefTalk column 6 (shelf life). Reduces waste from forgotten prep. |
| 20 | **Preserve selections on "Edit selections" navigation** -- when `PrepDashboard` sends the user back to `PrepMenuSelector`, reload existing selections from the server instead of starting with an empty Map. | S | Prevents loss of work when a chef wants to tweak one dish. Currently forces full re-entry. |

---

### The Bottom Line

The core math engine is solid -- `prepMath.ts` is well-tested, algebraically correct, and performant. The transaction safety on task generation is production-grade. Authentication and validation are thorough (with one OWASP A01 exception in cross-usage).

But the product is built around a **forecast-from-covers model** when the industry runs on a **par-minus-on-hand model**. That is not a bug -- it is a conceptual misalignment. Every kitchen in the world subtracts what they have from what they need. We calculate what they need and stop there, leaving the subtraction to the chef's head. Until on-hand integration exists, this is a forecasting calculator, not a prep planning tool.

The 7 P0 items are all small fixes (hours, not days). The 4 P1 items are what separate "interesting prototype" from "tool a sous chef would actually open at 6am." The competitive landscape (Meez at $30K COGS savings, CrunchTime at 100K+ locations, Parsley at event-driven prep lists) shows that the market rewards tools that eliminate manual math and bridge digital-to-physical workflow. We have the foundation. The gap is narrower than it looks -- but it is the gap between "shows up on a screen" and "goes on a clipboard at the garde manger station."
