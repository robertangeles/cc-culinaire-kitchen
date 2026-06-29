---
title: Feature Catalog
category: synthesis
created: 2026-06-29
updated: 2026-06-29
related: [[culinaire-kitchen-platform]], [[project-status]], [[store-locations-system]], [[prompt-system]]
---

Living catalog of every user-facing feature in CulinAIre Kitchen, grouped by the four product lobes plus the platform layer beneath them. Keep this current: when a feature is built, changed, or removed, update the relevant section and bump `updated:`. For the *delivery* timeline (which phase shipped what), see [[project-status]] — this page is the *what exists now* view.

Verified against client routes/components (`packages/client/src`) and server routes/services (`packages/server/src`) as of 2026-06-29.

---

## 1. Chat Assistant
The founding module — a culinary knowledge chatbot grounded in curated content. Routes: `/chat/new`, `/chat/:id`.

- **Streaming chat** with multi-turn dialogue and typing indicators
- **Conversation history** — persisted sessions, titles, browse/resume
- **RAG grounding** — vector search (pgvector + embeddings) over the curated Knowledge Base, with keyword fallback
- **Tool use** — knowledge search, document read, optional web search (Perplexity Sonar via OpenRouter)
- **Image generation** inline in chat
- **Guest mode** — limited free credits without an account
- Rate limited (20 req/min per user/guest)

---

## 2. Creative Labs
R&D space for developing new dishes, pastries, and cocktails. Each lab has a domain-tailored form and output schema.

### Recipe Lab (`/recipes`)
- AI recipe generation (cuisine, difficulty Home Cook → Master, dietary, servings, ingredients)
- Hero image generation
- Two-column recipe display (ingredients + method), wine pairings, nutrition, flavor scores, yields
- Ratings & reviews, public/private toggle, share bar
- **Version history** with rollback, AI-powered refine panel

### Patisserie Lab (`/patisserie`)
- Pastry-specific generation (pastry type/style, key technique, component count, occasion)
- Difficulty progression Home Baker → Master Pâtissier

### Spirits Lab (`/spirits`)
- Cocktail/mocktail generation (spirit base, flavour profile, venue type, IBA drink family, season)
- Alcoholic / non-alcoholic toggle

---

## 3. Kitchen Operations
The running-a-kitchen toolkit (authenticated, location-scoped). See [[store-locations-system]] for the multi-location model.

### My Recipe Book (`/my-shelf`)
- Personal recipe collection, domain filter (Culinary/Patisserie/Spirits), search, archive, visibility toggle

### Stock Room — Inventory (`/inventory`)
- **Dashboard** with AI forecasting & consumption trends
- **Setup/Activation wizard** + opening inventory
- **Stock takes** — session-based counts, smart keypad, HQ review/approval queue
- **Transfers** — consumption logging + inter-location transfers (sent → received)
- **Catalog** (admin) — master ingredient catalog, unit conversions, ingredient aliases, catalog request queue
- **Suppliers** — multi-supplier per ingredient
- FIFO batch tracking, optimistic-locking stock math, transaction history

### Purchasing & Receiving (`/purchasing`)
- **Purchase orders** — full lifecycle: Draft → Pending Approval → Sent → Receiving → Received/Partial
- **Auto-PO suggestions** — demand-driven reorder engine
- **Receiving** — line-by-line with photo evidence and discrepancy detection
- **Credit notes** — issuance & reconciliation
- **Approval workflow** (admin) with configurable spend thresholds
- Supplier management & performance

### Menu Intelligence (`/menu-intelligence`)
- Menu item CRUD with automatic ingredient costing
- **Menu engineering matrix** — Star / Plowhorse / Puzzle / Dog classification
- Food cost %, contribution margin, P&L per item, yield variance
- Allergen badges, category profitability targets, CSV bulk upload
- Waste-impact cross-reference

### Kitchen Copilot — Mise en Place (`/kitchen-copilot`)
- Session-based prep planning driven by menu/cover forecasts
- Task generation, prioritization, station assignment, status tracking
- **Cross-usage view** (multi-dish ingredient optimization) + high-impact view
- Prep history & analytics, overprep detection

### Waste Intelligence (`/waste-intelligence`)
- Waste logging by ingredient/category/reason
- Dashboard analytics with cost impact + trends
- **AI reuse suggestions** for repurposing waste
- Team vs. personal scope, weekly waste digest

---

## 4. Community

### CulinAIre Recipe Book (`/kitchen-shelf`)
- Public recipe gallery (no auth), masonry grid, domain filter, search
- Ratings, view counts, creator profile cards + social links, detail view

### The Bench — real-time chat (`/bench`)
- **Everyone** (global), **My Kitchen** (org-private), **Messages** (DMs)
- Socket.IO live messaging, presence bar, typing indicators
- Reactions, mentions/unread tracking, pinning, full-text search
- DM threads with notification toasts, guest read-only access

---

## 5. Accounts, Profile & Multi-Location

- **Auth** — email/password, Google OAuth, email verification, forgot/reset password, **TOTP MFA**, guest tokens
- **Profile** — edit details, photo upload + crop, change password, social links, bio
- **Organisations** — create/join via invite key, member roster, role assignment
- **Store locations** — CRUD, staff assignment, operating hours, location pulse, multi-location data isolation (Ctrl+L switcher, location gate)
- **Roles & permissions** — built-in roles (Administrator, Chef, User) + custom roles; 50+ granular permissions (`inventory:*`, `purchasing:*`, `admin:*`)
- **Subscriptions** — Stripe checkout, status, cancel, customer portal; free-session usage tracking

---

## 6. Settings & Administration

- **Site Settings** — branding (logo, title, favicon, footer), SEO
- **Appearance** — theme & color schemes
- **Prompts** — registry with 7-deep version history, rollback, factory reset, per-prompt model (see [[prompt-system]])
- **Knowledge Base** — ingest via file / URL / manual entry, embedding lifecycle, source privacy
- **AI Model Config** — enable/disable models from OpenRouter catalog
- **Integrations** — encrypted credential storage with reveal audit logging
- **User Management** — list/search, suspend, role assignment, invites
- **Roles** — custom role + permission editor
- **Pages** — editable public pages (Terms, Privacy, Delete Account, custom slugs; web/mobile variants)
- **The Bench admin** — channel banners, guidelines
- **User Guide / Help** — contextual help sidebar per module
- **Personalisation options** — kitchen-profile onboarding (skill, dietary, equipment)

---

## 7. Platform & Cross-Cutting

- **Notifications** — in-app + email (approval required, PO approved/rejected, discrepancy, delivery overdue); push device tokens
- **Email** (Resend) — verification, password reset, recipe export, purchasing alerts
- **Mobile support** — RAG endpoint, feature flags, feedback (mobile client lives in a separate repo; see [[mobile-api-contract]])
- **Public/marketing** — landing page, sitemap, legal pages
- **Security** — PII encryption at rest, hash-for-lookup, per-route auth/role/permission middleware, rate limiting, audit logging

---

## At a glance
~32 backend route domains, 60+ services, 8 distinct AI features (streaming chat, vector RAG, recipe generation, refinement, web search, image gen, waste suggestions, forecasting), 4 auth methods, 5 external integrations (OpenRouter, Google, Stripe, Resend, file uploads).
