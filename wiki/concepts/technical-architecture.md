---
title: Technical Architecture
category: concept
created: 2026-04-29
updated: 2026-04-29
related: [[data-flow-architecture]], [[culinaire-kitchen-platform]], [[mobile-api-contract]]
---

Tech stack, monorepo layout, and server startup order for the CulinAIre Kitchen web app.

## Source of truth
Live document: [docs/architecture/technical-guide.md](../../docs/architecture/technical-guide.md)

## Tech stack at a glance
| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces + Turborepo (pnpm 10, turbo 2) |
| Language | TypeScript 5.7+ (strict) |
| Frontend | React 19 + Vite 6 + Tailwind CSS 4 |
| AI client | `@ai-sdk/react` (useChat) |
| AI server | Vercel AI SDK (`@ai-sdk/anthropic`, `@ai-sdk/openai`) — routed through OpenRouter |
| Backend | Express 5 (ESM) |
| Database | PostgreSQL + Drizzle ORM 0.38 |
| Auth | jsonwebtoken + bcrypt + otplib |
| Email | Resend SDK |
| Payments | Stripe SDK |
| Logging | Pino + pino-pretty |
| Testing | Vitest 3 |
| Validation | Zod |

## Monorepo layout
```
packages/
├── client/          React SPA (@culinaire/client)
├── server/          Express API (@culinaire/server)
└── shared/          Zod schemas & types (@culinaire/shared)
prompts/             System prompt templates (read at runtime)
docs/architecture/   Living architecture docs
tasks/               todo.md, lessons.md
uploads/             Static files (logos, favicons)
```

`client` and `server` both depend on `shared` (`workspace:*`).

## Server startup order
1. `dotenv.config({ path: "../../.env" })` — load env from monorepo root
2. Configure Express (helmet, CORS, JSON, cookies)
3. Mount routes (`/api/auth`, `/api/chat`, …)
4. Mount error handler (must be after routes)
5. `ensureEncryptionKey()` — generates and persists if missing
6. `hydrateEnvFromCredentials()` — loads encrypted credentials from DB into env

See [[data-flow-architecture]] for the diagrammatic version.

## Local dev ports (do not change without confirmation)
- Frontend (Vite): **5179**
- Backend (Express): **3009**

## Related
- [[data-flow-architecture]]
- [[openrouter-migration]] — AI provider routing decision
- [[mobile-api-contract]] — cross-repo API surface for the separate mobile repo
- [[ci-pipeline]] — install → lint → typecheck → test → build on every PR
