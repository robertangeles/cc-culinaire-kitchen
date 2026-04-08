# Store Locations Architecture

## Overview

The Store Locations system adds multi-location support to CulinAIre Kitchen. An Organisation becomes a pure business umbrella, while physical kitchen locations are modeled as Store Locations beneath it.

## Data Model

```
Organisation (umbrella)
  ├── Store Location (HQ) ★
  │     ├── Staff assignments (user_store_location)
  │     ├── Operating hours (store_location_hour)
  │     └── Kitchen Ops data (scoped by store_location_id)
  │
  ├── Store Location (Branch)
  │     ├── Staff assignments
  │     ├── Operating hours
  │     └── Kitchen Ops data
  │
  └── Store Location (Commissary)
        └── ...
```

## Tables

| Table | Purpose |
|---|---|
| `store_location` | Physical kitchen locations within an org |
| `user_store_location` | Staff → location assignments |
| `store_location_hour` | Operating hours per day per location |
| `user_location_preference` | Per-module location memory per user |

## Classifications

| Value | Description |
|---|---|
| `hq` | Headquarters — one per org (enforced by partial unique index) |
| `branch` | Standard operating location |
| `commissary` | Production kitchen supplying other locations |
| `satellite` | Temporary/pop-up location |

## Access Control

- **Org Admins**: Implicit access to ALL locations (not inserted into `user_store_location`)
- **Staff**: Access only to explicitly assigned locations
- **No location**: Staff sees NoLocationScreen — enter Store Key or ask admin

## Location Context Flow

```
User authenticates
  → GET /api/users/location-context
  → LocationContext provider populates
  → selectedLocationId resolved (DB-persisted)
  → Kitchen Ops queries filter by store_location_id
```

## Store Key Pattern

- Format: `KITCHEN-` + 12 random uppercase alphanumeric chars
- Self-serve join requires existing org membership (cross-org guard)
- Regeneratable by org admin

## Key API Endpoints

```
POST   /api/store-locations          — create location (admin)
GET    /api/store-locations/mine     — get user's locations + context
POST   /api/store-locations/join     — join via store key
GET    /api/store-locations/:id      — get location details
PATCH  /api/store-locations/:id      — update location (admin)
POST   /api/store-locations/:id/deactivate — deactivate (admin)
GET    /api/store-locations/:id/staff      — list staff
POST   /api/store-locations/:id/staff      — assign staff (admin)
DELETE /api/store-locations/:id/staff/:uid — remove staff (admin)
GET    /api/store-locations/:id/pulse      — lightweight metrics
GET    /api/store-locations/:id/hours      — operating hours
PUT    /api/store-locations/:id/hours      — set hours (admin)
GET    /api/users/location-context         — full location context
PATCH  /api/users/selected-location        — switch location
PATCH  /api/users/location-preferences     — per-module preference
```

## Frontend Components

| Component | Purpose |
|---|---|
| `LocationContext` | React context + DB-persisted selection |
| `LocationSelector` | Dropdown in sidebar (hidden if 1 location) |
| `LocationSwitcher` | Ctrl+L command palette overlay |
| `LocationGate` | Wraps Kitchen Ops routes, shows NoLocationScreen if unassigned |
| `LocationSetup` | First-location creation during org onboarding |
| `LocationCard` | Glass morphism card for admin location views |
| `LocationPulse` | Staff count + last activity badge |
| `LocationHoursEditor` | 7-day operating hours grid |

## PII Encryption

Location name and address are encrypted using the same AES-256-GCM pattern as organisation PII. Address fields are combined into a single encrypted JSON blob.
