# OpenRouter Migration Runbook

CulinAIre Kitchen has migrated from direct AI provider keys (Anthropic, OpenAI)
to **OpenRouter** as the unified AI gateway. This document covers the changes,
deployment steps, and rollback procedure.

## What Changed

| Before | After |
|---|---|
| `ANTHROPIC_API_KEY` for chat | `OPENROUTER_API_KEY` for all AI |
| `OPENAI_API_KEY` for embeddings | Embeddings via OpenRouter |
| `GEMINI_API_KEY` for image generation | Image generation via OpenRouter |
| `AI_PROVIDER=anthropic` | Removed — provider is implicit in model ID |
| `AI_MODEL=claude-sonnet-4-20250514` | `AI_MODEL=anthropic/claude-sonnet-4-20250514` |
| Anthropic `web_search_20250305` server tool | Web-search-capable model (e.g. Perplexity Sonar) |
| Image model: `gemini-2.0-flash-exp-image-generation` | `google/gemini-2.5-flash-image` (OpenRouter format) |

**One key for everything:** `OPENROUTER_API_KEY` covers chat, embeddings, web search, and image generation.

## Model ID Format

OpenRouter uses `provider/model-name` format:

| Old format | OpenRouter format |
|---|---|
| `claude-sonnet-4-20250514` | `anthropic/claude-sonnet-4-20250514` |
| `gpt-4o` | `openai/gpt-4o` |
| N/A (was Anthropic server tool) | `perplexity/sonar-pro` (web search) |

Browse available models at https://openrouter.ai/models.

## Environment Variables

### Add
- `OPENROUTER_API_KEY` — Get one at https://openrouter.ai/keys

### Update
- `AI_MODEL` — Change from `claude-sonnet-4-20250514` to `anthropic/claude-sonnet-4-20250514`

### Remove
- `AI_PROVIDER` — No longer read by any code
- `ANTHROPIC_API_KEY` — No longer used (safe to keep, just unused)
- `OPENAI_API_KEY` — No longer used (safe to keep, just unused)
- `GEMINI_API_KEY` — No longer used (image gen now through OpenRouter)

## Production Deployment (Render)

### Pre-deployment
1. Get an OpenRouter API key at https://openrouter.ai/keys
2. Add credit/payment method to your OpenRouter account

### Deploy steps
1. **Add** env var in Render dashboard: `OPENROUTER_API_KEY=sk-or-v1-...`
2. **Update** env var: `AI_MODEL=anthropic/claude-sonnet-4-20250514`
3. **Remove** env var: `AI_PROVIDER`
4. **Deploy** the new code (push to main or trigger manual deploy)
5. **Verify** startup log shows: `AI Model: anthropic/claude-sonnet-4-20250514 (via OpenRouter)`
6. **Test** by sending a chat message through the UI
7. **Optionally remove** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GEMINI_API_KEY` from Render env vars

### Post-deployment
- Configure web search model in admin Settings page (defaults to `perplexity/sonar-pro`)
- Verify image generation still works (uses `GEMINI_API_KEY`, unaffected)

## Local Development

1. Copy `.env.example` to `.env` and fill in `OPENROUTER_API_KEY`
2. Set `AI_MODEL=anthropic/claude-sonnet-4-20250514`
3. Remove `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` from `.env`
4. Run `pnpm install` (picks up removed `@ai-sdk/anthropic` dep)
5. Start normally: `pnpm dev`

## Rollback Procedure

If something goes wrong after deployment:

1. **Revert the code** to the previous commit (before OpenRouter migration)
2. **Restore** env vars:
   - `AI_PROVIDER=anthropic`
   - `AI_MODEL=claude-sonnet-4-20250514` (old format, no provider prefix)
   - `ANTHROPIC_API_KEY=...`
   - `OPENAI_API_KEY=...`
3. **Remove** `OPENROUTER_API_KEY` (optional, harmless to keep)
4. **Redeploy**

The rollback is safe because:
- No database schema changes were made
- The credential table may have an `OPENROUTER_API_KEY` row, which the old code ignores
- Old `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` DB rows still decrypt correctly

## Verification Checklist

- [ ] Chat streaming works (send a message, get a response)
- [ ] Web search works (enable in settings, toggle in chat)
- [ ] Knowledge base search works (ask about a topic in KB)
- [ ] Image generation works (Gemini, unaffected)
- [ ] Integrations page shows `OPENROUTER_API_KEY` field
- [ ] Site Settings shows `Web Search Model` field
- [ ] Startup log shows correct model info
- [ ] Vector search / embeddings work (if enabled)
