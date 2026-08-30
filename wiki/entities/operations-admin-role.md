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

`user_role` has no `organisationId` column. An Operations Admin of Org A still carries the other 24 permission keys (`inventory:*`, `purchasing:*`, `compliance:*`, `roster:*`, etc.) into every other org they merely belong to as a plain member — those routes authorize on the permission alone, with no per-org admin flag to fall back to. Not new — the old 9-key bridge had the identical shape at a narrower scope — just wider now. Proper per-org scoping would touch every `getUserWithRolesAndPermissions` caller, the JWT shape, and every `hasPermission` call site; out of scope here and disclosed rather than hidden, matching the Award engine's "0 of N checked" precedent in [[roster-core]]. **`org:manage-organisation` itself is no longer part of this limitation** — see Tenant isolation below.

**Known gap, not fixed:** a member promoted to per-org admin by an *existing* admin (`handleUpdateMemberRole`, not `createOrganisation()` or the backfill) gets `userOrganisation.role = "admin"` but no `user_role` Operations Admin grant — so they can't reach `/organisation` at all (`RequirePermission anyOf={["org:manage-organisation"]}` blocks the route client-side) even though the server would authorize their actions if they could. An access gap, not a security hole — out of scope for this pass, left for a follow-up.

## Tenant isolation

`organisationController.ts`'s `isOrgManager()` authorizes writes (member-role changes, member removal, org details, logo) on the **per-org `userOrganisation.role === "admin"` flag only** — it deliberately does not fall back to the global `org:manage-organisation` permission. An earlier version of this check *did* OR in the global permission once membership in the target org was confirmed, on the theory that "membership first, permission second" was enough — it wasn't: any Operations Admin who later joined a second org as a plain member could use their global permission to promote themselves (or anyone) to admin there, remove its members, or rewrite its details, none of which their own org administration should reach. Closed before this branch was pushed, caught by an automated security review of the commit. Costs no real capability: `createOrganisation()` grants local admin and the global role together, and the backfill only targeted existing per-org admins, so every legitimate Operations Admin already holds local admin on every org they actually administer. Proven by `organisation.tenant.integration.test.ts` (real DB, `TENANT_IT=1`) — including a regression test that fails against the old OR-fallback logic.

## Slice 0 — the leak this closed

`org:manage-organisation` was already seeded on Paid Subscriber, harmlessly, because nothing checked that key before this. The moment the member-management routes started checking it, every Paid Subscriber — not just Operations Admin — would have gained the ability to manage membership of any org they merely belonged to. Removed from `rolePermMappings["Paid Subscriber"]` in the same PR as the route change; the backfill script strips any already-seeded row on existing installs. Reversed order (enforcing before the fix lands) is a live privilege-escalation window.

## Organisation Settings — branding + operational defaults

Five new columns on `organisation` (`organisationLogoPath`, `organisationColorAccent`, `defaultTimezone`, `defaultCurrency`, `defaultJurisdiction`). **Metadata only** — not wired into `resolveJurisdiction()` or venue timezone resolution, which stay correctly per-`store_location` since a multi-location org can legitimately span jurisdictions. Saved via the existing `PATCH /api/organisations/:id`, extended rather than a new endpoint. Field-update semantics: absent preserves, empty string clears (nullable fields only), a value sets — needed because this route is shared with the pre-existing org-details form and neither form may blow away the other's fields when its own fields are simply absent from a given request.

## Client

`Profile menu → Organisation` (`pages/OrganisationPage.tsx`, gated `RequirePermission anyOf={["org:manage-organisation", "compliance:read-all", "compliance:verify"]}`), three permission-filtered tabs: User Management and Organisation Settings (both require `org:manage-organisation`), and Team Compliance (requires `compliance:read-all` or `compliance:verify` instead — a Paid Subscriber holds those without holding `org:manage-organisation`). Tabs are filtered per-user the same way `SettingsLayout`'s registry filters on a `permission` field, with the same "auth resolves after first render" defence `CompliancePage` originally needed (tab list must never be seeded once via `useState`, since `user` starts null).

Team Compliance was relocated (not duplicated) from the standalone `/compliance` route — that route, its nav entry, and `pages/CompliancePage.tsx` are gone; the content moved into `components/organisation/TeamComplianceSection.tsx`. It never needed the Kitchen Ops location-switcher chrome (`LocationGate`/`KitchenOpsLayout`) it was incidentally wrapped in — compliance data is org-wide, never location-filtered. The old Profile → Team sub-tab was deleted the same way in the same earlier change, not left as a duplicate entry point.

## Backfill

`scripts/backfillOperationsAdminRole.ts` — self-contained (doesn't require `db:seed` to have run), ensures the role + its 26 permission links exist, grants every existing `user_organisation.role = 'admin'` user exactly one `user_role` row (deduped per user, not per org they admin), and carries the Slice 0 cleanup in the same transaction. Idempotent — re-running grants nothing new.
