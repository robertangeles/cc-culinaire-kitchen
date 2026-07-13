---
title: Tenant Isolation
category: synthesis
created: 2026-07-14
updated: 2026-07-14
related: [[tenant-isolation-remediation]], [[lessons-index]], [[store-locations-system]], [[ci-pipeline]]
---

How multi-tenant data isolation works in this codebase, the bug class that broke it in July 2026, the fix patterns, and the regression gate that now protects it.

## The model: user-first, then organisation
- **User-owned** rows — `menu_item`, `recipe`, `conversation`, `message` — belong to a `user_id` (guests to `guestSessionToken`). A co-org user is NOT automatically allowed to see them.
- **Org-shared** rows — `ingredient`, `supplier`, `store_location`, `purchase_order`, stock, org Bench channels — belong to an `organisation_id`; access requires a `user_organisation` membership row.
- **Administrator** is an intentional platform superuser (bypasses `requirePermission` — see [middleware/auth.ts](../../packages/server/src/middleware/auth.ts)); it is not a tenant and its access is by design.
- The server route is the security boundary. Nav-hiding is UX only.

## The bug class (July 2026)
Two shapes, one root cause — resources reached by id without the caller's boundary being re-derived and checked:

1. **Dropped filter (the trigger).** `listIngredients` used `db.select()....where(eq(organisationId, orgId)).$dynamic()` then chained `query = query.where(isNull(deletedAt))`. **A chained `.where()` on a `$dynamic()` query REPLACES the previous clause — it does not AND it.** The org filter was overwritten; the default catalog load returned every tenant's rows. Only the default path leaked because the category/search branches re-added org inside `and(...)`.
2. **IDOR / missing guard (the class).** Newer by-id endpoints fetched or mutated a row by its id (conversion id, supplier id, PO id, session id, menu-item id, message id) without threading and checking the caller's org/owner. ~51 holes across 8 domains — all the same shape.

Plus review-caught refinements: a present-but-bypassable fix (pin a foreign channel's message id, read it back via pinned-messages), 403-vs-404 existence oracles, and a status-check-before-org-guard oracle in receiving.

## Fix patterns (all findings collapse to these)
- **A — IDOR by id:** thread `orgId`/`userId` into the service; add `AND organisation_id = :orgId` (or an owner check) to the by-id WHERE, or a preflight ownership fetch (`getIngredient(id, orgId)`, `getMenuItem(id, userId)`); return **404** (not 403) on mismatch.
- **B — dropped list filter:** build one `and(...conds)` and apply a single `.where(...)`; never chain `.where()` expecting an AND. Validate any client-supplied `storeLocationId` with `getLocationInOrg(id, orgId)`.
- **C — client-scope trust:** never take org/location/user from the request as trusted scope — derive from `user_organisation` membership and validate the supplied value against it.
- **Guard order:** the ownership guard runs before any status/transition check, and inside a transaction before any mutation.

## The regression gate
Mocked unit tests cannot prove tenant isolation — the dropped filter passed every mock. The durable guard is `packages/server/src/tenantIsolation.integration.test.ts` (gated on `TENANT_IT=1`), run by the **required** CI job `Tenant isolation (real DB)`: a throwaway pgvector Postgres → `drizzle-kit push` → seed two orgs + two users → assert the live queries refuse cross-tenant reads and cross-owner writes. A regression that drops an org filter or a by-id owner check now fails CI and is blocked at merge.

## Exposure outcome
A read-only prod forensic sweep found **no breach**: 22/22 contamination detectors = 0 (write-side IDORs never exploited), no external customer tenant exists (both prod orgs are company-internal), and the one PII vector (org enumeration → member names/emails) had a 4-person internal blast radius, now fixed. Detail: [docs/security/prod-exposure-check.md](../../docs/security/prod-exposure-check.md).

See the decision record [[tenant-isolation-remediation]] and lesson #65 in [[lessons-index]].
