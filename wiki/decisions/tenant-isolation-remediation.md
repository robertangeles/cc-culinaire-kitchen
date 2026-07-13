---
title: Tenant-Isolation Remediation (July 2026)
category: decision
created: 2026-07-14
updated: 2026-07-14
related: [[tenant-isolation]], [[store-locations-system]], [[role-aware-navigation]], [[ci-pipeline]], [[lessons-index]]
---

A red-team audit triggered by a visible catalog leak found ~51 cross-tenant holes; all were fixed across 8 PRs, a read-only prod forensic sweep confirmed no breach, and a required real-DB CI gate now blocks any regression.

## Source of truth (full detail)
- [docs/security/tenant-isolation-audit.md](../../docs/security/tenant-isolation-audit.md) — the complete finding ledger (per-domain, per-finding location + fix).
- [docs/security/prod-exposure-check.md](../../docs/security/prod-exposure-check.md) — the read-only production forensic assessment.
- Real-DB regression suite: `packages/server/src/tenantIsolation.integration.test.ts`; CI job `Tenant isolation (real DB)` in [.github/workflows/ci.yml](../../.github/workflows/ci.yml).

## Status
Active as of 2026-07-14. All 8 PRs (#64–#71) merged to `main` and deployed. Both `Typecheck, test, build` and `Tenant isolation (real DB)` are **required** status checks on `main`.

## Why this exists
A user working under org *Almost French Pâtisserie* (0 local ingredients) saw a full 55-item Stock Room catalog belonging to another org. Root cause was a dropped org filter in `listIngredients` (see [[tenant-isolation]] for the mechanism). The audit that followed proved it was **systemic, not a one-off**: the newer Stock Room / Purchasing / Menu endpoints fetched or mutated resources **by id without threading the caller's org/owner and checking it**, while the older endpoints did. ~51 holes across inventory, purchasing/receiving, menu/recipe, stock-take, community (Bench), org-management, conversations, and recipes.

## The isolation model this establishes (the yardstick)
**User-first, then organisation.**
- User-owned resources — `menu_item`, `recipe`, `conversation`, `message` — scope by `user_id` (guests by `guestSessionToken`).
- Org-shared resources — `ingredient`, `supplier`, `store_location`, `purchase_order`, stock, org Bench channels — scope by `organisation_id`, and org access requires `user_organisation` membership.
- **Administrator** is an intentional platform superuser (bypasses `requirePermission`; not a tenant).
- Every by-id read/mutation must re-derive and check that boundary from the auth context — never trust an id or a client-supplied scope (org id / location id).

## What was decided / enforced
1. **Fix the class, not the symptom** — thread org/owner into every by-id service; guard before touching data (`getIngredient(id, orgId)` / `getMenuItem(id, userId)` preflights; `AND organisation_id` in by-id WHEREs; validate client-supplied `storeLocationId` against membership).
2. **404, not 403, for "not in your org"** — a 403 that differs from a 404 is an org-existence enumeration oracle. Put the org guard before any status/transition check.
3. **Prove isolation against a real database** — the pre-existing suite mocks the DB and could not have caught the dropped filter. A real-Postgres integration suite + a **required** CI job is the durable guard. See [[tenant-isolation]].
4. **No breach occurred** — 22/22 prod contamination detectors returned 0, both prod orgs are company-internal (no external tenant), and the one PII-exposing vector (org-id enumeration → join key + member names/emails) had a 4-person internal blast radius and is fixed. The fixes land before any real external kitchen is onboarded.

## Deferred / follow-up
- Enable write + sensitive-read auditing (`audit_log` exists but is empty) so future access is provable.
- Consolidate the three separate "location-belongs-to-org" checks into the single `getLocationInOrg` helper (post-merge cleanup).
