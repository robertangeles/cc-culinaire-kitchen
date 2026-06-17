---
title: Remove on-device prompt runtime
category: decision
created: 2026-06-17
updated: 2026-06-17
related: [[prompt-system]], [[mobile-api-contract]]
---

The `prompt.runtime` field, the `/api/mobile/prompts/:slug` endpoint, the `PromptIsDeviceOnlyError` server guard, and the related admin UI (runtime toggle, on-device banner) are removed. Every prompt is now server-invoked over OpenRouter; the mobile app calls the same backend chat endpoints as the web app.

## What was removed

- **Schema:** `prompt.runtime` column (`'server' | 'device'`) + its CHECK constraint
- **Server:** `routes/mobilePrompts.ts`, `controllers/mobilePromptsController.ts`, `errors/promptErrors.ts` (`PromptIsDeviceOnlyError`), middleware mapping for 403 device-only responses, `setPromptRuntime` service + `PATCH /:name/runtime` controller, `runtime` field from create/get/list responses
- **Client:** `OnDeviceRuntimeBanner.tsx`, `usePrompt.ts` hook, runtime field + toggle in `PromptsTab.tsx`, runtime references in `usePromptList`, `SettingsLayout`, `SettingsPage`
- **Data:** Two Antoine prompts (`antoine-system-prompt`, `antoine-system-prompt-fr`) deleted via one-shot `scripts/removeAntoineMobilePrompts.ts`
- **Dead one-shot:** `scripts/createFrPlaceholderPrompt.ts` (FR placeholder seeder, now redundant)

## Why

The mobile app pivoted off on-device inference on **2026-06-15** (see `../../cc-culinaire-shared-context/decisions.md` — "Mobile chat moves to the web backend, retiring on-device inference"). Mobile now calls the same backend chat endpoints as the web app and persists conversations server-side. With on-device inference gone:

- The `runtime: 'device'` value no longer has a consumer. Every active prompt is invoked server-side.
- `GET /api/mobile/prompts/:slug` (the endpoint mobile used to fetch on-device prompt bodies) has no caller.
- `PromptIsDeviceOnlyError` — the guard that stopped the server from invoking a device-only prompt — guards nothing.
- The admin runtime toggle and on-device banner expose a choice that no longer matters.

Keeping any of it would be dead code that confuses future readers and shows up in audits.

## Scope NOT changed by this branch

- **Mobile RAG** (`POST /api/mobile/rag/retrieve`) stays. It's used by the new server-side mobile chat flow.
- **Mobile feature flags** (`GET /api/mobile/feature-flags`) stays.
- **Mobile feedback** (`POST /api/mobile/feedback`) stays.
- **Mobile auth + device tokens** stay.

Only the on-device prompt fetch is removed.

## Data cleanup

`scripts/removeAntoineMobilePrompts.ts` deletes both Antoine prompts (active row + factory baseline + linked `prompt_version` rows). Idempotent. Per its own comment, the script is intended to be deleted in the same commit as the cleanup — but to keep this branch reviewable as one diff, it ships alongside the code removal. Delete it in a follow-up after it has been run against prod.

## Rollback

If we ever bring on-device inference back, restore via git rather than re-deriving the surface — the design and the wire format had been carefully worked out. Reference commits:
- `c590fda` (`Add prompt.runtime + server-side guard against device-only prompts`)
- `128a119` (`Add GET /api/mobile/prompts/:slug for on-device prompt fetch`)
- `ee19a7d` (`Admin UI for prompt runtime + safe runtime-switch toggle`)
- `c263bad` (`Test coverage for prompt runtime guard + mobile fetch + rate limiter`)
