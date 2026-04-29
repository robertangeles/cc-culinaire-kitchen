---
title: Data Flow Architecture
category: concept
created: 2026-04-29
updated: 2026-04-29
related: [[technical-architecture]], [[culinaire-kitchen-platform]]
---

Visual reference for how requests, server startup, and external services connect. Pairs with [[technical-architecture]] for the textual stack details.

## Source of truth
Live document: [docs/architecture/data-flow-diagrams.md](../../docs/architecture/data-flow-diagrams.md)

## System architecture (top level)
- **Browser (React)** ⇄ **Express API** (HTTP/WS, JSON/SSE) ⇄ **PostgreSQL** (SQL)
- **Express API** also reaches out to External Services: Anthropic / OpenAI (now via OpenRouter), Stripe, Resend, Google / Microsoft OAuth.
- **Knowledge Base** is a file-system asset adjacent to the API server, synced into pgvector at startup.

## Request types
- **HTTP/JSON** — most CRUD routes
- **SSE** — chat streaming (Vercel AI SDK `streamText`)
- **WebSocket** — real-time community chat (The Bench)

## Server startup (visual)
1. Load `.env` (root, via explicit path)
2. Configure Express middleware
3. Mount routes
4. Mount error handler
5. `ensureEncryptionKey()` — env → .env file → generate-and-append fallback
6. `hydrateEnvFromCredentials()` — pull encrypted creds from DB

## Why this matters
Knowledge sync, prompt runtime guard, and credential hydration all happen after env load and before route traffic — order is load-bearing. Breaking it surfaces as 500s on first hit.

## Related
- [[technical-architecture]]
- [[openrouter-migration]]
