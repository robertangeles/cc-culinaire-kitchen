---
title: Brain Memory Plan
category: concept
created: 2026-07-04
updated: 2026-07-04
related: [[culinaire-kitchen-platform]], [[technical-architecture]], [[data-flow-architecture]]
---

The approved, fully-reviewed implementation plan for **the Brain** — a per-user + per-org AI memory layer that records chat + curated kitchen-ops events and injects relevant history into every AI surface.

## Where the plan lives

Full spec: **[docs/specs/brain-memory.md](../../docs/specs/brain-memory.md)**. That file is the canonical, resume-ready plan. When asked to "brief me on the current plan", show it.

## One-paragraph summary

Native pgvector, single service (no external gbrain). Two-tier scope: user-private + org-shared, with an explicit active-org. One `recordMemory()` capture interface (chat stored raw+embed; ops distilled via a cheap model). **Recall is an exact cosine scan over the tenant-filtered slice — no ANN index** (a filtered HNSW would silently under-recall). `recordMemory` never rejects; the worker claims rows with `FOR UPDATE SKIP LOCKED` + `attempt_count` backoff. Everything flag-gated (`brain_*` site_settings, OFF by default). Recall surfaces a subtle "grounded in your Brain" trust chip in chat.

## Phasing

- **Phase 1 (spine, build first):** user-scope chat memory, exact-scan recall in chat, "Your Brain" view/delete baseline + trust chip, user-isolation canary, flags/perms. Tasks T1-T10 + D-T1..D-T3.
- **Phase 2:** org tier (selector, org-canary, org-inherit), ops capture, Labs/Copilot recall, rich "Your Brain" UI + org-admin management, org digests.
- **Phase 3:** compaction, proactive nudges, ranking tuning.

## Reviews absorbed

CEO (SELECTIVE EXPANSION), Eng (exact-scan recall, `recordMemory` containment, worker backoff), Design (trust chip, scope-tab IA, dismissible nudge slot). Two independent outside-voice passes; 16 findings folded. Reference: `cc-archos-labs` built the same concept on an external gbrain service only because Render blocked pgvector — CulinAIre runs pgvector natively, so it goes single-service.
