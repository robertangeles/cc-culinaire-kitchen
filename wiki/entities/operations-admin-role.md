---
title: Operations Admin + Organisation Settings
category: entity
created: 2026-08-29
updated: 2026-08-29
related: [[store-locations-system]], [[roster-core]], [[staff-compliance-vault]]
---

A real, org-scoped RBAC role granted automatically to the first person who creates an organisation, plus a proper Profile → Organisation home for org-level administration (User Management, Organisation Settings).

## Why it exists

Two separate, half-built stories existed before this: a narrow hardcoded permission bridge (`ORG_ADMIN_PERMISSIONS` in `authService.ts` — just `inventory:*` + `purchasing:*`) layered on top of a non-RBAC `user_organisation.role = "admin"` flag, and a working org-member-management screen (`TeamMembersSection`) buried three tab-levels deep in `ProfilePage.tsx` with no direct nav entry. This replaces the bridge with a real permission-key role in the same RBAC system `compliance:*`/`roster:*` already use, and relocates the existing screen rather than rebuilding it.

## Role

`Operations Admin` — seeded in `db/seed.ts`, granted 26 of the 30 permission keys (everything except the four `admin:*` platform-administration keys). `createOrganisation()` grants it to the creator idempotently (`shouldGrantOperationsAdminRole`), additive to whatever role they already hold (Subscriber/Paid Subscriber) — `stripeService.ts` still reads those for billing.

## Disclosed limitation — global role, not per-org

`user_role` has no `organisationId` column. An Operations Admin of Org A carries the full 26-key set into every other org they merely belong to as a plain member. Not new — the old 9-key bridge had the identical shape at a narrower scope — just wider now. Proper per-org scoping would touch every `getUserWithRolesAndPermissions` caller, the JWT shape, and every `hasPermission` call site; out of scope here and disclosed rather than hidden, matching the Award engine's "0 of N checked" precedent in [[roster-core]].

## Tenant isolation

`organisationController.ts`'s `handleUpdateMemberRole`/`handleRemoveMember` gate on `getMembership(userId, orgId)` **first and unconditionally** — the global `org:manage-organisation` permission only reaches a second OR-branch once real membership in *that specific org* is already proven. An Operations Admin of Org A with zero relationship to Org B still 403s on Org B. Proven by `organisation.tenant.integration.test.ts` (real DB, `TENANT_IT=1`).

## Slice 0 — the leak this closed

`org:manage-organisation` was already seeded on Paid Subscriber, harmlessly, because nothing checked that key before this. The moment the member-management routes started checking it, every Paid Subscriber — not just Operations Admin — would have gained the ability to manage membership of any org they merely belonged to. Removed from `rolePermMappings["Paid Subscriber"]` in the same PR as the route change; the backfill script strips any already-seeded row on existing installs. Reversed order (enforcing before the fix lands) is a live privilege-escalation window.

## Organisation Settings — branding + operational defaults

Five new columns on `organisation` (`organisationLogoPath`, `organisationColorAccent`, `defaultTimezone`, `defaultCurrency`, `defaultJurisdiction`). **Metadata only** — not wired into `resolveJurisdiction()` or venue timezone resolution, which stay correctly per-`store_location` since a multi-location org can legitimately span jurisdictions. Saved via the existing `PATCH /api/organisations/:id`, extended rather than a new endpoint. Field-update semantics: absent preserves, empty string clears (nullable fields only), a value sets — needed because this route is shared with the pre-existing org-details form and neither form may blow away the other's fields when its own fields are simply absent from a given request.

## Client

`Profile menu → Organisation` (`pages/OrganisationPage.tsx`, gated `RequirePermission anyOf={["org:manage-organisation"]}`), two tabs: User Management (relocated `TeamMembersSection`, extracted verbatim from `ProfilePage.tsx`) and Organisation Settings (`OrganisationBrandingForm.tsx`). The old Profile → Team sub-tab is deleted, not left as a duplicate entry point.

## Backfill

`scripts/backfillOperationsAdminRole.ts` — self-contained (doesn't require `db:seed` to have run), ensures the role + its 26 permission links exist, grants every existing `user_organisation.role = 'admin'` user exactly one `user_role` row (deduped per user, not per org they admin), and carries the Slice 0 cleanup in the same transaction. Idempotent — re-running grants nothing new.
