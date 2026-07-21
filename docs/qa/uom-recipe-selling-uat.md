# UAT Checklist — Kitchen-Unit Model + Recipe-Based Selling

> **Status 2026-07-19:** Sections **A (catalog)** + **B (stock take)** signed off ✅. **B3 (stock-take HQ review, PR #84 — variance, variance cost, review gating, History)** verified via browser QA and shipped to prod ✅ (merge `5e19857`). C–H + I (storage areas) pending.
> Fixture live: Chicken 10 kg, Flour 25 kg, Shiraz 24 bottles per location (the 4-bottle
> foh_operations test entry was reversed). NEXT: after the storage-areas build
> (`docs/specs/storage-areas-count-sheets.md`) this checklist gains an **I. Storage areas**
> section (area counts sum to venue, movement log, guardrail, spot check). Until the guardrail
> ships: do NOT log bar restocks as Internal usage — stock stays at the site until sold/wasted.

Manual acceptance test for `feature/ck-web/uom-and-recipe-selling`. The automated suite
(576 server + 31 real-DB E2E + 66 client tests) covers the logic; this is the human
click-through. Mark each row **Pass** / **Fail**.

**The model under test (your words):** every item has ONE kitchen unit it's counted in
(wine = bottle, flour = g, napkins = each). Packaging (case, bag) exists only at ordering +
receiving and converts at the moment of receiving. Recipes may pour in mL against a
bottle-counted item (1 bottle = 750 mL). FOH consumables sell directly — no recipe math.
**mL should appear NOWHERE except recipe lines.**

- **Ports:** backend `3009`, frontend `5179`.
- **Account:** **Rob Angeles - CulinAIre** (org *Almost French Pâtisserie*). Log out/in first.
- **Location:** **Almost French Patisserie** (Ctrl+L).

## Fixture (already seeded — say "re-seed UAT" to reset)

| Item | Type | Kitchen unit | Contains | Purchased as | Stock |
|---|---|---|---|---|---|
| Belicard Blanc Chardonnay | FOH Consumable | **bottle** | 750 mL | case of 12 | **8 bottles** @ $15 |
| Sancerre (+ 15 other wines) | FOH Consumable | **bottle** | 750 mL | by the bottle | 0.7 bottles (the open one) |
| Baker's Flour (T55) | Ingredient | **g** | — | 25 kg bag | 12,500 g |
| Napkins (cocktail) | Op Supply | **each** | — | case of 500 | 350 |
| San Pellegrino (can) | FOH Consumable | **each** | — | case of 24 | 24 |

Menu items: **Glass — Belicard** ($12, recipe 150 mL) · **Bottle — Belicard** ($55, 750 mL) ·
**Kir Royale** ($18, 100 mL + a free-text line).

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
| C1 | New PO → add Belicard | Unit defaults to **case (12 bottle)**; dropdown offers case / bottle; cost label reads **per case** | ☐ |
| C2 | Order **2 case @ $60**, submit, receive fully | Stock **+24 bottles**; line total $120 | ☐ |
| C3 | Auto-PO suggestions (set flour par above stock first) | Suggestion reads in **bags** (whole packages, rounded up), e.g. "1 bag (25000 g)" | ☐ |
| C4 | Receive a PO line via the legacy per-line receive with unit **case** | Stock rises by cases × 12 — never by the raw "2" (this was a live bug, now fixed) | ☐ |

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

| # | Steps | Expected | Result |
|---|---|---|---|
| C9 | Purchasing → Orders → **New Purchase Order** → click the **Weekly Wine** pill | Supplier auto-selects. Lines prefill with no typing. Belicard qty = **par − on hand = 8 − 6.5 = 1.5** | ☐ |
| C10 | Read the Belicard line | Reads **"On hand 6.5 / par 8 · below par"**. The par context is the whole point — an operator must not have to compute the quantity | ☐ |
| C11 | Change Belicard qty to **1**, then click its **TO PAR** chip | Snaps back to **1.5** | ☐ |
| C12 | Zero out a line, then click **Order everything to par** | Every guide line re-snaps at once, including the one you zeroed | ☐ |
| C13 | Set Belicard qty to **1** (below the minimum you set in prep step 2) | Inline amber **"Supplier minimum is 2"** under the qty. It **warns but does not block** — an operator may knowingly under-order. Saving still works | ☐ |
| C14 | Add an item **already at or above par** to the guide, reopen the PO | Shows in the list at qty **0** (visible, not hidden — the operator should see it was considered) but is **excluded** from the saved PO. Check the created PO's line count | ☐ |
| C15 | Save the PO, then open it from the Orders list | Only the non-zero lines are on it. Totals match qty × unit cost | ☐ |

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

#### Known gaps (found while writing this checklist — not bugs in the build)

- **No UI to set a supplier minimum.** `minimum_order_qty` is displayed in the Min Ord column and
  drives the C13 warning, but the only write path is `PATCH /inventory/ingredients/:id/suppliers/:supId`
  — no client component calls it. The warning can't be configured by an operator, only by import
  or curl. Worth a small editor in the supplier-link UI.
- **Pars are hand-entered only.** Forecast-suggested pars are deferred to P2 (org 2 has no
  `consumption_log` history to forecast from). The bulk editor speeds up entry; it doesn't
  invent pars.

## D. Recipes — the ONLY place mL appears

| # | Steps | Expected | Result |
|---|---|---|---|
| D1 | Edit **Glass — Belicard** recipe line | Line reads **150 mL**; cost preview: `150ml = 0.2 bottle × $15/bottle = $3.00` | ☐ |
| D2 | Pick Belicard fresh in a new recipe row | Unit defaults to **mL** (the measured unit), not bottle | ☐ |
| D3 | Set a line's unit to something unconvertible (e.g. kg of wine) | Unit-mismatch warning; cost shows 0 — never a silent wrong number | ☐ |

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
