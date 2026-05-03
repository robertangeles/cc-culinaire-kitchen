---
title: Duplicate recipeRefinementPrompt.md — RESOLVED
category: decision
created: 2026-04-29
updated: 2026-05-03
related: [[prompt-system]]
---

**Resolved 2026-05-03.** The duplicate copy at `prompts/recipe/recipeRefinementPrompt.md` was deleted; the canonical copy at `prompts/chatbot/recipeRefinementPrompt.md` is preserved as the runtime fallback that `promptService.loadPromptFromFile()` resolves (it hard-codes `PROMPTS_DIR = prompts/chatbot`).

## Final state
- **Canonical (kept)** — [prompts/chatbot/recipeRefinementPrompt.md](../../prompts/chatbot/recipeRefinementPrompt.md)
- **Dead duplicate (deleted)** — `prompts/recipe/recipeRefinementPrompt.md`

## What was cleaned up at the same time
The recipe-lab cleanup in commit history of 2026-05-03 also removed:
- `prompts/recipe/patisseriePromptV2.md` and `prompts/recipe/spiritsPromptV2.md` — both existed only to feed the one-shot `update-domain-prompts-v2.ts` migration that ran in Phase 9 (March 2026). The migration script itself was deleted alongside the files.
- The `recipePrompts[]` block in `packages/server/src/db/seed.ts` — as of Phase 8 (March 2026) recipe-lab prompts are DB-only and authored through Settings → Mobile → Prompts. The seed code was reading three files that either never existed (`recipePromptV2.md`) or had been deliberately deleted (`patisseriePrompt.md`, `spiritsPrompt.md`).

## Why two copies existed in the first place
The `prompts/chatbot/` copy was the runtime fallback for `loadPromptFromFile`. The `prompts/recipe/` copy was used by `seed.ts` to seed the recipe-lab refinement prompt on a fresh DB. They were byte-identical and would have drifted over time if either was edited in isolation. With recipe-lab seeding removed, only the chatbot copy is needed.

## Related
- [[prompt-system]]
