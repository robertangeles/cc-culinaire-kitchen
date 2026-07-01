---
title: Role-Aware Navigation
category: concept
created: 2026-07-01
updated: 2026-07-01
related: [[culinaire-kitchen-platform]], [[store-locations-system]], [[features]]
---

The sidebar is data-driven and permission-filtered so each viewer sees only their tools — a line cook sees the line, an owner sees menu/orders/money. Kitchen-native labels replace the old SaaS naming.

## Why
The old sidebar was grouped by the codebase ("Creative Labs / Kitchen Operations / Community") and showed all 12 items to everyone, despite a full role + 50+ permission system existing in `AuthContext`. It read corporate and un-tailored. This change makes the nav derive from the viewer's permissions and speak in kitchen vernacular.

## How it works
- **Config, not JSX.** `packages/client/src/components/layout/navConfig.ts` defines `NAV_SECTIONS` (items carry `{ id, label, icon, to, gate }`). `filterNav()` drops items the viewer can't see and drops any section left empty (no orphan headers). Pure and unit-tested (`navConfig.test.ts`).
- **Gates.** `guest-ok` (everyone), `auth` (any authenticated non-guest), or `{ anyPermission: [...] }`. Stock Room → `inventory:*`, Ordering → `purchasing:*`, Menu & Costing → `menu:read`, Prep → `prep:manage`, Waste → `waste:read`.
- **Shared check.** `hooks/useHasPermission.ts` reads `permissions[]` from AuthContext; used by both the sidebar filter and the route guard.
- **Real enforcement, not just hiding.** Hiding a nav item is UX only. The three previously `authenticate`-only routes (`/api/menu`, `/api/waste`, `/api/prep`) now also run `requirePermission(...)` server-side, and their client routes are wrapped in `components/auth/RequirePermission` (shows a plain "not on your plan" panel, not a silent redirect). Client is UX; server is the security boundary.

## Permission model note
Default roles are subscription tiers (`Administrator`, `Subscriber`, `Paid Subscriber`), not kitchen positions. All default tiers hold `menu:read` / `waste:read` / `prep:manage` (a solo operator is chef + owner in one). BOH/FOH narrowing happens through **custom roles** an org creates that omit these keys. New keys are seeded in `db/seed.ts`; existing installs are covered by the one-time `scripts/backfillNavPermissions.ts`.

## Administrator is a superuser (implicit all-access)
The `Administrator` role bypasses every permission check — server (`requirePermission` in `middleware/auth.ts`), client route guard (`useHasPermission`), and the sidebar filter (`filterNav`/`isItemVisible` via `roles`). This closes a footgun: previously an admin only had the permissions the seed explicitly granted, so any newly-added permission would silently hide a feature from admins until someone remembered to grant it. Now a new permission never locks admins out. `requireRole` is unchanged (an admin already satisfies `requireRole("Administrator")` naturally). Consequence: to *test* role narrowing you must use a non-admin custom role, because admins see everything regardless of grants.

## Rollout ordering (important)
`backfillNavPermissions.ts` grants the three new keys to **every existing role** so nobody gets a 403 when enforcement lands. It MUST run before the enforcing server code goes live (same window as `db:deploy`). A test-user/role cleanup should run before the backfill so stale accounts don't get grants.

## Also in this change
- Assistant renamed **"Ask Antoine"** in the nav (persona lives in `prompts/chatbot/systemPrompt.md`, currently unnamed/"CulinAIre" — renaming the on-disk persona is a follow-up).
- Group/item renames: Test Kitchen (Recipe/Pastry/Cocktail Lab), Run the Kitchen (My Recipe Book, Stock Room, Ordering, Menu & Costing, Prep, Waste), Community (Community Recipes, The Bench).
- **Location chip** (`components/location/LocationChip.tsx`) surfaces the active kitchen and opens the existing Ctrl+L switcher via a custom event.
- **Per-role landing** (`lib/landing.ts`): admins with `menu:read` land on Menu & Costing; everyone else on chat.

## Explicitly out of scope
Mobile primary nav (the web app is desktop-only by decision; mobile is the separate app's job). See [[culinaire-kitchen-platform]].
