# UAT Checklist — Kitchen-Unit Model + Recipe-Based Selling

## ▶ RESUME HERE — 2026-08-02 (ARCHOS)

> **⚠️ UAT IS INCOMPLETE AND IS PRIORITY #1.** Nothing on this branch merges to `main`
> until the rows below are walked. Do not start new feature work ahead of finishing this.

**Signed off:** A (catalog) ✅ · B + B3 (stock take, HQ review — shipped to prod, merge `5e19857`) ✅ · I (storage areas) ✅
**Partly walked:** **C** — C1–C4 ✅ (PO packaging + receive) · C9–C15 ✅ (order-to-par core flow)
**Still to walk:** C5–C8 (guide setup) · C16–C32 (regressions, permissions, PO email, UI fixes) · **D** (recipes) · E · F · G · H

**Purchasing → Receive is now fully walked in a real browser and is clear to use.**
Both HEPHAESTUS open items are closed, and two further bugs surfaced during the walk
were fixed. Resume at **C5–C8**, then C16+, then Section D.

**A delivery is waiting for you: `PO-MSB3C4KL`** (PFD Food Services, $106, 2 lines —
Plain Flour 4 bag @ $17.50, Chicken 3 kg @ $12.00) at Almost French Patisserie.

**Closed on 2026-08-02 (ARCHOS):**

1. ~~Advisory-lock fix (2c below) only mocked-DB tested~~ → **verified under real
   concurrency.** Two simultaneous `startSession` calls against the real dev DB returned
   the *same* session; no second row was created.
2. ~~`PO-MRUH46AZ` may have an orphaned ACTIVE session~~ → **it did**, and it was the cause
   of *"A receiving session is already in progress for this PO"*. Root cause: `cancelSession`
   resets the PO to `SENT` unconditionally, so when the pre-lock race made two sessions,
   cancelling one left the PO `SENT` with its sibling still `ACTIVE` — a state
   `startSession` had no path out of, because its resume branch only handled
   `status === "RECEIVING"`. It now looks the ACTIVE session up *before* branching on PO
   status, so either direction of disagreement resumes and repairs the status.
   `PO-MRUH46AZ` is now `RECEIVED` and clean.
3. **`confirmReceipt` 500'd on every receipt** (*"Internal server error"*). `wacService.recompute`
   interpolated a JS `Date` into a raw ``sql`` `` template; raw SQL carries no column type
   info, so the driver called `Buffer.byteLength()` on it and threw `ERR_INVALID_ARG_TYPE`.
   Now bound as `${nowIso}::timestamptz`, matching the existing convention in
   `ingredientService`. Guarded by `wacService.test.ts`.
4. **Stale Receive queue + tab badge.** Neither refetched after a receipt, so a confirmed
   delivery lingered in the list and the badge kept counting it until a page reload.
   `ReceiveQueue` now refreshes on exit and notifies `PurchasingPage` (which holds its own
   `usePurchaseOrders` instance) via `onChanged`. The badge also counted only `SENT` while
   the queue lists `SENT` *and* `RECEIVING`; both now agree.

**Receipt history (new, 2026-08-02).** Chefs check a past delivery at **Purchasing → Orders →
"Received" → expand the PO**. That view now leads with "Received by {name} | {date, time}" and
its Cost column shows `$17.50 → $21.00` (red up / green down) whenever the price paid at the door
differed from the ordered price — both were already in the database but neither was surfaced.
Worth a look while walking C. **Still not reachable from history:** *why* a line was short or
rejected (rejection reason/note/photos live on the receiving session, which has no UI path once
confirmed), and credit notes (routes exist, no client UI). Both flagged for after UAT.

**Verified end to end in the browser on 2026-08-02** (Purchasing → Receive → open →
mark Short → Confirm): session resumed correctly across a full page reload with the Short
action persisted, confirm returned 200, stock/WAC/FIFO all moved correctly
(Plain Flour 166.8 → 216.8 kg; Chicken 15 → 17 kg @ WAC 12.0000; PO → `PARTIAL_RECEIVED`),
and the queue and badge both cleared without a reload.

**Historical — what HEPHAESTUS did on 2026-08-01** (full detail in `wiki/log.md`):

1. Seeded par/reorder/stock across the full 115-item catalog at both Almost French locations
   (`scripts/seedCatalogParStock.ts`, idempotent, doesn't touch the hand-built fixture stock
   below). Note: `reorder_qty` was retired from ordering on 2026-07-24 (see C3) — the script
   still writes it for completeness, but it's a dormant column now; only `par` and on-hand
   stock actually drive order-to-par.
2. Fixed three compounding bugs in `receivingService.startSession()`: (a) fresh sessions
   showed every line as "Unknown item" — no ingredient join on that path, (b) a PO left
   mid-receive had **no way back in** (fixed by resuming the existing session instead of
   rejecting), (c) **the actual root cause of (b)**: two concurrent `startSession` calls for
   the same PO could both pass the checks before either committed — fixed with a
   transaction-scoped `pg_advisory_xact_lock(hashtext(poId))`.
3. Reworked the Receiving checklist UI (user request): the 4 action pills are now
   always-visible on the right of each line instead of tap-to-expand, and each line shows
   cost/UOM/stock/par/total cost inline.

### Getting running on ARCHOS

```bash
git checkout feature/ck-web/purchasing-order-guides-p1
git pull                                # HEAD should be past 8910e60 (this resume commit)
pnpm install
pnpm --filter @culinaire/shared build   # ← REQUIRED: server/client import from dist/
pnpm dev                                # backend 3009, frontend 5179
```

The `shared build` step is not optional — the recipe resolver lives in `@culinaire/shared`
and the server resolves it from `dist/`. Skip it and you get *"resolveQtyToKitchen is not a
function"* at runtime even though `tsc` passes.

**Dev DB is remote and shared** (`dpg-d9cqp5…render.com` / `culinaire_kitchen_postgresdb_oqph`).
If ARCHOS's `DEV_DATABASE_URL` names that same host, all fixture data below (and today's
catalog seed) is already there — nothing to re-seed. If it points elsewhere, the two dev-only
columns (`ingredient.density_g_per_ml`, `menu_item.servings_per_sale`), the seeded costs, and
today's par/reorder/stock seed all need to be applied first.

### Branch state (2026-08-01)
`feature/ck-web/purchasing-order-guides-p1` is well ahead of `main`, all pushed, **nothing
merged**. Notable recent commits: `0c9aaac` supplier minimum-order editor · `3c24822` retired
`reorder_qty` from ordering (pure order-to-par) · today's (HEPHAESTUS): catalog seed script,
and the receiving session fixes + checklist UI rework described above.
Prod still needs `density_g_per_ml` + `servings_per_sale` at deploy (the three PO columns
are already applied there).

---

Manual acceptance test for `feature/ck-web/uom-and-recipe-selling`. The automated suite
(576 server + 31 real-DB E2E + 66 client tests, plus 85 shared-package tests covering the
unit resolver + density library) covers the logic; this is the human click-through.
Mark each row **Pass** / **Fail**.

**The model under test (your words):** every item has ONE kitchen unit it's counted in
(wine = bottle, flour = g, napkins = each). Packaging (case, bag) exists only at ordering +
receiving and converts at the moment of receiving. Recipes may pour in mL against a
bottle-counted item (1 bottle = 750 mL). FOH consumables sell directly — no recipe math.
**mL should appear NOWHERE except recipe lines.**

- **Ports:** backend `3009`, frontend `5179`.
- **Account:** **Rob Angeles - CulinAIre** (org *Almost French Pâtisserie*). Log out/in first.
- **Location:** **Almost French Patisserie** (Ctrl+L).

## Fixture (already seeded — say "re-seed UAT" to reset)

Verified against the dev DB on 2026-07-23. **Note:** the flour rows below were corrected —
Baker's Flour is counted in **kg** (not g) and comes in a **12.5 kg** bag (not 25 kg).

| Item | Type | Kitchen unit | Contains | Purchased as | Cost |
|---|---|---|---|---|---|
| Belicard Blanc Chardonnay | FOH Consumable | **bottle** | 750 mL | case of 12 | $15.00/bottle |
| Sancerre (+ 15 other wines) | FOH Consumable | **bottle** | 750 mL | by the bottle | — |
| Baker's Flour (T55) | Ingredient | **kg** | — | bag of 12.5 kg | $3.04/kg |
| Plain Flour | Ingredient | **kg** | — | bag of 12.5 kg | $1.40/kg |
| Butter | Ingredient | **kg** | — | — | $11.00/kg |
| Eggs | Ingredient | **each** | — | — | $0.52/each |
| Full Cream Milk | Ingredient | **l** | — | — | $1.65/L · **density 1.03** |
| Napkins (cocktail) | Op Supply | **each** | — | case of 500 | $0.03/each |
| San Pellegrino (can) | FOH Consumable | **each** | — | case of 24 | $1.20/each |

**Catalog-wide (seeded 2026-07-23):** 115 active ingredients, **0 uncosted** — costs are
AUD foodservice estimates researched per kitchen unit, so every recipe line can price.
**17 liquids carry a density** (milks 1.02–1.03, cream 1.01, condensed 1.29, juices 1.045,
ice creams 0.55) enabling weighed liquid lines. New for the brioche walk: **Instant Dry
Yeast** ($12.50/kg), **Vanilla Extract** ($180/L, density 1.05), **Sesame Seeds** ($7.50/kg).

**Custom unit conversions on file:** `Eggs g → 0.02 each` (1 large egg = 50 g shelled) ·
`Sancerre each → 750`. These drive UAT **D6**.

**Menu items:**

| Item | Price | Servings (yield) | Price covers | Food cost % |
|---|---|---|---|---|
| Glass — Belicard | $12 | 1 | 1 | 25.0% |
| Bottle — Belicard | $55 | 1 | 1 | 27.3% |
| Kir Royale | $18 | 1 | 1 | 11.1% (100 mL + a free-text line) |
| **Brioche Buns (12 × 75 g)** | $15 | **12** | **12** (pack pricing) | **46.7%** |

The Brioche is the Section D worked example: 10 ingredient lines all entered in grams,
batch $6.37 → $0.58/bun → $7.01 per 12-pack sale → $7.99 margin. Its milk and vanilla lines
resolve through the **density bridge**, its eggs line through a **custom conversion** — the
three mechanisms D6–D9 exercise.

---

## A. Catalog — items read in their kitchen unit

| # | Steps | Expected | Result |
|---|---|---|---|
| A1 | Inventory → Catalog → Belicard | UOM **bottle**, Stock **8** — no mL anywhere in the row | ✅ |
| A2 | Open Belicard's edit modal | **Counted in: bottle** · **bottle size: 1 bottle = 750 mL** · **Purchased as: case of 12 bottle @ cost** — plain chef language, no jargon | ✅ |
| A3 | "Stock across locations" panel in the modal | Patisserie shows **8 bottle** (not 6000 mL) | ✅ |
| A4 | Sancerre row (the item that started all this) | Stock ≈ **0.7 bottle** — the ⅔-open bottle, in bottles | ✅ |
| A5 | Flour row + edit modal | UOM **g**, stock 12500; the modal shows **no "size" row** for a grams-counted item (nothing to declare) and "Purchased as: bag of 25000 g" | ✅ |

## B. Stock take — count what you see

| # | Steps | Expected | Result |
|---|---|---|---|
| B1 | Start a stock take covering Belicard | Keypad counts in **bottle**; enter **6.5** (6 full + 1 half) | ✅ |
| B2 | Approve (HQ review) | Catalog stock = **6.5 bottles**; variance shown in bottles | ✅ |

## B3. Stock-take HQ review (PR #84 — verified 2026-07-19, browser QA on branch)

Rob = org admin, holds `inventory:hq`. Verified live at localhost:5179 against the merged branch.

| # | Steps | Expected | Result |
|---|---|---|---|
| B3.1 | Open Stock Take tab as an org-admin (has `inventory:hq`) | **Count / Review / History** sub-pills appear | ✅ |
| B3.2 | Open a session with a variance in Review/History | Dedicated **Variance** and **Variance Cost** columns; variance cost = WAC × qty (e.g. +8 × $15 = **+$120.00**), computed not stored | ✅ |
| B3.3 | Expected column on a first count | Shows venue **book on-hand** (e.g. 8.0), never "—" | ✅ |
| B3.4 | "By" column | One line: counter name **+ date** (e.g. "Rob Angeles · Jul 19, 12:37 PM") | ✅ |
| B3.5 | History sub-view | Approved sessions listed, **read-only** (no Approve/Flag), header "Approved by X · date" | ✅ |
| B3.6 | Non-HQ user (no `inventory:hq`) | Review/History pills hidden; `GET /stock-takes/history` → **403** | test-covered (route-gate + `useHasPermission`) |

## C. Purchasing — packaging exists only here

| # | Steps | Expected | Result |
|---|---|---|---|
| C1 | New PO → add Belicard | Unit defaults to **case (12 bottle)**; dropdown offers case / bottle; cost label reads **per case** | ✅ |
| C2 | Order **2 case @ $60**, submit, receive fully | Stock **+24 bottles**; line total $120 | ✅ |
| C3 | Auto-PO suggestions (set flour par above stock first) | Suggestion reads in **bags** (whole packages, rounded up) and is **pure order-to-par**: `ceil((par − on-hand) ÷ pack)`. `reorder_qty` was retired 2026-07-24 — it no longer overshoots par. Plain Flour par 25 kg, 0 on hand, 12.5 kg bag → **2 bags** (not 4). If you see 4, the retired reorder floor is back | ✅ |
| C4 | Receive a PO line via the legacy per-line receive with unit **case** | Stock rises by cases × 12 — never by the raw "2" (this was a live bug, now fixed) | ✅ |

### C-guides. Order guides + order-to-par (Purchasing P1, 2026-07-20)

Spec: [docs/specs/purchasing-order-guides.md](../specs/purchasing-order-guides.md).

**This section is the only proof this feature works.** The automated E2E
(`packages/client/tests/e2e/order-guides.spec.ts`) was written but has **never been executed** —
Turnstile verification is fail-closed with no dev bypass, so Playwright can't log in. The server
logic is covered by real-DB integration tests; the browser wiring is not. Treat a failure here as
a real bug, not a stale checklist.

**Do C5→C7 in order.** Order-to-par renders *nothing* until pars exist, so skipping setup makes
every later row pass vacuously — which looks like success and proves nothing.

#### Before you start

1. **Log in as Rob** (org admin — holds `inventory:manage` + `purchasing:draft`). Ports 3009 / 5179,
   location **Almost French Patisserie**.
2. **Belicard must have a supplier minimum**, or C13 has nothing to trigger.
   ⚠️ **There is no UI for this.** `ingredient_supplier.minimum_order_qty` is rendered everywhere
   but writable only via the API — no client component calls the write route. Set it with:
   ```bash
   # token: copy access_token from localStorage after logging in
   curl -X PATCH http://localhost:3009/api/inventory/ingredients/<belicardId>/suppliers/<supplierId> \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"minimumOrderQty":"2"}'
   ```
   *(Flagged as a gap — see "Known gaps" below.)*
3. Note Belicard's current on-hand before you start (fixture says **6.5 bottles** after section B).
   Every expected number below is derived from it.

#### Setup — pars, then a guide

| # | Steps | Expected | Result |
|---|---|---|---|
| C5 | Inventory → **Setup** → scroll to **Par Levels**. Filter "Belicard", set par **8**. Also set a par on one other item. Click **Save pars** | Counter reads "N of M set" and climbs. Button confirms "Saved 2 pars". Reload → both persist. Rows you didn't touch are never written (a full-catalogue save should only report the count you edited) | ☐ |
| C6 | Purchasing → **Guides** → type "Weekly Wine", pick the wine supplier, **Create guide** | Guide card appears with the supplier's name. Creating with a name but **no supplier** shows "Pick a supplier" and creates nothing | ☐ |
| C7 | Open the guide → **Add an item…** → add Belicard + 2 others. Reorder with ↑ / ↓ into your walk order. **Save items** | The order you set is the order that saves. Reload the page → same order. This is the shelf-to-sheet walk; if it resets to alphabetical or insertion order, that's a bug | ☐ |
| C8 | In the guide, remove one row, **Save items** | Row is gone after reload. The server replaces the set wholesale — check the *other* rows survived | ☐ |

#### The core flow — order to par

> **Read first (corrected 2026-07-24).** Belicard is **counted in bottles** but **bought by the case of 12**.
> Order-to-par computes the shortfall in the counting unit (bottles) and then prefills the qty field in the
> **purchase unit (cases)**, rounded up: `qty = ceil((par − on hand) ÷ 12)`. So a 1.5-bottle shortfall
> prefills as **1 case**, and the qty field's unit label reads **case**, while the line's par context still
> reads in bottles. This is the packaged-unit fix — if the field prefills "1.5" against a unit of "case",
> the bug is back. Watch item: the **supplier minimum** (C13) is compared against the qty field, which is in
> cases here — confirm the minimum is expressed in the same unit, not bottles.

| # | Steps | Expected | Result |
|---|---|---|---|
| C9 | Purchasing → Orders → **New Purchase Order** → click the **Weekly Wine** pill | Supplier auto-selects. Lines prefill with no typing. Belicard: shortfall 8 − 6.5 = 1.5 bottles → qty field **1**, unit **case** (`ceil(1.5 ÷ 12)`). The qty must never show the raw bottle shortfall against a "case" unit | ✅ |
| C10 | Read the Belicard line | Par context reads **"On hand 6.5 / par 8 · below par"** in **bottles**; the qty above it is in **cases**. Counting unit for context, buying unit for the order — the operator computes nothing | ✅ |
| C11 | Change Belicard qty to **5**, then click its **TO PAR** chip | Snaps back to the prefill (**1 case**). The chip tooltip shows the same value + unit | ✅ |
| C12 | Zero out a line, then click **Order everything to par** | Every guide line re-snaps to its prefill at once, including the one you zeroed | ✅ |
| C13 | Read the Belicard line's supplier-minimum warning | With minimum_order_qty = 2 (prep step 2) and a prefilled **1** in the field, inline amber **"Supplier minimum is 2"** shows. Raising the qty to 2 clears it. It **warns, never blocks** — saving still works below the minimum. Note whether the minimum reads sensibly against a **case** qty (the watch item above) | ✅ |
| C14 | Add an item **already at or above par** to the guide, reopen the PO | Shows in the list at qty **0** (visible, not hidden — the operator should see it was considered) but is **excluded** from the saved PO. Check the created PO's line count | ✅ |
| C15 | Save the PO, then open it from the Orders list | Only the non-zero lines are on it. Line total = qty × **per-case** cost (e.g. 1 case × $180 if a bottle is $15), not qty × per-bottle | ✅ |

#### Regressions — bugs this build fixed

These are the ones most likely to silently come back.

| # | Steps | Expected | Result |
|---|---|---|---|
| C16 | Catalogue fallback (don't pick a guide): search the item list, read the **Min Ord** column | Shows the supplier's **minimum_order_qty**, NOT `reorder_qty`. This column previously rendered the internal reorder trigger under a supplier-constraint heading — a PO could ship below a real supplier minimum with nothing flagging it. If Min Ord matches the item's reorder qty rather than what you set in prep step 2, the bug is back | ☐ |
| C17 | Compare a line's unit cost between the guide-prefilled PO and the **Suggestions** tab for the same item | Identical. They previously read different columns (`unit_cost` vs `preferred_unit_cost`) and disagreed | ☐ |
| C18 | Soft-delete an ingredient that's on a guide, reopen the guide in a PO | The deleted item does not appear. It should not resurrect as a line | ☐ |
| C19 | Open the Orders tab and watch the network panel on load | The ingredients list is fetched **once**, not twice. The PO list and PO form each used to fire an identical request on mount | ☐ |
| C20 | Type quickly in the catalogue search with a long catalogue | No lag per keystroke (debounced). A long list caps with **"+N more — keep typing to narrow it down"** rather than rendering thousands of rows | ☐ |

#### Unhappy paths + permissions

| # | Steps | Expected | Result |
|---|---|---|---|
| C21 | Create a guide, add **no** items, open it in a PO | No crash. Empty guide yields an empty draft, not an error | ☐ |
| C22 | Put an item with **no par set** on a guide, open the PO | Line appears at qty 0 with no par context — never a negative qty, never NaN | ☐ |
| C23 | Delete a guide that a draft PO was built from | Delete succeeds; the already-created PO is unaffected (guides are a template, not a foreign key on the order) | ☐ |
| C24 | Sign in as a user **without** `inventory:manage` | No **Guides** tab, no Par Levels editor. Ordering from an existing guide **still works** (that's `purchasing:draft`). Hitting the guide write routes directly → **403** | ☐ |

#### Send to supplier (PO email, 2026-07-22)

The PO email to the supplier is an **explicit action on a SENT order**, not automatic — `SENT`
stays an internal status flip. The server route (`POST /purchase-orders/:id/send-email`) is gated
by `purchasing:submit`, the same tier as Submit and the PDF download.

| # | Steps | Expected | Result |
|---|---|---|---|
| C25 | On a **SENT** PO, click **Send to supplier** | Supplier's contact email receives the PO with the **PDF attached**. Button flips to **Resend to supplier** and an **"Emailed {date}"** tag appears — no page reload | ☐ |
| C26 | Point a SENT PO at a supplier with **no contact email**, click Send to supplier | Plain message: *"This supplier has no contact email on file. Add one in Suppliers…"* — no error, PO unchanged, not marked emailed | ☐ |
| C27 | On a server with **no email configured** (no `RESEND_API_KEY`), click Send to supplier | Plain message: *"Email isn't set up on this server yet…"* — PO unchanged, not marked emailed. (This machine **has** Resend configured via the process env, so expect a real send instead) | ☐ |
| C28 | Hit `POST /purchase-orders/:id/send-email` as a user **without** `purchasing:submit` | **403**. The button is shown (matching the Submit button's pattern — server is the boundary), but the action is refused server-side | ☐ |

#### This session's UI fixes (2026-07-24) — verify, don't re-report

| # | Steps | Expected | Result |
|---|---|---|---|
| C29 | Open **New Purchase Order** without picking a guide and without typing in search | A prompt ("Pick a guide above…" or "Choose a supplier, or search…"), **not** a dump of the whole catalogue with Par/Min Ord/Unit Cost all "—". The item list appears only once you search or pick a supplier | ☐ |
| C30 | Look at the line-item picker | **No category chips** (Bakery / Dairy / Dry Goods…). Search box only. Category browsing was removed — nobody orders by category | ☐ |
| C31 | Expand a **SENT** PO and read the line's status badge | Reads **"Awaiting delivery"** (or Part received / Received), **never "Draft"**. A line badge saying Draft on a sent order was a real bug — it read as "not sent yet" | ☐ |
| C32 | Expand a PO; if detail fails to load (e.g. mid dev-server restart) | A specific message (session expired / no access / server error + Try again), **not** the old generic "Failed to load details." | ☐ |

#### Known gaps (found while writing this checklist — not bugs in the build)

- ~~**No UI to set a supplier minimum.**~~ **FIXED 2026-07-24.** Inventory → Catalog → edit an item →
  **Suppliers** section now has a **Min order** field: on the "Add Supplier" row for new links, and an
  inline editable box on each existing supplier row (commits on blur). Sets `minimum_order_qty`
  through the existing `PATCH/POST .../suppliers` routes (verified 200/401). No more curl needed.
- **Pars are hand-entered only.** Forecast-suggested pars are deferred to P2 (org 2 has no
  `consumption_log` history to forecast from). The bulk editor speeds up entry; it doesn't
  invent pars.

## D. Recipes — the ONLY place mL appears

> **2026-07-23 rework:** the recipe editor now runs THE shared 6-step unit resolver
> (`packages/shared/src/utils/unitResolution.ts`) — the same code every server stock
> flow uses — and each line's unit dropdown offers **only units that resolve** for
> the picked ingredient (kitchen unit, pack label, custom conversions, content/base
> families). Design doc: `~/.gstack/projects/.../…design-uom-recipe-costing…` (APPROVED).

| # | Steps | Expected | Result |
|---|---|---|---|
| D1 | Edit **Glass — Belicard** recipe line, tap the line cost to expand the breakdown | Line reads **150 mL**; breakdown proves the content-equivalence path: `150mL = 0.2 bottle × $15/bottle = $3.00 · org cost` (the formula is the assertion — the dollar tracks the live catalog cost) | ☐ |
| D2 | Pick Belicard fresh in a new recipe row | Unit defaults to **mL** (the measured unit), not bottle | ☐ |
| D3 | Open the unit dropdown on a Belicard line, then on a Baker's Flour line | Only resolvable units are offered (wine: mL, bottle, case + volume units; flour: kg, bag, mg, g). **kg is NOT offered for wine** — the mismatch state is unreachable from the dropdown | ☐ |
| D4 | Legacy mismatch: a pre-existing row whose stored unit no longer resolves (set via API if none exists) | Unit-mismatch warning + cost 0 — never a silent wrong number. Newly authored lines cannot reach this state | ☐ |
| D5 | Add a linked ingredient that has never been costed (no receiving, no supplier cost) | Line cost shows **"—"** with a "No cost yet — receive a PO or set a supplier cost" tooltip — never $0.00 | ☐ |
| D6 | Add a custom conversion for Baker's Flour (Catalog → conversions: `cup = 0.12 kg`), reopen a flour recipe line's dropdown | **cup** now appears and 2 cup costs ≈ 0.24 kg × $/kg — operator-defined units flow into recipes with zero code | ☐ |
| D7 | **Density bridge** (2026-07-23): open the Brioche Bun — the `95 g Full Cream Milk` and `1 g Vanilla Extract` lines | No mismatch warning. Milk resolves 95 g → **0.0922 L** (density 1.03, not the water approximation); the unit dropdown for milk offers **g/kg alongside mL/L**. Catalog → edit a liquid shows the **Density (g per mL)** field with an auto-suggested value | ☐ |
| D8 | Reopen a SAVED recipe with conversion/density-dependent lines | No false "unit mismatch" flash on load — conversions prefetch for all linked rows (regression: the lazy fetch used to leave saved lines warning until the dropdown was touched) | ☐ |
| D9 | **Yield vs sales unit** (2026-07-23): open Brioche Buns (12 × 75 g) — Servings **12** (kitchen yield), "Price covers **12** servings (pack pricing)", price $15 | Cost Summary reads Batch **$6.37** → FC/serving **$0.58** → Food Cost % **46.7%** ($7.01 per sale of 12) → Margin **$7.99** per sale. Setting "price covers" back to 1 flips FC% to 3.9% (per-bun pricing). Changing price/servings/Q/pack on the item PATCH refreshes stored margins immediately (regression: item updates used to leave stored costs stale) | ☐ |

## E. Selling — recipe explosion in kitchen units

| # | Steps | Expected | Result |
|---|---|---|---|
| E1 | Record sale → **Glass — Belicard ×1** | Depletion reads **−0.2 bottle**; catalog drops 8 → **7.8** | ☐ |
| E2 | Sell **Glass ×5** | Exactly **−1.0 bottle** (5 × 150 mL = 750 mL) | ☐ |
| E3 | Sell **Bottle — Belicard ×1** | **−1 bottle** | ☐ |
| E4 | Sell **Kir Royale ×1** | Belicard −100 mL ≈ **−0.13 bottle**; free-text line reported as skipped | ☐ |
| E5 | **San Pellegrino** appears under "FOH consumables (sold as-is)" in the Record-sale picker; sell **×3** | Stock **24 → 21**. No menu item had to be created by you | ☐ |
| E6 | Check Menu & Costing item list | **No** auto-generated "San Pellegrino" row appears (the 1:1 link is hidden plumbing) | ☐ |
| E7 | Oversell Pellegrino (×100) | Sale records; stock negative; amber oversold warning | ☐ |
| E8 | History tab → void the E2 sale | Stock restored **+1.0 bottle**; voiding again is rejected | ☐ |

## F. CSV import

| # | Steps | Expected | Result |
|---|---|---|---|
| F1 | CSV `item,qty` with `Glass — Belicard Blanc,2` + a bogus name → preview | 1 matched, 1 unmatched; **nothing depletes** | ☐ |
| F2 | Import | **−0.4 bottle** | ☐ |
| F3 | Re-import the same file | "already imported"; **no second depletion** | ☐ |

## G. Waste / supplies (no recipes for non-food)

| # | Steps | Expected | Result |
|---|---|---|---|
| G1 | Consumption log: waste **0.5 bottle** Belicard | Stock −0.5, entry shows "0.5 bottle" | ☐ |
| G2 | Consumption log: **40 each** Napkins (usage) | Napkins 350 → 310 — manual logging, no recipe/menu anywhere | ☐ |
| G3 | Transfers: send 2 **bottles** to Epicure | Source −2, destination +2, all in bottles | ☐ |

## H. Reports stay coherent

| # | Steps | Expected | Result |
|---|---|---|---|
| H1 | Yield variance on Glass (after E-sales) | Not "thin-data"; actual usage derives from the sale rows | ☐ |
| H2 | Location dashboard | Belicard on-hand in **bottles**; values = bottles × $/bottle (sane dollar totals) | ☐ |

---

## I. Storage areas — know what's at the bar without corrupting stock

Shipped in PR #76 (B1). Prod schema is already applied. The whole feature exists because
"moved 4 bottles to the bar" used to be logged as *usage*, which deducted them then and
AGAIN at the sale, and showed as phantom yield variance.

**Setup (Inventory → Areas tab, org-admin only)**
- [ ] Confirm the seeded default areas are present: **Dry Storage, Cool Room, Freezer, FOH Counter**.
      Add **Back Bar**. The copy should say areas never change what you have.
- [ ] Try to create an area called **Unassigned** → refused, in plain English, not a DB error.
- [ ] Create **Back Bar** twice → refused ("this location already has an area called Back Bar").
- [ ] Click an area's item count → add a wine → leave par blank → Save.
      The tab's count must update to "1 item" **without a page reload**.
- [ ] Add the same wine to the other area with **par 6**. Reorder the rows; the order sticks.

**The invariant — the point of the whole feature**
- [ ] Note the wine's site stock (Dashboard or Catalog). Call it **N**.
- [ ] Transfers → **Move Between Areas** → move 4 bottles Dry Storage → Back Bar → Record move.
- [ ] **Site stock is STILL N.** Not N−4. If it changed, stop and raise it — that is the bug
      this feature was built to make impossible.
- [ ] The success banner says "site stock unchanged".

**The guardrail**
- [ ] Transfers → Internal Usage → reason **FOH** → pick a **wine** → qty 4 → Transfer.
      → intercepted: "That's a move, not usage."
- [ ] Click **Record as movement** → the movement form opens with the wine and qty 4 already
      filled in. You should only have to answer "from where, to where".
- [ ] Repeat with **Napkins** (Op Supply) + FOH → **no** intercept. Napkins taken to the floor
      really are consumed.
- [ ] Repeat with a wine + reason **Kitchen** → no intercept.
- [ ] "Log as usage anyway" still works (staff comps are real).

**The history**
- [ ] Open the wine in Catalog → its transaction history shows the move as **Area Move**,
      "Dry Storage → Back Bar", alongside counts and usage.

**Edges**
- [ ] With fewer than 2 areas, Move Between Areas explains itself instead of showing a
      broken form.
- [ ] The "to" list never offers the area you picked as "from".

---

## UAT Report
- Stockroom -> Catalog -> When editing an ingredient, add 50% of the size of the description field


## Sign-off
- Tester: __________  Date: __________  Branch: `main` (PR #75 UOM + #76 storage areas, both merged)
- Overall: ☐ Pass ☐ Pass with notes ☐ Fail
- Notes:
