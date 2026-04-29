---
title: Prompt System
category: entity
created: 2026-04-29
updated: 2026-04-29
related: [[culinaire-kitchen-platform]], [[duplicate-recipe-refinement-prompt]]
---

The prompt registry, runtime guard, and versioning system that holds every system prompt the platform ships — chatbot persona, Patisserie Lab, Spirits Lab, and recipe refinement.

## Canonical files (do not relocate — read by code at runtime)
| File | Purpose | Version |
|---|---|---|
| [prompts/chatbot/systemPrompt.md](../../prompts/chatbot/systemPrompt.md) | Main CulinAIre chatbot persona, expertise, and style | 1.0 |
| [prompts/chatbot/recipeRefinementPrompt.md](../../prompts/chatbot/recipeRefinementPrompt.md) | Recipe-edit prompt with food-safety rules (canonical) | — |
| [prompts/recipe/patisseriePromptV2.md](../../prompts/recipe/patisseriePromptV2.md) | Patisserie Lab — Executive Pastry Chef persona | 2.0 |
| [prompts/recipe/spiritsPromptV2.md](../../prompts/recipe/spiritsPromptV2.md) | Spirits Lab — Beverage Director persona | 2.0 |
| [prompts/recipe/recipeRefinementPrompt.md](../../prompts/recipe/recipeRefinementPrompt.md) | **Duplicate of canonical, pending cleanup** — see [[duplicate-recipe-refinement-prompt]] |

## Architecture
- **Storage** — markdown files on disk under `prompts/`, with frontmatter for `version`, `domain`, `persona`, etc.
- **Versioning** — admin UI keeps up to 7 historical versions per prompt with rollback (Phase 2 work).
- **Runtime guard** — runtime switch toggle in the admin UI safely flips which prompt body is active (commit `ee19a7d`).
- **On-device prompt fetch** — `GET /api/mobile/prompts/:slug` exposes prompts to the mobile app for on-device Gemma 3n E4B inference (commit `128a119`).
- **Test coverage** — prompt runtime guard + mobile fetch + rate limiter all covered (commit `c263bad`).

## Hard rule
Per CLAUDE.md §"Prompt Management": prompts must never be hardcoded inside application logic. They live in `prompts/` and are loaded by the prompt service.

## Related
- [[culinaire-kitchen-platform]]
- [[duplicate-recipe-refinement-prompt]] — known duplicate file
