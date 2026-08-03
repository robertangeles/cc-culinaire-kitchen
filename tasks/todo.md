# CulinAIre Kitchen — TODO

## ▶ START HERE — 2026-07-16

Yesterday ended clean: **PR #76 (storage areas B1)** and **PR #77 (cleanup chore)** are both
merged to `main`, CI green, prod schema applied and verified. Nothing is half-finished.

### 1. UAT — `docs/qa/uom-recipe-selling-uat.md`
Sections **A–H** (kitchen-unit model) were never walked; **section I** (storage areas) is new.
The fixture is already seeded — say "re-seed UAT" to reset it.

The one check that matters most, in section I: **move 4 bottles to the Bar and confirm site
stock does NOT change.** That is the entire reason the feature exists. Everything else is
detail.

### 2. Five product decisions (found by the cleanup; flagged, not acted on)
None are urgent. Each is "should this exist?", which is yours to answer, not a lint fix.

| # | What | The decision |
|---|---|---|
| 1 | `DeliveryReceiving.tsx` — 295 lines, now referenced by nothing. The old receiving screen, superseded by `ReceivingChecklist`; receiving lives in Purchasing → ReceiveQueue. | Delete it, or keep as a fallback? |
| 2 | `GET /locations/:locId/activation-status` — no client caller. It fed state nothing rendered (3 wasted round-trips, now removed). Not in any mobile contract. | Delete the endpoint, or was an "112 of 340 items activated" indicator meant to exist? |
| 3 | `PATCH`/`DELETE /consumption-logs/:id` — no client caller since the edit flow went ("Entries are final — no edits"). Server still enforces ownership + a 24h window. Not in any mobile contract. | Delete, or keep deliberately for admin/mobile later? |
| 4 | RecipeLab has **no "start over" control**. `handleReset` existed (cleared the recipe + sessionStorage); nothing called it. | Missing button, or intentional? Most likely a real UX gap. |
| 5 | The **create-organisation form has no address inputs**. It sent 6 address fields that were permanently empty, so every org is created with no address. | Add the inputs, or is address captured elsewhere? |

### 3. Then: B2 — AREA-mode counting
`docs/specs/storage-areas-count-sheets.md`, branch `feature/ck-web/storage-areas-count-sheets`.
**This is the only branch that changes stock writes.** It carries the two critical guards:
- `updateStockLevelsFromSession` must GROUP BY SUM, not upsert per line (last-area-wins would
  silently delete stock).
- The uncounted-area guard, on **both** `submitSessionForReview` AND `checkAndAdvanceSession` —
  they each exclude `NOT_STARTED` by design for cycle counts, which is safe in CATEGORY mode
  and silently deletes stock in AREA mode.

Then **B3** (snapshot, restock list, spot check).

### 4. ✅ DONE 2026-07-16 — Almost French catalog promoted dev → prod
**Done, on ARCHOS.** 332 rows for org 2 (Almost French) copied dev → prod in one
transaction: 112 ingredients + 1 unit_conversion + 94 ingredient_supplier + 115
location_ingredient + 10 stock_level. Prod org-2 counts now equal dev. FK integrity verified
(0 orphans). Turned out cleaner than feared: org 2 and both store_location UUIDs already
existed in prod with matching IDs, so **no ID remapping** was needed — a straight additive
insert. Backup taken first (the FIRST attempt truncated at a timeout, 45 MB vs 65 MB; caught
it, deleted it, re-ran in the background):
`~/culinaire-prod-backups/culinaire_prod_full_2026-07-16_201717.dump` (65 MB, pg_restore
--list verified). Comfort Spoon (org 1) already matched (55=55).

### 5. ✅ DONE 2026-07-16 — ARCHOS dev-vs-prod comparison (this was the same gap)
Ran the read-only comparison on ARCHOS. The only real dev-only data was Almost French's
catalog — which is item 4 above, now promoted. Also found and **deleted a test-leak org**
from ARCHOS dev: `uomit_1784021481913-org` (id 150) + its user (403) + 4 ingredients + 1
location + 2 consumption_log rows, leaked by `uomAndSelling.integration.test.ts` when an
afterAll failed partway (same leak class fixed in the storage-areas suite this session).
Dev ingredient total went 171 → 167; dev and prod now match (167 each).
- Context: `DEV_ENVIRONMENT` in `.env` marks the current machine. See agent memory
  `dev-machine-topology`.
- Open follow-up: the UOM integration test's afterAll should be hardened the same way the
  storage-areas one was (filter unset ids, per-step try/catch) so it stops leaking.

---

_Last updated: 2026-04-22. Reflects actual codebase state, not aspirational._

> **Feature Catalog:** the complete "what exists now" feature list lives in the wiki at [`wiki/synthesis/features.md`](../wiki/synthesis/features.md). When you ship, change, or remove a feature, update that catalog (and bump its `updated:` date) as part of the work — this TODO tracks *what's planned*, the catalog tracks *what's built*.

---

## Completed

### Phase 1 — Core Chat
- [x] Project scaffolding (pnpm monorepo, Turborepo)
- [x] Culinary Knowledge Chatbot UI (React 19 + Vite)
- [x] AI service with Vercel AI SDK (streamText, useChat)
- [x] Knowledge base content (techniques, pastry, spirits, ingredients)
- [x] System and technique prompt templates
- [x] Database with Drizzle ORM (PostgreSQL on Render)

### Phase 2 — Settings, History, Appearance
- [x] Prompt versioning (7 max, rollback, version history UI)
- [x] Chat/Conversation history (persist, sidebar list, continue)
- [x] Site Settings tab (page title, meta, favicon/logo upload, footer text)
- [x] Appearance tab (chat window width + height)
- [x] Dynamic sidebar branding (logo + page_title, clickable to home)
- [x] Upload image preview fix (Vite proxy for /uploads)

### Phase 3 — Auth, Roles, Profile
- [x] Authentication with Better Auth (JWT + httpOnly cookies)
- [x] RBAC: Roles (Administrator, User, Chef) + granular permissions
- [x] Profile page (Account, Password, Organisation tabs)
- [x] Avatar upload + crop/resize (react-easy-crop, canvas blob upload)
- [x] Organisation create/join with CULINAIRE-prefixed keys
- [x] Encrypted credentials management (Integrations tab)
- [x] Stripe integration (subscription tiers, webhooks)
- [x] MFA with TOTP (otplib)
- [x] OAuth (Google) login

### Phase 4 — User Management + Polish
- [x] Multi-prompt management (dynamic prompts, auto-generated keys)
- [x] Integrations tab (sub-tabs by category, per-prompt model selector)
- [x] User management table (search, pagination, role assignment)
- [x] User detail slide-over (account info, email, delete, auto-save)
- [x] User deletion with cascade
- [x] Direct email to users via Resend
- [x] ARIA attributes + keyboard navigation across all tabbed interfaces
- [x] JSDoc standardization across controllers and services

### Phase 5 — Auth Hardening + Infrastructure
- [x] Chat-specific rate limiting (express-rate-limit)
- [x] Forgot password flow (1hr token, one-time use)
- [x] Profile address fields + bio
- [x] PII encryption (separate keys, dual-write migration, hash-for-lookup)
- [x] SEO (sitemap.xml, robots.txt, Open Graph, JSON-LD, canonical URLs)
- [x] Guest mode (sessions, usage limits, guest-to-user conversion)
- [x] Web search toggle (Anthropic web_search tool via SSE transformer)
- [x] IP-based anti-abuse (3 sessions/IP, server-side token generation)
- [x] Token refresh hardening (12min interval, retry logic, sameSite: lax)
- [x] Credential reveal endpoint (GET /api/credentials/:key/reveal, audit logged)

### Phase 6 — Knowledge Expansion + Creative Labs
- [x] pgvector knowledge store (knowledge_document + IVFFlat index)
- [x] Knowledge sync on startup (SHA-256 hash check + embedding)
- [x] Vector search with keyword fallback (text-embedding-3-small)
- [x] Kitchen profile (4-step onboarding wizard, injected into AI system prompt)
- [x] Recipe Lab — recipe generation with hero image (recipes domain)
- [x] Patisserie Lab (patisserie domain)
- [x] Spirits Lab (spirits domain)
- [x] Recipe persistence, versioning, ratings, reviews
- [x] My Shelf + Kitchen Shelf (public gallery) + recipe detail page
- [x] Recipe edit, refine, image regeneration end-to-end
- [x] Load More pagination for My Shelf + Kitchen Shelf

### Phase 7 — Store Locations + Multi-Location
- [x] Store Locations (CRUD, hours, settings per location)
- [x] Multi-location staff assignment (userStoreLocation)
- [x] Location context — AI and ops modules scoped to active location
- [x] Location-gated routes (Inventory, Purchasing, Kitchen Ops, Waste, Menu)

### Phase 8 — OpenRouter + AI Configuration
- [x] Migrate all AI providers to OpenRouter unified gateway
- [x] Per-prompt model selector in admin Integrations tab
- [x] AI Configuration panel (model options, provider routing)

### Phase 9 — Intelligence Suite
- [x] Menu Intelligence — menu item management, analysis, recommendations
- [x] Import recipes into Menu Intelligence
- [x] Kitchen Copilot — menu-driven prep workflow with prep sessions and tasks
- [x] Waste Intelligence — waste logging, analytics, digest
- [x] User Guide system — contextual help sidebar for Intelligence Suite
- [x] Weekly digest for waste

### Phase 10 — The Bench (Community)
- [x] Bench channels, messages, reactions, mentions, pins
- [x] Direct message threads
- [x] Real-time WebSocket (benchSocketService)
- [x] Full dark UI

### Phase 11 — Inventory System (Waves 1–5)
- [x] Ingredient catalog (types, suppliers, allergens, par levels, cost)
- [x] Multi-supplier per item, supplier operational fields
- [x] Stock take — location dashboard, opening count, cycle count vs full
- [x] HQ review (approve / flag stock take sessions)
- [x] Offline sync + unit tests
- [x] Wave 2: Stock transfers + item transaction history (calendar view)
- [x] Wave 3–5: Purchase Orders, inter-location transfers, AI forecasting
- [x] Transfer UX — expandable rows, category pickers, return to stock
- [x] FIFO batch tracking, consumption logs, spend thresholds, forecast recommendations

### Phase 12 — Purchasing & Receiving
- [x] Purchase Orders (create, approve, multi-location)
- [x] Receiving sessions — line-by-line receiving against POs
- [x] Discrepancies with photo evidence
- [x] Credit notes
- [x] Sidebar nav restructure for Kitchen Operations
- [x] Playwright E2E suite for Purchasing & Receiving harness

### Phase 12c — Kitchen-unit model + recipe-based selling (branch `feature/ck-web/uom-and-recipe-selling`)
- [x] **Kitchen units**: every item counted in ONE unit (`base_unit` — wine: bottle via `changeKitchenUnit` migration, 17 items flipped); content equivalence (1 bottle = 750 mL) for recipe lines; purchase packaging (`purchase_unit` + `pack_qty`) converts only at ordering/receiving (qty + cost)
- [x] One `resolveToBase` resolver (base → packaging → row (D9) → content ÷ → family → throw) at every flow; `consumption_log.base_qty` for safe aggregation
- [x] **Two pre-existing bugs fixed**: legacy PO `receiveLine` added raw qty (no conversion); consumption summaries summed mixed units
- [x] `sale` header + `recordSale` (preflight/commit, org boundary) → fractional kitchen-unit depletion feeding yield variance; `voidSale`; idempotency; two-phase CSV (per-row-content keys)
- [x] FOH consumables sell **directly** (hidden auto 1:1 link); op supplies manual-log only
- [x] Item setup = Counted in / Contains / Purchased as; PO in packaging units w/ per-case cost; auto-PO suggests whole packages; 31-case real-DB E2E (`UOM_IT=1`). See [[uom-and-recipe-selling]], `docs/qa/uom-recipe-selling-uat.md`
- [ ] Follow-up (backlog, named in the plan): per-order supply allowance; prep-as-stock; central-kitchen BOM; live POS adapter; true FIFO/FEFO layer depletion (whole-app); density conversions

### Phase 13 — Landing + Admin UX
- [x] Public landing page
- [x] Kitchen profile accordion in admin settings
- [x] Admin settings UX overhaul

### Phase 14 — Mobile + Notifications
- [x] Mobile client authentication (device token support)
- [x] Notification service + push notifications
- [x] Device token table

---

## Up Next

_Nothing confirmed outstanding. New work to be defined._

### Cleanup
- [x] Remove duplicate prompt file `prompts/recipe/recipeRefinementPrompt.md` (resolved 2026-05-03 — canonical at `prompts/chatbot/recipeRefinementPrompt.md` is preserved as the runtime fallback; recipe-lab prompts are DB-only since Phase 8). See `wiki/decisions/duplicate-recipe-refinement-prompt.md`.
- [x] Install eslint + flat config + per-package overrides (resolved 2026-06-01 — eslint v10, typescript-eslint, react-hooks, react-refresh. Root eslint.config.js with per-package overrides. All rules start as warnings. Lint step re-enabled in CI).
- [x] Configure GitHub branch protection on `main` (resolved 2026-06-01 — CI check `ci / Typecheck, test, build` now required before merge via GitHub API).

### Candidates (not started)
- [x] **Fix JWT secret module-load capture** (resolved 2026-06-19, branch `fix/ck-web/supplier-read-gating`'s follow-up `fix/ck-web/jwt-secret-module-load`) — converted `ACCESS_SECRET`/`MFA_SESSION_SECRET` to call-time getters; removed dead `REFRESH_SECRET`. Verified live (real DEV secret → 200, old fallback → 401) + regression test in `authService.test.ts`. See lessons.md #53.
- [ ] Purchasing v2 — supplier invoice reconciliation against credit notes
- [ ] Waste Intelligence v2 — AI root cause suggestions, cost impact per item
- [ ] Menu Intelligence v2 — margin analysis, engineering matrix (star/plow/puzzle/dog)
- [ ] Recipe Lab social sharing (share to Bench, community reactions)
- [ ] Mobile app (React Native or PWA shell wrapping existing web)
- [ ] Analytics dashboard (fact_usage star schema — defined in DB standards, not yet built)
- [ ] Onboarding improvements (guided first-run for new orgs)
- [ ] Drizzle-kit migration strategy for Neon (idempotent scripts established in lessons.md #45)

---

## Future Modules (Backlog)
- [ ] Culinary Ratio Engine
- [ ] Food Cost Calculator (per dish, per menu)
- [ ] Supplier portal (external supplier access to POs)
- [ ] Compliance / HACCP logging
- [ ] Rostering / Staff scheduling

---

## The Brain — per-user + per-org AI memory (APPROVED, ready to build)

Canonical plan: **`docs/specs/brain-memory.md`** (CEO + Eng + Design reviewed, 2026-07-04). "Brief me on the current plan" → read that file.

Build on `feature/ck-web/brain-spine`, verify against a local DB, then commit/push/merge per CLAUDE.md.

**Phase 1 — user-scope spine (SHIPPED 2026-07-05, branch `feature/ck-web/brain-spine`):**
- [x] T1 schema: `brain_memory` (+ nullable org col, `attempt_count`, `next_attempt_dttm`) + `unique(user_id, source_type, source_ref)` + btree indexes, NO ANN — via targeted `scripts/createBrainMemoryTable.ts` (NOT drizzle-kit push, per lessons #52/#54)
- [x] T2 seed `brain:read`/`brain:manage` + `brain_*` settings (OFF) + `backfillBrainPermissions.ts`
- [x] T3 `brainSanitize` + unit tests (14)
- [x] T4 `recordMemory` (chat raw+embed, internal catch, never rejects) + `brainWorker` (SKIP LOCKED claim, `processing`, `attempt_count` backoff, terminal failed at 3, stale-claim recovery)
- [x] T5 chat capture after `saveMessages` (`void recordMemory(...)`, authenticated users only)
- [x] T6 refactor `streamChat` awaits to `Promise.all` + CRITICAL byte-identical regression test
- [x] T7 `recallMemories` (exact scan, user-scope, `hasReadyMemory` gate, `sanitizeForPrompt`, 2s budget) spliced into `streamChat` — verified LIVE (Antoine recalled a prior-session hollandaise fix)
- [x] T8 "Your Brain" view/delete route + UI (consent baseline) — routes curl-verified 200/400/401/403/404
- [x] T9 capture-error alert marker (`alert:"brain_capture_error"` structured log) + `GET /api/brain/stats` admin snapshot (flags, queue depth, memories/day, capture counters)
- [x] T10 user-isolation canary (A∦B) + never-rejects test + zero-org test + route auth tests (21 tests)
- [x] D-T1 `BrainGroundedChip` in chat (trust signal, `8:` message annotation), ships with T7
- [x] D-T2 `BrainEmptyState` + `MemoryRow` + `ProvenanceChip` + interaction states (learning chip, skeleton, retry, warm empty)
- [x] D-T3 responsive (375px walkthrough) + a11y (aria-expanded, focus rings, reduced-motion, ≥44px targets)

See "Implementation status" appendix in `docs/specs/brain-memory.md` for the 5 documented deviations + prod rollout checklist.

**Phase 2:** org tier + ops capture + Labs/Copilot recall + rich Your-Brain UI + org-admin mgmt + org digests (T11-T15, D-T4).
**Phase 3:** compaction + nudges + ranking tuning (T16-T18, D-T5).

---

## Storage Areas — post-v1 backlog (deferred 2026-07-15, CEO review)

Context: v1 ships storage areas as count sheets (industry pattern: one venue stock number;
areas organize the stocktake walk, hold per-area pars, snapshots from counts, zero-sum
movement log). Plan: `~/.claude/plans/storage-areas-count-sheets.md`. These three were
considered and deliberately deferred:

- [ ] **"Counted + moved since" snapshot arithmetic** — show `Bar: 5 (counted Mon) +4 moved in since`
  next to the count-date snapshot. Deferred: keeps snapshots honest-simple; build only if
  operators say the count-date figure goes stale too fast between counts. Effort S.
- [ ] **Per-area variance analytics** — bar shrinkage vs cellar shrinkage from area-tagged count
  lines + movements. Mid-market feature; needs several count cycles of data first. The v1
  schema (storage_area, area-tagged stock_take_line, stock_movement) is the exact foundation.
  Effort M.
- [ ] **Receive deliveries directly into an area** — optional to-area on receiving so the snapshot
  reflects where the delivery was shelved. Deferred: receiving already converts pack→kitchen
  units at the boundary; adding area routing before areas are habitual invites wrong data.
  Effort S-M.

---

## ⏸ RESUME HERE (parked 2026-07-15) — mid-B1 on `feature/ck-web/storage-areas-and-movements`

PR #75 (kitchen-unit model + recipe selling) is MERGED. Eng review of the storage-areas spec
is DONE and the spec is hardened — `docs/specs/storage-areas-count-sheets.md` is now the
source of truth and is CEO + ENG CLEARED, zero unresolved decisions. **Read it before
anything else.** It ships as THREE sequential branches (see its Build order table).

**B1 `feature/ck-web/storage-areas-and-movements` — IN PROGRESS (2 commits, not pushed)**
- ✅ T8: `itemType` added to `LocationIngredient` (`useInventory.ts:50`). Server already
  selected it; the gap was client-only.
- ✅ Guardrail: move-not-usage intercept in `ConsumptionLogger.tsx` + 6 tests (verified
  non-vacuous). Client tsc/tests/build all green.
- ⬜ **NEXT: `stock_movement` + `storage_area` + `ingredient_storage_area` schema**
  (`migrateStorageAreas.sql`, step 1a — drizzle-kit push is blocked by pre-existing
  bench_channel drift, so apply with `psql "$DEV_DATABASE_URL" -f`).
- ⬜ `storageAreaService` + `stockMovementService` + routes + tests.
- ⬜ Then wire the modal's **[Record as movement]** button — it's intentionally absent until
  a movement path exists; the modal only offers "Go back" today.
- ⬜ Areas admin as a NEW TOP-LEVEL `areas` tab in `InventoryPage.tsx:47-56` (there are no
  sub-tabs in Stock Room — the spec's original "sub-tab" wording was wrong).

**Then B2** (AREA-mode counting — the only branch that writes stock; carries the two CRITICAL
guards: GROUP BY SUM instead of per-line upsert, AND the uncounted-area guard on BOTH
`submitSessionForReview` and `checkAndAdvanceSession`). **Then B3** (snapshot/restock/spot check).

**Chore — DONE 2026-07-16** (`chore/ck-web/unused-vars-sweep`). 166 unused vars → **0**,
rule flipped to `error` so it can't regrow. Catch-all 404 route added. What the triage
turned up (the value was never the lint count):
- **Two that must never be "cleaned"**: `userService.ts` omit-secrets destructure (deleting
  those names returns the password hash + MFA secret) and `wacService` `SELECT FOR UPDATE`
  (the query IS the lock). Both now marked `_` with the reason inline.
- **A missing test restore**: authController.test captured `originalEnv` for an `afterEach`
  nobody wrote — the suite left `process.env` mutated for later tests. Added.
- **A test that didn't test**: recipeService.test captured the AI system prompt and never
  asserted on it.
- **Wasted work removed**: 3 `activation-status` round-trips feeding write-only state, a
  `useSuppliers()` fetch never read, a reduce over every stock-take category that wasn't
  returned, a filter that ran every render and rendered nowhere.
- **Dead API promises**: `markOrdered(…, poId?)` (no column exists to link a PO),
  `markMentionsRead(…, channelId?)` (never in the WHERE — the first caller to pass it
  would silently mark every channel read).
- **Unreachable UI**: ConsumptionLogger's whole inline-edit flow (":742 Entries are final"),
  PurchaseOrderList's pre-"receive-new" branch.

**Still open, needs a product call (flagged, not deleted):**
- `DeliveryReceiving.tsx` (295 lines) is now referenced by nothing — superseded by
  `ReceivingChecklist`. Delete it, or is it coming back?
- `GET /locations/:locId/activation-status` now has no client caller.
- `PATCH`/`DELETE /consumption-logs/:id` have no client caller since the edit flow went.
- RecipeLab has no "start over" control (the reset function existed, nothing called it).
- No org-address inputs on the create-organisation form (the payload fields were dead).

Afterwards:
1. **Extend the UAT doc** with section **I. Storage areas** (area counts sum to venue; movement
   log zero stock effect; guardrail intercepts FOH usage of sellable items; spot check never
   adjusts site stock) and re-seed fixture: Patisserie areas Stock Room + Bar, Shiraz assigned
   to both with bar par 6.
2. **Finish UAT sections A–H** for the kitchen-unit model (section A partially walked, B–H
   untested), then sign off.

Also uncommitted on purpose: `data/imports/` (supplier catalog import batches — separate
workstream, keep out of this feature branch).

## AI-Native Purchasing — deferred from eng-review (2026-07-20)
- **P2** AI-suggest-par from usage (blocked on real consumption_log/depletion history)
- **P2** order-from-stocktake (one-tap draft PO from last count; add multi-group guard)
- **P2** price memory + change alerts; supplier-minimum already in P1
- **P3** natural-language ordering; invoice/credit-note OCR reconciliation
- **P2** server-side catalog search/pagination (catalog is now a fallback)
- **P2** cross-supplier order guides (schema is forward-compatible)
