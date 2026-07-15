---
title: Storage Areas as Count Sheets
category: concept
created: 2026-07-15
updated: 2026-07-15
related: [[uom-and-recipe-selling]], [[reconciliation-matrix]], [[data-flow-architecture]]
---

Areas name the places stock physically lives (Stock Room, Bar, Walk-in) so a stocktake can be walked shelf-by-shelf and each place can carry its own par — without ever splitting the one on-hand number per item per site.

---

## The bug that created this

During UAT someone moved 4 bottles of Shiraz to the bar and logged it as "Internal usage — FOH" (`consumption_log.reason = 'foh_operations'`). Stock dropped 24 → 20. But the bottles weren't consumed — they were sellable inventory sitting in the bar fridge. When they later sold through Record Sale, the recipe explosion deducted them **again**, and yield variance showed 4 bottles of phantom usage.

The product's only vocabulary for "restocked the bar" was *consume it*. That was the defect. Areas + movements give it the words.

## The model

```
  ORDER (case/bag) ──receive──▶ VENUE STOCK (kitchen units, ONE number) ──sale/waste──▶ gone
                                     ▲                │
                                     │ counts SUM up  │ organizes the walk
                                     │                ▼
                              ┌─ Stock Room count ─ Bar count ─ FOH count ─┐   ← count sheets
                              │  (per-area par → "bring up 4" restock list) │
                              └─ stock_movement: Stock Room → Bar (0 stock) ┘   ← audit only
```

- `stock_level` stays keyed `(store_location_id, ingredient_id)` — **untouched**. Selling, receiving, transfers, FIFO, WAC: zero changes.
- An item is assigned to one or more areas (wine: Stock Room + Bar), each assignment carrying an optional per-area par and a shelf sort order.
- Stocktakes walk area by area when a site has areas; per-item area counts **sum to the venue count**. No areas defined → sessions behave exactly as today.
- Area quantities are **snapshots from counts**, never live ledgers. Movements are audit notes with zero stock effect.

## Why not per-area stock ledgers

Verified against vendor docs (2026-07-15). Restaurant365, xtraCHEF/Toast, Apicbase, and even dedicated bar software converge on the same model — Backbar states plainly: *"Backbar does not track real-time inventory by location."*

One live on-hand number per item per venue. Named areas exist to organise the **walk**, not to hold stock. Bar restocking is a physical ritual (bottle-for-bottle swap) driven by par levels, not a software ledger.

The reason is drift: every physical move would need a matching data entry or the ledgers diverge within days — a permanent nightly bookkeeping tax. The kitchen-unit model ([[uom-and-recipe-selling]]) just established ONE stored truth per item per site; splitting it per area re-introduces exactly the drift it removed.

## Traps for the next person

Each of these was found the hard way during the build. They are not obvious from reading the code.

**The approval gate does NOT block uncounted groups.** `checkAndAdvanceSession` (stockTakeService.ts:518-521) and `submitSessionForReview` (:389) both exclude `NOT_STARTED` categories *by design* — that is what makes cycle counts work. Safe in CATEGORY mode, because an uncounted item gets no line and its stock is never written. **Not safe in AREA mode**: an item on two sheets with one area unclaimed gets `SUM(lines)` written, silently deleting the uncounted area's quantity. The guard must live on BOTH paths.

**`updateStockLevelsFromSession` upserts PER LINE** (:872-897). In AREA mode an item counted in two areas would get last-area-wins. AREA mode must GROUP BY ingredient and write the sum once.

**The count sheet has no server-side item universe.** `openSession` creates category rows from a constant and no lines at all — lines appear on demand via `saveLineItem`. The sheet's item list is a *client-side* filter (`CategoryCounter.tsx:39-43`) using `activeInd !== false`. Note that `openOpeningCount`'s server predicate (`activeInd = true`) is **stricter** and is not a valid stand-in — it drops items whose `activeInd` is NULL.

**`stock_take_line` has no `session_id`** — it links via `category_id`. And `stock_take_session` has no `approved_at`; approval sets `closed_dttm`. (An `approved_at` exists on `purchase_order` — unrelated, don't be misled.)

**"transfer" means consumption.** In the item transaction feed, the type `transfer` is a `consumption_log` row; the real inter-location transfer is `transfer_loc`. Area moves are `movement`.

**Timestamps use both suffixes on purpose.** `_dttm` for row lifecycle, `_at` for domain events. `consumption_log` carries both at once: `logged_at` + `created_dttm`/`updated_dttm`. `stock_movement` follows it exactly with `moved_at`.

## Where it lives

| Piece | Path |
|---|---|
| Spec (CEO + ENG cleared) | `docs/specs/storage-areas-count-sheets.md` |
| Schema | `storage_area`, `ingredient_storage_area`, `stock_movement` in `db/schema.ts` |
| Migration | `server/src/scripts/migrateStorageAreas.sql` (drizzle-kit push is blocked on the dev DB — see [[schema-drift-may-2026]]) |
| Services | `storageAreaService.ts`, `stockMovementService.ts` |
| Routes | `routes/inventory.ts` — reuses `inventory:count` / `inventory:manage`, no new permission key |
| Client | `StorageAreasTab.tsx` (Areas tab), `StockMovementForm.tsx`, guardrail in `ConsumptionLogger.tsx` |

## Delivery

Three sequential branches, so the one that writes stock gets its own review:

- **B1** — areas + assignments + movements + guardrail + Areas tab. Zero stock writes.
- **B2** — AREA-mode counting. **The only branch that changes stock writes**; carries the summing fix and the uncounted-area guard.
- **B3** — area snapshot, restock list, spot check.

## Not in scope

Live per-area ledgers (industry-refuted at this tier); area-level `stock_level` keying; "counted + moved since" arithmetic on snapshots; per-area variance analytics; receiving directly into an area; bottle-for-bottle empty-swap tracking.
