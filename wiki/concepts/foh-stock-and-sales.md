---
title: FOH Stock and Sales
category: concept
created: 2026-07-14
updated: 2026-07-14
related: [[reconciliation-matrix]], [[formula-catalog]], [[technical-architecture]]
---

FOH consumables carry a second stock bucket (`zone='FOH'`) that a point-of-sale sale deducts, separate from the back-of-house warehouse qty (`zone='BOH'`).

## The problem

Stock Room catalog items are typed `KITCHEN_INGREDIENT`, `FOH_CONSUMABLE`, or `OPERATIONAL_SUPPLY`. FOH consumables (bottled drinks, spirits, packaged snacks) are sold to customers. Operators need two counts per store: **BOH** (warehouse / supply room) and **FOH** (front-of-house shelf). A sale deducts FOH. Before this change, `stock_level` held one bucket per `(store_location, ingredient)` and there was no POS/sales system.

## The model — a `zone` dimension on `stock_level`

`stock_level` is keyed on `(store_location_id, ingredient_id, zone)`, `zone ∈ {BOH, FOH}`, default `'BOH'`.

- **BOH is the existing "Stock" number.** Receiving, transfers, stock takes, consumption, FIFO, WAC all continue to write BOH unchanged — the `zone` column defaults to `'BOH'`, and `addStock`/`deductStock` take a `zone` param that every existing caller omits.
- **FOH rows exist only for FOH consumables** once they're stocked to the front or sold.
- **Read-path rule (the safety invariant):** every legacy `stock_level` reader/writer pins `zone='BOH'` so a FOH consumable's two rows never double-count. Only the FOH endpoints touch `zone='FOH'`. This turned a potential engine rewrite into a bounded audit. See [[reconciliation-matrix]].

Chosen over a parallel `foh_stock` table: one normalized stock table fits the project's DB standards, at the cost of the read-path audit.

## The two operations

- **Stock the fridge** — `fohStockService.moveToFoh`: `deductStock(BOH)` + `addStock(FOH)` in one tx. Rejected if BOH < qty. BOH+FOH conserved within the location.
- **Record a sale** — `fohSalesService.recordFohSales`: per line, in its own tx, insert a `foh_sale` row + deduct FOH (row locked `FOR UPDATE`). **Oversell is allowed and flagged** (`oversold_ind`) — the sale already happened at the counter; never hard-fail. Invalid lines are rejected but valid ones still post.

## No POS is built

The app contains **no** point-of-sale. `recordFohSales` is a pluggable boundary: v1 sale sources are a manual "Record sale" form and a CSV import (both post `lines[]`). A real POS or external integration (Square/Lightspeed) can later post to the same endpoint with `source='POS'`.

## Supporting pieces

- `foh_sale` — flat sale ledger (one row per sold line): qty, optional unit_price/line_total, source, `oversold_ind`, sold_at.
- `location_ingredient.foh_par_level` — per-location FOH par; drives low-FOH alerts + restock-to-par suggestion (`suggestFohRestock`).
- `consumption_log.zone` — FOH waste reuses the consumption audit surface with `zone='FOH'`.
- **COGS/margin report** — `getFohSalesReport`: revenue = Σ line_total; COGS = Σ qty × location WAC (fallback preferred unit cost); margin = revenue − COGS.
- **Permissions** — `sales:record` (stock/count/waste/sell) and `sales:read` (reports), granted to the default operator roles.

## Where it lives

- Server: `services/fohStockService.ts`, `services/fohSalesService.ts`, `controllers/fohController.ts`, routes under `/api/inventory/locations/:locId/foh/*` + `/locations/:locId/sales`.
- Client: Stock Room → **FOH** tab (`components/inventory/FohTab.tsx`, `hooks/useFoh.ts`); the Catalog "Stock" cell shows `BOH / FOH` for FOH consumables.
- Tests: `routes/fohPermissions.test.ts` (boundary), `services/fohStock.integration.test.ts` (real-DB, gated `FOH_IT=1`).
