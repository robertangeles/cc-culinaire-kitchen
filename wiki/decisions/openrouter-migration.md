---
title: Migrate AI providers to OpenRouter gateway
category: decision
created: 2026-04-29
updated: 2026-04-29
related: [[technical-architecture]], [[data-flow-architecture]]
---

Decision: replace direct provider keys (Anthropic, OpenAI, Gemini) with a single OpenRouter gateway covering chat, embeddings, web search, and image generation.

## Source of truth (full runbook)
Live document: [docs/openrouter-migration.md](../../docs/openrouter-migration.md)

## Status
Migrated.

## What changed
| Before | After |
|---|---|
| `ANTHROPIC_API_KEY` for chat | `OPENROUTER_API_KEY` for all AI |
| `OPENAI_API_KEY` for embeddings | Embeddings via OpenRouter |
| `GEMINI_API_KEY` for image gen | Image gen via OpenRouter (`google/gemini-2.5-flash-image`) |
| `AI_PROVIDER=anthropic` | Removed — provider is implicit in model ID |
| `AI_MODEL=claude-sonnet-4-20250514` | `AI_MODEL=anthropic/claude-sonnet-4-20250514` |
| Anthropic `web_search_20250305` server tool | Web-search-capable model (e.g. `perplexity/sonar-pro`) |

**One key for everything:** `OPENROUTER_API_KEY` covers chat, embeddings, web search, and image generation.

## Model ID format
OpenRouter uses `provider/model-name`. Browse models at https://openrouter.ai/models.

## Env var changes
- **Add** — `OPENROUTER_API_KEY`
- **Update** — `AI_MODEL` (prefix with `provider/`)
- **Remove (safe to leave unused)** — `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`

## Rationale
- One key + one billing surface across chat, embeddings, web search, and image generation
- Frees the model selector in the admin UI from being provider-coupled
- Removes the Anthropic-specific `web_search_20250305` server tool path

## Rollback
See the runbook's "Rollback" section — restore the provider keys, set `AI_MODEL` back to the un-prefixed name, restore `AI_PROVIDER`.

## Related
- [[technical-architecture]]
- [[data-flow-architecture]]
