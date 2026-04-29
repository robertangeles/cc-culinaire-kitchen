---
title: Duplicate recipeRefinementPrompt.md — pending cleanup
category: decision
created: 2026-04-29
updated: 2026-04-29
related: [[prompt-system]]
---

Two byte-identical copies of the recipe-refinement prompt exist on disk. The canonical location is `prompts/chatbot/`; the `prompts/recipe/` copy is dead and pending removal.

## Files
- **Canonical** — [prompts/chatbot/recipeRefinementPrompt.md](../../prompts/chatbot/recipeRefinementPrompt.md)
- **Dead duplicate** — [prompts/recipe/recipeRefinementPrompt.md](../../prompts/recipe/recipeRefinementPrompt.md)

## Status
Identified 2026-04-29. Not yet deleted (per CLAUDE.md §3, surgical-changes — no removal without confirmation). A cleanup task has been added to [tasks/todo.md](../../tasks/todo.md).

## How to verify before deleting
1. Grep the codebase for any import or fs read referencing `prompts/recipe/recipeRefinementPrompt`.
2. If zero references, delete the `prompts/recipe/` copy.
3. If references exist, update them to point at the `prompts/chatbot/` path and then delete.

## Why it matters
Two copies of the same prompt drift over time — one becomes stale and a future bug is born when the wrong copy is loaded.

## Related
- [[prompt-system]]
