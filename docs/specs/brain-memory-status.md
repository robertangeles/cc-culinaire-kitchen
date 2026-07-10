# The Brain — Status & Next Steps (resume point)

**One-line status:** Phase 1 **and all of Phase 2 through T14b** are **built, shipped,
merged to `main`, and LIVE in production** (capture + distillation + recall all on),
verified end-to-end. T11 (org tier) + T12 (ops-event capture) + T13 (recall in the Labs)
shipped in **PR #46**; T14 slice 1 (Labs grounded chip) in **PR #47**; T14b (rich "Your
Brain" controls) in **PR #48**. Continue Phase 2 with **T14c (org-admin management surface)**.

_Last updated: 2026-07-09. This is the living "where are we / what's next" doc.
The original plan (with full rationale + reviews) is `brain-memory.md`._

---

## ✅ Updated checklist (2026-07-09)

Snapshot after fast-forwarding local `main` to `8895c03` and syncing the local dev DB to
the merged Brain schema (`addBrainOrgTier` + `addBrainPinColumn` applied; T12/T13 add no
schema). The dated task sections below remain point-in-time (they say "branch" because that
was true when written); this checklist is the current reconciled view.

### Completed — merged to `main` + live in prod
- **Phase 1** (flags on): schema · never-reject capture + chat capture · async embed worker ·
  exact-cosine recall · Your Brain page · `brain:read`/`brain:manage` perms + `brain_*` flags ·
  balanced distillation gate · Settings → Brain tab · capture-health alert
- **T11 — Org tier** (PR #46, deployed): per-org shared recall, live-membership-rechecked
  active-org resolver, hard tenant isolation
- **T12 — Ops-event capture** (PR #46, deployed): kitchen actions → memory
  (PO/waste/stock/prep/recipe/menu), deterministic templates (no LLM distiller)
- **T13 — Recall in the Labs** (PR #46, deployed): Recipe/Patisserie/Spirits generation +
  refinement grounded in Brain
- **T14 slice 1 — Labs grounded chip** (PR #47): "Grounded in your Brain" chip on Lab results
- **T14b — Rich Your Brain controls** (PR #48): pin · correct(→re-embed) · scope-toggle ·
  scope tabs · source-filter chips · warm empty state (prod pin migration applied)

### Pending
- **T14c — Org-admin management** ← NEXT: browse/correct/delete *other members'* shared
  memories + org attribution on `ProvenanceChip`. Reuses the T14b endpoints (`canManage`
  already gates org-admins); no new schema.
- **T15 — Org digest**: periodic "what your kitchen's Brain learned" (`brainDigestService`,
  `pg_advisory_lock`-guarded)
- **T16 — Compaction + full distiller**: merge/summarize old memories, per-scope cap; adds
  `last_recalled_dttm` (schema migration)
- **T17 — Proactive nudges**: memory-driven "For you" slot; `brain_nudges_enabled` seeded off
- **T18 — Ranking tuning + admin re-embed panel + dashboards**

### Needs cleanup
- **Central backup repository (parked)**: no owned, off-Render, scheduled backup. Confirm
  Render's daily backups exist; agreed follow-up is a scheduled `pg_dump → cloud bucket`
  with retention.
**Resolved** (2026-07-09): the migration-script run command (`pnpm --filter … tsx …` failed
with `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`; corrected to `… exec tsx …`) fixed across all 7
`src/scripts/*.ts` — 4 non-Brain in PR #51, 3 Brain DDL in PR #52, both merged. Earlier
(2026-07-08 handoff): local prod backup deleted · #47/#48 doc-merge conflict resolved at
merge · prod pin migration applied.

**Accepted limitations (documented, not bugs):** recipes user-scoped (no org column) ·
Copilot recall deferred (no LLM step yet) · PO multi-line receive last-wins · scope-toggle
promotes to active org (no picker), un-share is org-admin-only.

---

## Phase 2 build spec — T14c + T15 (locked 2026-07-10)

Reviewed 2026-07-09/10: `/plan-eng-review` (scope-reduced — Phase 3 parked) + `/plan-design-review`
(Your Brain page 6/10 → 9/10) + an outside-voice pass. All decisions below are **locked**;
build in two independent lanes. Task artifacts: `~/.gstack/projects/robertangeles-cc-culinaire-kitchen/tasks-eng-review-*.jsonl` + `tasks-design-review-*.jsonl`.

### Locked decisions
| Area | Decision |
|---|---|
| T15 digest single-run | New `withAdvisoryLock(key, fn)` helper; **retrofit** the existing weekly waste digest onto it |
| T14c admin surface | **No new page** — admin-gated row actions on the existing Shared tab (server `canManage` already enforces) |
| T15 digest body | **Deterministic template** (counts + top items), not LLM — matches T12 / lessons #60; LLM pass deferred behind a flag |
| Shipped-code TOCTOU | Fix now via **serializable/`FOR UPDATE` tx** across `deleteMemory` / `correctMemory` / `toggleScope` |
| Departed author | Show **"Former team member"** (live-membership check), not the stored name |
| Author attribution | **Inline in the ProvenanceChip caption** (`Maria · from the waste log · Jul 8`), no new element |

### Implementation constraints (outside-voice, verified against code)
- **Advisory lock must be `pg_try_advisory_xact_lock` inside `db.transaction()`** — a session-scoped `pg_advisory_lock` leaks across the postgres.js pool (acquire on conn A, unlock runs on conn B, unlocks nothing → digest silently skips forever). See lessons: `pg-advisory-lock-pool-leak`.
- **Keep the in-memory `lastWasteDigestRun`/`lastBrainDigestRun` guard AND add the lock** — the lock only stops cross-instance dupes; after it releases the same instance's next 60s tick re-fires (~60 emails/Sunday) without the in-memory guard.
- **Author name via `decryptUserPii()`** — real name is in `user_name_enc/iv/tag`, not the plaintext `userName` fallback (pattern: `wasteDigestService.ts`). Silently "works" in local dev.
- **Digest query:** filter `created_dttm > now()-7d` (no empty emails) + `GROUP BY organisation_id` (no N+1).

### Lane A — T14c org-admin management (client + `brainService`)
Files: `brainService.ts`, `brainController.ts`, `YourBrainPage.tsx`, `MemoryRow.tsx`, `ProvenanceChip.tsx`, `BrainEmptyState.tsx`, `useBrainMemories.ts`, `brainIntegration.test.ts`.
- [ ] **T1 (P1)** — `listMemories`: author attribution for org rows (`LEFT JOIN user` + `decryptUserPii`; departed → "Former team member").
- [ ] **T2 (P1)** — Close TOCTOU: wrap fetch→`canManage`→mutate in a `FOR UPDATE`/serializable tx for `deleteMemory`, `correctMemory`, `toggleScope`.
- [ ] **T3 (P2)** — Shared tab: author on `ProvenanceChip` + admin-gated row actions (no new page).
- [ ] **T4 (P2)** — Integration test: org-admin corrects a colleague's org memory → `status=pending`, embedding null, re-queued.
- [ ] **DT1 (P1)** — `MemoryRow`: gate pin/edit/delete/share on client-side `canManage` (`isOwner || isOrgAdmin`); non-manageable shared rows are **read-only** (expand only — no buttons that 403). *Depends on T1 (author `userId`).*
- [ ] **DT2 (P2)** — `ProvenanceChip`: optional `authorName` inline in the caption; org rows only; "Former team member" when departed.
- [ ] **DT3 (P2)** — `BrainEmptyState`: add a 3rd warm `no-shared` variant; fix `YourBrainPage.tsx:71-72` so an unfiltered Shared tab with zero rows is an invitation, not "No memories match".
- [ ] **DT4 (P3)** — a11y: bump row-action touch targets `size-9` (36px) → 44px on mobile (pre-existing gap).

### Lane B — T15 org digest (new service + `index.ts`), sequential
Files: `utils/advisoryLock.ts` (new), `db/advisoryLockKeys.ts` (new), `services/brainDigestService.ts` (new), `index.ts`, `wasteDigestService.ts`.
- [ ] **T5 (P1)** — `withAdvisoryLock(key, fn)` via `pg_try_advisory_xact_lock` inside `db.transaction()`.
- [ ] **T6 (P1)** — `db/advisoryLockKeys.ts` registry (waste, brain-digest keys; prevents collision before T16/T17).
- [ ] **T7 (P1)** — `brainDigestService.sendOrgDigests`: deterministic template from `GROUP BY org` 7-day stats; skip zero-memory orgs; deliver via `notificationService`.
- [ ] **T8 (P1)** — Wire Sunday-8pm interval via `withAdvisoryLock` **and keep** the in-memory guard.
- [ ] **T9 (P1, CRITICAL REGRESSION)** — Retrofit `sendWeeklyWasteDigests` onto the lock, keep `lastWasteDigestRun`; regression test: fires once Sunday-8pm across many ticks + 2 instances.

### Parallelization
Lane A (client + `brainService`) ∥ Lane B (new digest service + `index.ts`) — no shared files. Build in parallel worktrees, merge independently. Within Lane A, DT1 waits on T1.

### NOT locked (parked)
Phase 3 (T16 compaction / T17 nudges / T18 ranking+dashboards) — review each when Phase 2 is in prod producing the corpus-size, hit-rate, and memory-density numbers those designs need.

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

### T14 — Rich "Your Brain" controls (being sliced, to the locked D-T4 spec)

- **✅ T14 slice 1 — Labs grounded chip** (merged, PR #47). Closes the T13 deferral: Recipe/Patisserie/Spirits Lab results now show the same "Grounded in your Brain" chip as chat. `generateRecipe` returns its recalled `memories`; `recipeHandler` adds an additive `brainGrounded` field to the JSON; `BrainGroundedChip` gained a direct `memories` prop (chat `annotations` path unchanged); `RecipeLabPage` (one shared component for all 3 Labs) renders it after the hero. No schema/migration, no contract break (web-only endpoints).
- **✅ T14b — rich self-service controls** (PR #48, 2026-07-08). "Your Brain" is now a management surface: **pin** (sorts first), **correct** (edit → re-embed), **scope-toggle** (private↔shared), plus **scope tabs** `[Private | Shared]` + **source-type filter chips** + a warm no-match empty state.
  - Backend: `is_pinned` column + partial index (idempotent `scripts/addBrainPinColumn.ts`, **applied to prod**); `pinMemory`/`correctMemory`/`toggleScope` in `brainService.ts` behind a single `canManage` auth helper (own row OR org-admin of the owning org); `PATCH /memories/:id/pin|:id|:id/scope` (all `brain:manage`). Share promotes to the user's active org; un-share requires org-admin.
  - Frontend: `useBrainMemories` filters + optimistic mutations; `ScopeToggle` (new), `MemoryRow` pin/edit/scope actions, `BrainEmptyState` `hasQuery` variant; `hasOrg` gates the share UI.
  - Verified: server 544/544 (route matrix + pin/correct/scope integration incl. org boundary + colleague-visibility), client 58/58, tsc/build green, **live PATCH smoke** (pin/correct/scope via HTTP → DB reflects it; the worker re-embedded the corrected body). Independently reviewed APPROVE by the pr-reviewer agent.
- **⬜ T14c — org-admin management surface** ← **NEXT**. Browse/correct/delete *other members'* shared memories under an admin view + org attribution on `ProvenanceChip` (reuses these same endpoints).

| Task | Plain English | Notes |
|---|---|---|
| **T15 — Org digest** | Periodic "what your kitchen's Brain learned" summary. | `brainDigestService`, `pg_advisory_lock`-guarded. |

## ⬜ Pending — Phase 3 (intelligence layer)

| Task | Plain English |
|---|---|
| **T16 — Compaction + full distiller** | Merge/summarize old memories, per-scope size cap (keeps recall fast). The richer version of the binary gate we shipped. Adds `last_recalled_dttm`. |
| **T17 — Proactive nudges** | Memory-driven suggestions in a "For you" slot (opt-in, rate-limited). `brain_nudges_enabled` flag already seeded off. Design: **D-T5** (NudgeCard). |
| **T18 — Ranking tuning + admin re-embed panel + dashboards** | Tune what surfaces; ops tooling. |

---

## Recommended pick-up order
1. ~~**T11 (org tier)**~~ — ✅ done + merged (PR #46).
2. ~~**T12 (ops capture)**~~ — ✅ done + merged (PR #46). It's now "kitchen memory."
3. ~~**T13 (recall in the Labs)**~~ — ✅ done + merged (PR #46). R&D is grounded. Copilot deferred (no LLM there yet).
4. ~~**T14 (rich "Your Brain" UI)**~~ — ✅ done + merged (slice 1 PR #47, T14b PR #48): scope tabs, source filters, pin/correct/scope-toggle, Labs grounded chip.
5. **T14c (org-admin management surface)** ← next — browse/correct/delete other members' shared memories + org attribution on `ProvenanceChip`. Run `/plan-design-review` first. Then T15, then Phase 3.

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
