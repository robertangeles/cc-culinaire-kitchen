# UAT Checklist — Kitchen-Unit Model + Recipe-Based Selling

> **Status 2026-07-15:** parked mid-UAT. Section A partially walked (not signed off); B–H untested.
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
| A1 | Stock Room → Catalog → Belicard | UOM **bottle**, Stock **8** — no mL anywhere in the row | ☐ |
| A2 | Open Belicard's edit modal | **Counted in: bottle** · **bottle size: 1 bottle = 750 mL** · **Purchased as: case of 12 bottle @ cost** — plain chef language, no jargon | ☐ |
| A3 | "Stock across locations" panel in the modal | Patisserie shows **8 bottle** (not 6000 mL) | ☐ |
| A4 | Sancerre row (the item that started all this) | Stock ≈ **0.7 bottle** — the ⅔-open bottle, in bottles | ☐ |
| A5 | Flour row + edit modal | UOM **g**, stock 12500; the modal shows **no "size" row** for a grams-counted item (nothing to declare) and "Purchased as: bag of 25000 g" | ☐ |

## B. Stock take — count what you see

| # | Steps | Expected | Result |
|---|---|---|---|
| B1 | Start a stock take covering Belicard | Keypad counts in **bottle**; enter **6.5** (6 full + 1 half) | ☐ |
| B2 | Approve (HQ review) | Catalog stock = **6.5 bottles**; variance shown in bottles | ☐ |

## C. Purchasing — packaging exists only here

| # | Steps | Expected | Result |
|---|---|---|---|
| C1 | New PO → add Belicard | Unit defaults to **case (12 bottle)**; dropdown offers case / bottle; cost label reads **per case** | ☐ |
| C2 | Order **2 case @ $60**, submit, receive fully | Stock **+24 bottles**; line total $120 | ☐ |
| C3 | Auto-PO suggestions (set flour par above stock first) | Suggestion reads in **bags** (whole packages, rounded up), e.g. "1 bag (25000 g)" | ☐ |
| C4 | Receive a PO line via the legacy per-line receive with unit **case** | Stock rises by cases × 12 — never by the raw "2" (this was a live bug, now fixed) | ☐ |

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

## Sign-off
- Tester: __________  Date: __________  Branch: `feature/ck-web/uom-and-recipe-selling`
- Overall: ☐ Pass ☐ Pass with notes ☐ Fail
- Notes:
