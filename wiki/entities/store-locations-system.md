---
title: Store Locations System
category: entity
created: 2026-04-29
updated: 2026-04-29
related: [[culinaire-kitchen-platform]]
---

The multi-location subsystem that turns each Organisation into a business umbrella holding multiple physical kitchens (HQ, Branch, Commissary, Satellite).

## Source of truth
Live document: [docs/architecture/store-locations.md](../../docs/architecture/store-locations.md)

## Data model summary
```
Organisation (umbrella)
  └── Store Location (HQ ★ | Branch | Commissary | Satellite)
        ├── Staff assignments    (user_store_location)
        ├── Operating hours      (store_location_hour)
        └── Kitchen Ops data     (scoped by store_location_id)
```

## Tables
| Table | Purpose |
|---|---|
| `store_location` | Physical kitchen locations within an org |
| `user_store_location` | Staff → location assignments |
| `store_location_hour` | Operating hours per day per location |
| `user_location_preference` | Per-module location memory per user |

## Classifications
- `hq` — one per org (enforced by partial unique index)
- `branch` — standard operating location
- `commissary` — production kitchen supplying others
- `satellite` — temporary / pop-up

## Access control
- **Org Admins** — implicit access to ALL locations (not inserted into `user_store_location`)
- **Staff** — access only to explicitly assigned locations
- **No location** — staff sees `NoLocationScreen`, must enter Store Key or ask admin

## Why it matters
Every Kitchen Ops module (Stock Room, Purchasing, Menu Intelligence, Waste Intelligence, Kitchen Copilot) is location-aware. Location context flows from the user's preference into every scoped query.

## Related
- [[culinaire-kitchen-platform]]
