# CulinAIre Kitchen — TODO

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

**Phase 1 — user-scope spine (build first):**
- [ ] T1 schema: `brain_memory` (+ nullable org col, `attempt_count`, `next_attempt_dttm`) + `unique(user_id, source_type, source_ref)` + btree indexes, NO ANN; `drizzle-kit push`
- [ ] T2 seed `brain:read`/`brain:manage` + `brain_*` settings (OFF) + `backfillBrainPermissions.ts`
- [ ] T3 `brainSanitize` + unit tests
- [ ] T4 `recordMemory` (chat raw+embed, internal catch, never rejects) + `brainWorker` (SKIP LOCKED claim, `processing`, `attempt_count` backoff)
- [ ] T5 chat capture after `saveMessages` (`void recordMemory(...)`)
- [ ] T6 refactor `streamChat` awaits to `Promise.all` + CRITICAL byte-identical regression test
- [ ] T7 `recallMemories` (exact scan, user-scope, `hasReadyMemory` gate, `sanitizeForPrompt`) spliced into `streamChat`
- [ ] T8 "Your Brain" view/delete route + UI (consent baseline)
- [ ] T9 wire + verify capture-error alert (Phase-1 exit criterion)
- [ ] T10 user-isolation canary (A∦B) + never-rejects test + zero-org test + route auth tests
- [ ] D-T1 `BrainGroundedChip` in chat (trust signal), ships with T7
- [ ] D-T2 `BrainEmptyState` + `MemoryRow` + `ProvenanceChip` + interaction states
- [ ] D-T3 responsive + a11y on the Your-Brain baseline

**Phase 2:** org tier + ops capture + Labs/Copilot recall + rich Your-Brain UI + org-admin mgmt + org digests (T11-T15, D-T4).
**Phase 3:** compaction + nudges + ranking tuning (T16-T18, D-T5).
