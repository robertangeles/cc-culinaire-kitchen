# The Brain — Status & Next Steps (resume point)

**One-line status:** Phase 1 is **built, shipped, deployed, and LIVE in production**
(capture + distillation + recall all on), verified end-to-end. Phase 2 and Phase 3
are the pending work. Start Phase 2 with **T11 (org tier)**.

_Last updated: 2026-07-07. This is the living "where are we / what's next" doc.
The original plan (with full rationale + reviews) is `brain-memory.md`._

---

## What The Brain is
A per-user (Phase 2: + per-org) AI memory layer. It records meaningful things a
user does, embeds them (pgvector), and injects the relevant history into AI
answers so the assistant already knows this cook and this kitchen. Native — no
external service. The whole thing is gated behind `brain_*` flags.

**Architectural seam (every future phase builds on this):**
`recordMemory()` / `recordChatTurn()` (capture) and `recallMemories()` (recall),
in `packages/server/src/services/brain*`. Adding a new surface = one
`void recordMemory({...})` after that feature's write, or one recall splice.

---

## ✅ Done & live (Phase 1)

| Piece | Where | PR |
|---|---|---|
| Schema `brain_memory` (pgvector, exact-scan, no ANN) | `db/schema.ts`, `scripts/createBrainMemoryTable.ts` | #41 |
| Capture (`recordMemory` never-rejects) + chat capture | `services/brainCaptureService.ts`, `controllers/conversationController.ts` | #41 |
| Async embed worker (SKIP LOCKED, backoff, terminal fail) | `services/brainWorker.ts` | #41 |
| Recall (exact cosine, existence gate, recency re-rank) | `services/brainRecallService.ts`, spliced in `aiService.ts` | #41 |
| "Your Brain" page (view/search/expand/delete + grounded chip) | `client/.../YourBrainPage.tsx`, `components/brain/*` | #41 |
| Perms `brain:read`/`brain:manage` + `brain_*` flags | `db/seed.ts`, `scripts/backfillBrainPermissions.ts` | #41 |
| **Balanced distillation gate** (drops retrieval-question noise) | `services/brainDistillService.ts` | #41 |
| **Admin Settings → Brain tab** (live toggles + health readout) | `client/.../settings/BrainTab.tsx` | #42 |
| **Capture-health alert** (in-app + email to admins on failure) | `services/brainCaptureAlertService.ts` | #43 |

**Live prod state:** all of `brain_enabled`, `brain_capture_enabled`,
`brain_distillation_enabled`, `brain_recall_enabled` = **true**; `brain_nudges_enabled`
= false. Flip anything in **Settings → Brain** (instant, reversible; master toggle =
kill switch). Prod app: `www.culinaire.kitchen`.

**Scope today:** chat-only (Ask Antoine). Nothing else captures to or recalls from
the Brain yet — that's Phase 2.

---

## ⬜ Pending — Phase 2 (make it the *whole kitchen's* memory)

Start here. The `organisation_id` column already exists (added in Phase 1 for this).

| Task | Plain English | Notes |
|---|---|---|
| **T11 — Org tier** ← **START HERE** | Per-org shared memory; a colleague's memories become the kitchen's. | `user.selected_organisation_id` + deterministic active-org selector + `idx_org_scope` + org-scope branch in `recallMemories` + org-isolation canary (X∦Y, ex-member) + warm-start (join org → inherit shared memories). Foundation for the rest. |
| **T12 — Ops-event capture** | Brain remembers what you *do*: recipe saved/refined, PO submitted/approved/received, waste logged, stock count, menu change, prep done. | `void recordMemory({...})` fire-after-commit at each call-site + ops distillation (harden for untrusted input). Highest visible payoff. |
| **T13 — Recall in Labs + Copilot** | Recipe/Patisserie/Spirits Labs + Kitchen Copilot get grounded like chat. | Seed recall from recipe request params / dish brief / prep selections. |
| **T14 — Rich "Your Brain" controls** | Provenance, pin, correct(→re-embed), private/shared scope toggle + org-admin management of shared memories. | Design: **D-T4** (scope tabs + source filter). |
| **T15 — Org digest** | Periodic "what your kitchen's Brain learned" summary. | `brainDigestService`, `pg_advisory_lock`-guarded. |

## ⬜ Pending — Phase 3 (intelligence layer)

| Task | Plain English |
|---|---|
| **T16 — Compaction + full distiller** | Merge/summarize old memories, per-scope size cap (keeps recall fast). The richer version of the binary gate we shipped. Adds `last_recalled_dttm`. |
| **T17 — Proactive nudges** | Memory-driven suggestions in a "For you" slot (opt-in, rate-limited). `brain_nudges_enabled` flag already seeded off. Design: **D-T5** (NudgeCard). |
| **T18 — Ranking tuning + admin re-embed panel + dashboards** | Tune what surfaces; ops tooling. |

---

## Recommended pick-up order
1. **T11 (org tier)** — plan it first (like Phase 1), then build. It's the unlock; most of Phase 2 depends on it.
2. **T12 (ops capture)** — the moment it stops being "chat memory" and becomes "kitchen memory."
3. Then T13–T15, then Phase 3.

Each is a self-contained ship-and-verify chunk on the existing capture/recall seam
— same pattern proven in Phase 1.

---

## Doc map (where the detail lives)
- **This file** — status + what's next (start here to resume).
- `brain-memory.md` — the approved plan: full architecture, decisions D1–D10 / E1–E5, security, the D10 distillation amendment, phased task list with rationale.
- `brain-memory-deploy-runbook.md` — prod DB prereqs + deploy (already executed).
- `brain-memory-activation-checklist.md` — how to turn flags on (already done; kept for reference/rollback).
- `brain-memory-test-checklist.md` — local QA runbook.
- `tasks/lessons.md` #55–#58 — the non-obvious gotchas found while building (placeholder injection, sanitize order, distillation decision).

## Prod facts (for cold-start)
- App: `www.culinaire.kitchen` (Render). DB: Render Postgres (Singapore), pgvector on.
- Flags live via `Settings → Brain` (admin) or `PUT /api/settings`. Raw SQL flips do
  NOT take effect until restart (settings cache) — always use the tab/endpoint.
- Prod scripts run from a laptop with `APP_ENV=prod` (targets `PROD_DATABASE_URL`,
  satisfies the dev-DB guard). Prod JWT secret is NOT in local `.env` — can't forge
  prod tokens; authed prod checks need a real browser session.
