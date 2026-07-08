# The Brain — Status & Next Steps (resume point)

**One-line status:** Phase 1 is **built, shipped, deployed, and LIVE in production**
(capture + distillation + recall all on), verified end-to-end. **T11 (org tier) + T12
(ops-event capture) + T13 (recall in the Labs) are built + tested on branch
`feature/ck-web/brain-org-tier`** (T11 + T12 committed; T13 not yet committed; none
merged/deployed). Continue Phase 2 with **T14 (rich "Your Brain" UI)**.

_Last updated: 2026-07-08. This is the living "where are we / what's next" doc.
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

## Phase 2 (make it the *whole kitchen's* memory)

### ✅ T11 — Org tier (built + tested, branch `feature/ck-web/brain-org-tier`, 2026-07-08)

Per-org shared memory foundation. The recall/management surface now serves
`scope='org'` rows with hard tenant isolation, resolved to a single active org.

| Piece | Where |
|---|---|
| `user.selected_organisation_id` (+FK) + `idx_brain_memory_org_scope` | `db/schema.ts`, idempotent `scripts/addBrainOrgTier.ts` |
| Deterministic active-org resolver (E-fold #8) + **live-membership recheck** | `services/activeOrgService.ts` (`resolveActiveOrg`, `switchOrganisation`) |
| Two-tier recall (own `scope='user'` OR active org's `scope='org'`) — both the scan and the `hasReadyMemory` gate | `services/brainRecallService.ts` |
| `activeOrgId` threaded `chatController → streamChat → recall` (resolved OUTSIDE the 2s budget race) | `controllers/chatController.ts`, `services/aiService.ts` |
| `listMemories` tenant boundary + `scope` filter; `deleteMemory` org-admin-of-owning-org path (E5) | `services/brainService.ts`, `controllers/brainController.ts` |
| Tests: **X∦Y** + **ex-member** canaries, resolver units, delete matrix, byte-identical regression, curl smoke | `services/brainIntegration.test.ts`, `services/aiService.test.ts` |

**Verified:** server suite 513/513; 17 org-tier integration tests (real DB) incl. the
X∦Y and ex-member canaries; migration idempotent (run twice); curl smoke 401/200/400/404
+ non-admin org delete refused (memory survives).

**Documented deviations from the T11 plan (all deliberate):**
1. Active-org resolved in **`chatController`** (the real recall splice site), not
   `conversationController` (that is the capture site — untouched, chat stays private).
2. The delete-authorisation matrix lives in the **integration suite** (needs a real DB),
   not the hermetic route-gate test — no new route or permission key was added, so the
   gate matrix in `routes/brain.test.ts` is unchanged.
3. Local dev DB was missing the Phase-1 `brain_memory` table; ran
   `createBrainMemoryTable.ts` before `addBrainOrgTier.ts`. Prod already has it.

**~~⚠️ Carried risk for T12~~ — WITHDRAWN (see T12 below):** the upsert unique index
does NOT need changing. Ops `sourceRef`s are globally-unique entity UUIDs + each
`source_type` has a fixed scope, so the existing `(user_id, source_type, source_ref)`
key already can't collide across orgs; adding `organisation_id` would *break* user-scoped
recipe dedup (NULL-distinct → duplicate inserts) and `NULLS NOT DISTINCT` would break chat.

### ✅ T12 — Ops-event capture (built + tested, branch `feature/ck-web/brain-org-tier`, 2026-07-08)

The Brain now remembers what the kitchen *does*. A new `recordOpsEvent` wrapper builds a
**deterministic template** body per event (NO LLM distiller — chosen over the spec's LLM
ops distiller: free, instant, no injection surface; free-text sanitized per-field before
framing), fired `void` after each write commits.

| Piece | Where |
|---|---|
| `recordOpsEvent` + `buildOpsBody` (discriminated union, 7 event types) | `services/brainCaptureService.ts` |
| PO submitted/approved/received (`scope='org'`, `sourceRef=${poId}:${stage}`) | `controllers/purchaseOrderController.ts` |
| Waste / Stock count / Prep completed (`scope='org'`, service-side) | `wasteService.ts`, `stockTakeService.ts`, `prepService.ts` |
| Recipe saved / refined (`scope='user'` — no org column) | `recipeService.ts`, `controllers/recipeController.ts` |
| Menu created/updated (`scope='org'` via `getUserOrgContext`; **semantic-field gate** skips nightly analytics writes) | `menuIntelligenceService.ts` |
| Unit templates + injection tests; colleague-recall integration canary | `brainCaptureService.test.ts`, `brainIntegration.test.ts` |

**Verified:** server suite 522/522; 20 template/posture unit tests + the T12 ops canary
(adminY logs waste → embedded → colleague userY recalls it, userX in another org does
not); tsc clean; **live curl smoke** — `POST /api/waste` produced a `brain_memory` row
`scope='org'`, `source_type='waste'`, templated body, `status=ready`, embedded.

**Deviations:** deterministic templates instead of the spec's LLM ops distiller (flag can
add an LLM pass later); no schema/migration change (carried-risk withdrawn); recipes stay
`scope='user'` (no org column — a chef's recipe history recalls only for them).

### ✅ T13 — Recall in the Creative Labs (built + tested, branch `feature/ck-web/brain-org-tier`, 2026-07-08)

Recipe / Patisserie / Spirits Lab generation + recipe refinement are now grounded in the
recalled `## Brain Memory` block, same as chat. One splice covers all three Labs (shared
`recipeService.generateRecipe`); the block is injected into the user message in D5 order
(kitchen context → Brain → RAG → request), recall fired concurrently with the RAG search,
`activeOrgId` resolved in the controller.

| Piece | Where |
|---|---|
| Recall seed + concurrent recall + `buildUserMessage` block splice | `services/recipeService.ts` |
| `resolveActiveOrg` in the shared Labs controller + refine handler | `controllers/recipeController.ts` |
| Refinement grounding (optional `userId`/`activeOrgId` params) | `services/recipeRefinementService.ts` |
| Splice + D5-order + byte-identical-when-null tests | `services/recipeService.test.ts`, `services/recipeRefinementService.test.ts` |

**Scope:** **Labs only — Copilot deferred.** "Kitchen Copilot" is the prep module and its
task generation is pure scoring math with NO LLM, so there's no prompt to ground; wire it
when/if prep gains an AI step. **No schema/migration; no API-contract change** (the Labs
"grounded in your Brain" chip is deferred to the Your-Brain UI work, ~T14).

**Verified:** server suite 529/529; 7 new splice tests (query seed, block in D5 order,
byte-identical when recall null, per-domain seeding, refinement); tsc clean; lint 0
errors; build 3/3. **Live LLM smoke PASSED** — with the OpenRouter key hydrated from the
DB `credential` table, a seeded recipe memory embedded (real), live recall returned it,
and a real grounded generation fired `brain.recall.hit` inside `generateRecipe` and
produced a recipe that reflected the seeded memory (crisp-skin detail carried through).

### ⬜ Pending — remaining Phase 2

| Task | Plain English | Notes |
|---|---|---|
| **T14 — Rich "Your Brain" controls** ← **START HERE** | Provenance, pin, correct(→re-embed), private/shared scope toggle + org-admin management of shared memories; + the grounded chip for Labs. | Design: **D-T4** (scope tabs + source filter). Needs a `/plan-design-review` pass. |
| **T15 — Org digest** | Periodic "what your kitchen's Brain learned" summary. | `brainDigestService`, `pg_advisory_lock`-guarded. |

## ⬜ Pending — Phase 3 (intelligence layer)

| Task | Plain English |
|---|---|
| **T16 — Compaction + full distiller** | Merge/summarize old memories, per-scope size cap (keeps recall fast). The richer version of the binary gate we shipped. Adds `last_recalled_dttm`. |
| **T17 — Proactive nudges** | Memory-driven suggestions in a "For you" slot (opt-in, rate-limited). `brain_nudges_enabled` flag already seeded off. Design: **D-T5** (NudgeCard). |
| **T18 — Ranking tuning + admin re-embed panel + dashboards** | Tune what surfaces; ops tooling. |

---

## Recommended pick-up order
1. ~~**T11 (org tier)**~~ — ✅ done (committed).
2. ~~**T12 (ops capture)**~~ — ✅ done (committed). It's now "kitchen memory."
3. ~~**T13 (recall in the Labs)**~~ — ✅ done (branch, not yet committed). R&D is grounded. Copilot deferred (no LLM there yet).
4. **T14 (rich "Your Brain" UI)** ← next — scope tabs, provenance, org-admin management, + the Labs grounded chip. Run `/plan-design-review` first. Then T15, then Phase 3.

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
