---
title: Project Status
category: synthesis
created: 2026-04-29
updated: 2026-04-29
related: [[lessons-index]], [[culinaire-kitchen-platform]]
---

Snapshot of what has shipped and what is up next, summarised from `tasks/todo.md` (last updated 2026-04-22 in that file). Treat the live `tasks/todo.md` as authoritative.

## Source of truth
Live document: [tasks/todo.md](../../tasks/todo.md)

## Shipped phases (high-level)
- **Phase 1 — Core Chat** — pnpm monorepo scaffolding, chatbot UI, AI service via Vercel AI SDK, knowledge base seeding, system + technique prompts, Drizzle + PostgreSQL.
- **Phase 2 — Settings, History, Appearance** — prompt versioning (7-deep with rollback), conversation history sidebar, site settings (title/meta/favicon/logo/footer), appearance tab, branding, upload preview proxy.
- **Phase 3 — Auth, Roles, Profile** — Better Auth (JWT + httpOnly), RBAC (Administrator / User / Chef + granular perms), profile + avatar crop, Organisation create/join with `CULINAIRE-` keys, encrypted credentials, Stripe subscriptions, TOTP MFA, Google OAuth.
- **Phase 4 — User Management + Polish** — multi-prompt management, integrations sub-tabs + per-prompt model selector, user table with search/pagination/role assignment, user detail slide-over, cascade deletion, direct email via Resend, ARIA + keyboard nav, JSDoc.
- **Phase 5 — Auth Hardening + Infrastructure** — chat rate limiting, forgot-password (1hr token), profile address/bio, PII encryption with hash-for-lookup, SEO (sitemap, robots, OG, JSON-LD, canonical), guest mode + IP anti-abuse, web search toggle, token refresh hardening, credential reveal endpoint with audit.
- **Phase 6 — Knowledge Expansion + Creative Labs** — pgvector knowledge store with IVFFlat, SHA-256 sync on startup, vector search with keyword fallback, kitchen-profile onboarding wizard injected into the AI system prompt, Recipe / Patisserie / Spirits Labs with hero-image generation, recipe persistence + versioning + ratings + reviews, My Shelf + Kitchen Shelf, edit/refine/image-regen, Load More pagination.
- **Phase 7 — Store Locations + Multi-Location** — Store Locations CRUD with hours and per-location settings, staff assignment, AI + ops modules scoped to active location, location-gated routes for Inventory / Purchasing / Kitchen Ops / Waste / Menu.
- **Phase 8 — OpenRouter + AI Configuration** — unified OpenRouter gateway, per-prompt model selector in admin, AI Configuration panel.
- **Phase 9 — Intelligence Suite** — Menu Intelligence with import + analysis + recommendations, Kitchen Copilot with prep sessions and tasks, Waste Intelligence with weekly digest, User Guide contextual help.
- **Phase 10 — The Bench (Community)** — channels, messages, reactions, mentions, pins, DMs, real-time WebSocket, full dark UI.
- **Phase 11 — Inventory System (Waves 1–5)** — ingredient catalog, multi-supplier, stock take with HQ review, offline sync, transfers, FIFO batch tracking, consumption logs, spend thresholds, AI forecast recommendations.
- **Phase 12 — Purchasing & Receiving** — POs with approval, line-by-line receiving, discrepancies with photo evidence, credit notes, Kitchen Ops sidebar restructure, Playwright E2E harness.
- **Phase 13 — Landing + Admin UX** — public landing page, kitchen profile accordion, admin settings overhaul.
- **Phase 14 — Mobile + Notifications** — mobile client auth (device tokens), notification service + push, device token table.

## Up Next (per `tasks/todo.md`)
> "Nothing confirmed outstanding. New work to be defined."

**Candidates (not started):** Purchasing v2 supplier-invoice reconciliation · Waste Intelligence v2 (AI root cause + cost impact) · Menu Intelligence v2 (margin analysis, engineering matrix) · Recipe Lab social sharing to Bench · Mobile app (React Native or PWA shell) · Analytics dashboard on the `fact_usage` star schema · Onboarding improvements · Drizzle-kit migration strategy for Neon.

**Future backlog:** Culinary Ratio Engine · Food Cost Calculator · Supplier portal · HACCP logging · Rostering.

## Recent commits worth remembering (from `git log`)
- `7d876d4` — Merge antoine-prompt-tests
- `c263bad` — Test coverage for prompt runtime guard + mobile fetch + rate limiter
- `ee19a7d` — Admin UI for prompt runtime + safe runtime-switch toggle
- `128a119` — `GET /api/mobile/prompts/:slug` for on-device prompt fetch (ties into the separate mobile repo's on-device Gemma 3n E4B)

## Open pieces flagged here
- Duplicate prompt file pending cleanup — [[duplicate-recipe-refinement-prompt]]
- Mobile app lives in a separate repo; cross-repo coordination required when API contracts change.

## Related
- [[lessons-index]]
- [[culinaire-kitchen-platform]]
