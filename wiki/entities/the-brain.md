---
title: The Brain (per-user AI memory)
category: entity
created: 2026-07-05
updated: 2026-07-05
related: [[brain-memory-plan]], [[technical-architecture]], [[single-env-file]]
---

The Brain is CulinAIre's per-user (Phase 2: + per-org) AI memory layer — chat turns are captured, embedded, and recalled into every AI prompt so the assistant already knows this cook and this kitchen.

## What shipped (Phase 1, 2026-07-05)

- **Table**: `brain_memory` (pgvector 1536, NO ANN index — exact cosine over the tenant slice, spec E3). Created via targeted script `packages/server/src/scripts/createBrainMemoryTable.ts` (never drizzle-kit push — lessons #56).
- **Capture**: `brainCaptureService.recordMemory` — never rejects (spec E2), fired as `void` in `conversationController.handleSaveMessages` after each authenticated chat turn. Sanitized/redacted by `brainSanitize` (PII + prompt-injection stripping). Guests never record.
- **Worker**: `brainWorker` — 15s `setInterval` in `index.ts`; `UPDATE … (SELECT … FOR UPDATE SKIP LOCKED)` claim; exponential backoff; terminal `failed` at attempt 3; stale-`processing` reclaim after 10 min.
- **Recall**: `brainRecallService.recallMemoriesWithBudget` — concurrent promise in `streamChat`'s `Promise.all` (2s budget), existence gate before the query embed, exact scan → app-side rank `0.7·sim + 0.2·recency`, top 6 into a `## Brain Memory` block with a trusted-data rule. Falls back to appending when the `{{KITCHEN_CONTEXT}}` placeholder is missing from the admin-edited prompt (lessons #55).
- **Trust signal**: `8:` message annotation `brain_grounded` → `BrainGroundedChip` under the assistant reply (ids + titles only, never bodies).
- **Your Brain page**: `/your-brain` (nav gate + route guard + server `requirePermission`). List/search/expand/delete; warm empty state; "learning…" chip on still-embedding rows.
- **Flags** (site_setting, ship OFF): `brain_enabled`, `brain_capture_enabled`, `brain_recall_enabled`, `brain_nudges_enabled`, `brain_distillation_model`. Rollback = flags off, instant.
- **Permissions**: `brain:read` / `brain:manage`, seeded to all default roles + `backfillBrainPermissions.ts` grants to every existing role (consent baseline: whoever is captured can view/delete).
- **Observability**: structured `alert:"brain_capture_error"` log marker (the T9 alert hook) + `GET /api/brain/stats` (admin) with flags, queue depth, memories/day, capture counters.

## Verified

Live round-trip on local dev: chat turn → captured → embedded (real OpenRouter call) → new conversation → Antoine recalled the prior-session hollandaise fix with the grounded chip. 21 Brain tests incl. the A∦B isolation canary, SKIP LOCKED double-claim, poisoned-row-terminal, upsert semantics; full suites green (server 479, client 42, shared 51).

## Canonical references

- Spec + locked decisions + deviations: `docs/specs/brain-memory.md` (see "Implementation status" appendix)
- Phase 2 next: org tier (`selected_organisation_id`, org-scope recall branch, org canary), ops-event capture, Labs/Copilot recall, rich Your-Brain controls, digests.
