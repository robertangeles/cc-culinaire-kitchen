---
title: Prompt System
category: entity
created: 2026-04-29
updated: 2026-05-03
related: [[culinaire-kitchen-platform]], [[mobile-api-contract]]
---

The prompt registry, runtime guard, and versioning system that holds every system prompt the platform ships — chatbot persona, Patisserie Lab, Spirits Lab, and recipe refinement. Storage moved from disk to the database in Phase 8 (March 2026); the on-disk files are now seed material and runtime fallbacks only.

## Canonical storage
- **`prompt` Postgres table** — every active prompt body lives here, with `default_ind=true` for the factory copy and `default_ind=false` for the admin-edited copy. `runtime` is `'server'` or `'device'`.
- **`prompt_version` Postgres table** — up to 7 historical versions per prompt with rollback (Phase 2 work).

## On-disk seed + fallback files
| File | Purpose |
|---|---|
| [prompts/chatbot/systemPrompt.md](../../prompts/chatbot/systemPrompt.md) | Read by `pnpm db:seed` on a fresh DB and by `loadPromptFromFile()` in promptService when no DB row exists. |
| [prompts/chatbot/recipeRefinementPrompt.md](../../prompts/chatbot/recipeRefinementPrompt.md) | Runtime fallback for `recipeRefinementPrompt` when the DB row is missing — only path the runtime fallback can resolve (`PROMPTS_DIR = prompts/chatbot`). |

The Patisserie / Spirits / Recipe Lab prompts are **DB-only** as of Phase 8. They are authored through Settings → Mobile → Prompts.

## Architecture
- **Versioning** — admin UI keeps up to 7 historical versions per prompt with rollback (Phase 2 work).
- **Runtime guard** — runtime switch toggle in the admin UI safely flips which prompt body is active (commit `ee19a7d`).
- **On-device prompt fetch** — `GET /api/mobile/prompts/:slug` exposes prompts to the mobile app for on-device Gemma 3n E4B inference (commit `128a119`).
- **Test coverage** — prompt runtime guard + mobile fetch + rate limiter all covered (commit `c263bad`).

## Hard rule
Per CLAUDE.md §"Prompt Management": prompts must never be hardcoded inside application logic. The DB is the source of truth; fresh deploys seed the chatbot prompts from `prompts/chatbot/` and admins manage everything else through the Settings UI.

## Related
- [[culinaire-kitchen-platform]]
- [[mobile-api-contract]] — `GET /api/mobile/prompts/:slug` exposes prompts to mobile
