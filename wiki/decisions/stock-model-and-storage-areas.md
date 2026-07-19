---
title: Stock Model + Storage-Area Standards
category: decision
created: 2026-07-17
updated: 2026-07-17
related: [[technical-architecture]]
---

One on-hand number per item per venue; storage areas are count sheets, not ledgers; POS sales deplete the venue pool; per-area balances are a deferred opt-in — and the module is named "Inventory", not the retail "Stock Room".

## Context

While designing the POS-sales-import feature we hit a modelling question: the inventory
module was labelled **"Stock Room"**, which imports the *retail* mental model where a
warehouse/stockroom **is** a place that holds stock and a sale depletes **from** it. That
framing implied a sale should choose *where* to deplete (Stock Room vs Bar). We stopped to
verify against how hospitality actually works before setting a standard the culinary world
would trip over.

Three web-research passes (vendor docs + hospitality SOPs, cited below) converged. This
decision records the standard so every downstream feature — especially POS import — is built
on it.

## Decision

### 1. Stock lives at the venue, not the area  (venue-level default)

There is exactly **one live on-hand number per item per venue**, in `stock_level` keyed
`(store_location_id, ingredient_id)` — no area column. Depletion (`consumption_log`) is keyed
the same way. This is the model every independent-tier system uses (R365, MarketMan,
Toast/xtraCHEF, Apicbase, MarginEdge). Our build already matches it; this decision locks it.

### 2. Storage areas are COUNT SHEETS, not ledgers

`storage_area` names a physical zone within one site (Dry Storage, Cool Room, Back Bar). Areas
carry zero stock. They exist to organise the shelf-to-sheet stocktake walk and hold per-area
pars/restock. Per-area counts **sum** to the venue number at approval; items on no sheet fall
into the synthetic **"Unassigned"** bucket. `stock_movement` records area→area moves as
**audit-only, zero stock effect** — a bar restock must not deduct sellable stock twice (once at
the move, once at the sale) or poison variance.

### 3. POS sales deplete the venue pool  (the import contract)

A POS sale → recipe/BOM explosion → deduct each ingredient's quantity from **venue on-hand**
via `consumption_log`. The importer never targets an area. The only *where* axis it resolves is
**`store_location`** (which site), relevant when a POS export spans multiple venues. Recorded in
the shared `api-contracts.md` so the mobile/importer side builds to the same rule.

### 4. Per-area balances = deferred opt-in (do NOT build by default)

Independent balances that deplete per area exist only at the **hotel / high-control-bar** tier,
via **requisitions** (a signed transfer debits the store, credits the bar — a real two-ledger
move). They drift to fiction within ~2 weeks once a busy-service move goes unlogged. So:

> `ponytail:` per-area requisition ledger is a future opt-in module, gated behind a feature
> flag + permission, modelled on the hotel requisition flow. Build only when a real bar/hotel
> customer needs it and will maintain the discipline. The existing **inter-location** `transfers`
> feature (`/api/inventory/transfers`) already implements a real two-ledger move between *sites*
> and is the pattern to mirror intra-venue if this is ever built. Upgrade path, not debt.

### 5. Naming standard  (rename "Stock Room" → "Inventory")

"Stock room" (two words) is **retail** vocabulary and reads as amateurish to chefs. The module
is now **"Inventory"** (in-app + marketing). Areas use hospitality terms. New locations seed a
minimal, AU-worded, fully-editable starting set: **Dry Storage, Cool Room, Freezer, FOH /
Counter** (`DEFAULT_AREA_NAMES` in `storageAreaService.ts`) — a patisserie isn't handed bar
zones it will never use; operators add Back Bar / Speed Rail / Cellar as needed.

## Operator-facing terminology (use these labels; avoid the retail ones)

| Use | Meaning | Avoid |
| --- | --- | --- |
| Dry Storage | Shelf-stable store | "Stock room" as an area |
| Cool Room | Walk-in refrigerator (AU term) | "Walk-in" (US) |
| Freezer / Cellar | Frozen / wine store | — |
| Back Bar · Speed Rail (Well) | Display shelf · under-bar working stock | — |
| Par (level) · Par sheet | Target on-hand · par-vs-onhand doc | — |
| Count sheet · Shelf-to-sheet | Count recording doc · count method (shelf first) | — |
| Requisition · Issue · Transfer | Request-from-store · release · move between zones (two-ledger) | — |
| Depletion · Usage/Consumption | Stock used in a period | — |
| Theoretical vs Actual · Variance · Shrinkage | Should-use vs did-use · the gap · unaccounted loss | — |

## Consequences

- POS import builds against venue-level depletion — no per-area attribution work.
- The "should a sale deplete Stock Room or an area?" question is closed: neither — the venue.
- A rename touched nav/toolbar/page + marketing copy + area placeholder examples (labels only;
  internal ids/routes/permissions were already `inventory`-based).
- New locations get default areas automatically; existing ones via `backfillDefaultStorageAreas.ts`.

## Sources

- [Toast — storage room](https://pos.toasttab.com/blog/on-the-line/restaurant-storage-room) ·
  [ShelfDB — warehouse vs stockroom](https://blog.shelfdb.com/warehouse-vs-stockroom-differences-in-inventory-management/)
- [R365 storage locations](https://docs.restaurant365.com/docs/newstorage-locations) ·
  [Altametrics — perpetual vs periodic](https://altametrics.com/perpetual-inventory/perpetual-vs-periodic.html) ·
  [RTG — inventory drift](https://www.rtgsolutionsgroup.com/blog/inventory-accuracy/)
- [SetupMyHotel — requisition SOP](https://setupmyhotel.com/hotel-sop-standard-operating-procedures/food-and-beverage-service-sop/sop-bar-lounge-store-requisition-and-inventory/) ·
  [Sculpture Hospitality — glossary](https://www.sculpturehospitality.com/blog/restaurant-inventory-management-glossary)

Spec: [storage-areas-count-sheets.md](../../docs/specs/storage-areas-count-sheets.md)
