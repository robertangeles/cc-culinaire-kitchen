# The Brain — Status & Next Steps (resume point)

**One-line status:** **Phase 1, all of Phase 2 (T11–T15), the Phase 3 signal-capture prep,
AND all three Phase 3 lanes (T18 · T16 · T17) are built and shipped.** Phase 2 finished
2026-07-10 (T14c PR #54 · T15 PR #55), live-smoke-tested. **Phase 3 prep** — the Brain
analytics star schema — shipped 2026-07-11 (PR #57), prod-migrated. **Phase 3 build** — all
three lanes merged 2026-07-11: Lane 1 T18 dashboards/re-embed/ranking-config (PR #59),
Lane 2 T16 compaction (PR #60), **Lane 3 T17 proactive nudges (PR #61)**. T17's prod
migration `addBrainNudgeOptIn.ts` (column + partial index + `brain_nudge_rate_limit`
setting) was **run + verified on prod before merge**. Nudges are off by default (admin
`brain_nudges_enabled` + per-user opt-in both required) and delivered via the existing
notification bell. **Phase 3 complete.**

_Last updated: 2026-07-11. This is the living "where are we / what's next" doc.
The original plan (with full rationale + reviews) is `brain-memory.md`._

---

## ✅ Status checklist (2026-07-11)

The single reconciled view: what's live, what's planned, and what's parked. The dated task
sections further down remain point-in-time (they say "branch" because that was true when
written).

### ✅ Done — shipped to `main` + LIVE in prod
- **Phase 1** (flags on): schema · never-reject capture + chat capture · async embed worker ·
  exact-cosine recall · Your Brain page · `brain:read`/`brain:manage` perms + `brain_*` flags ·
  balanced distillation gate · Settings → Brain tab · capture-health alert
- **T11–T13** (PR #46): org tier (per-org shared recall, live-membership resolver) · ops-event
  capture (deterministic templates) · recall grounded in the Creative Labs
- **T14 slice 1** (PR #47) + **T14b** (PR #48): Labs "grounded in your Brain" chip · rich Your
  Brain controls (pin · correct → re-embed · scope-toggle · scope tabs · source filters)
- **T14c — Org-admin management** (PR #54): author attribution on shared rows (decrypted;
  "Former team member" when departed) · admin-gated Shared-tab actions · TOCTOU hardened via
  `FOR UPDATE` transactions · warm `no-shared` empty state · 44px targets
- **T15 — Org digest** (PR #55): weekly deterministic "what your kitchen learned" in-app digest
  to org admins (`brainDigestService`) + reusable `withAdvisoryLock`; waste digest retrofitted
- **Phase 3 prep — signal-capture layer** (PR #57): strict Kimball star schema — `dim_date`
  (**50-year runway**, lesson #61) + `dim_scope` + `fact_brain_recall` + `fact_brain_corpus` +
  `brain_memory.last_recalled_dttm`; fire-and-forget recall capture + nightly corpus snapshot
  (`withAdvisoryLock`). **`addBrainAnalytics.ts` run + verified on prod 2026-07-11** (18,627
  dates, 2 scopes, both facts + column, FK cascades correct). Signal is now accruing.

### ⏳ Pending — planned, un-parked, gated on real signal (design when the data lands)
- **T16 — Compaction + full distiller**: merge/summarize old memories, per-scope size cap;
  reads `last_recalled_dttm` (now capturing). Design once `fact_brain_corpus` shows growth.
- **T18 — Ranking tuning + admin re-embed panel + dashboards**: tune what recall surfaces
  using `fact_brain_recall` hit-rate/latency; ops tooling incl. surfacing the new analytics.
- **T17 — Proactive nudges**: memory-driven "For you" slot; `brain_nudges_enabled` seeded off.
  Design once memory-density is measurable.

### 🅿️ Parking lot — deferred, not scheduled
- **Central backup repository**: no owned, off-Render scheduled backup; Render's daily backups
  are the current net. Agreed follow-up: scheduled `pg_dump → cloud bucket` with retention.
- **ANN index on `brain_memory`**: only if a single tenant's corpus is measured large (recall
  is exact-scan today). `fact_brain_corpus` will tell us if/when.
- **LLM digest prose pass**: flag-gated upgrade to the deterministic T15 digest.
- **Analytics-write alerting**: `recordRecall`/`snapshotCorpus` failures are best-effort/logged;
  add alerting when T18 dashboards land.
- **`dim_date` beyond 2075**: re-run `addBrainAnalytics.ts` with a later end date (~50 yr out).
- **Accepted limitations (by design):** recipes user-scoped (no org column) · Copilot recall
  deferred (no LLM step) · PO multi-line receive last-wins · scope-toggle uses active org
  (no picker), un-share is org-admin-only.

**Resolved this cycle:** migration-script `tsx`→`exec tsx` across all 7 scripts (#51/#52) ·
Phase-2 doc reconciliation (#56) · #57 prod migration run + verified.

---

## Phase 2 build spec — T14c + T15 — ✅ SHIPPED 2026-07-10 (PR #54 + #55)

Reviewed 2026-07-09/10: `/plan-eng-review` (scope-reduced — Phase 3 parked) + `/plan-design-review`
(Your Brain page 6/10 → 9/10) + an outside-voice pass. Built in two lanes, each verified
(server 556/556, client 64/64, tsc + build green), pr-reviewer-checked, merged, and
**live-smoke-tested over HTTP** (GET shape + `canManage`/`authorName`, admin manage,
"Former team member", digest delivery). All 13 tasks below are done.

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
- [x] **T1 (P1)** — `listMemories`: author attribution for org rows (`LEFT JOIN user` + `decryptUserPii`; departed → "Former team member").
- [x] **T2 (P1)** — Close TOCTOU: wrap fetch→`canManage`→mutate in a `FOR UPDATE`/serializable tx for `deleteMemory`, `correctMemory`, `toggleScope`.
- [x] **T3 (P2)** — Shared tab: author on `ProvenanceChip` + admin-gated row actions (no new page).
- [x] **T4 (P2)** — Integration test: org-admin corrects a colleague's org memory → `status=pending`, embedding null, re-queued.
- [x] **DT1 (P1)** — `MemoryRow`: gate pin/edit/delete/share on client-side `canManage` (`isOwner || isOrgAdmin`); non-manageable shared rows are **read-only** (expand only — no buttons that 403). *Depends on T1 (author `userId`).*
- [x] **DT2 (P2)** — `ProvenanceChip`: optional `authorName` inline in the caption; org rows only; "Former team member" when departed.
- [x] **DT3 (P2)** — `BrainEmptyState`: add a 3rd warm `no-shared` variant; fix `YourBrainPage.tsx:71-72` so an unfiltered Shared tab with zero rows is an invitation, not "No memories match".
- [x] **DT4 (P3)** — a11y: bump row-action touch targets `size-9` (36px) → 44px on mobile (pre-existing gap).

### Lane B — T15 org digest (new service + `index.ts`), sequential
Files: `utils/advisoryLock.ts` (new), `db/advisoryLockKeys.ts` (new), `services/brainDigestService.ts` (new), `index.ts`, `wasteDigestService.ts`.
- [x] **T5 (P1)** — `withAdvisoryLock(key, fn)` via `pg_try_advisory_xact_lock` inside `db.transaction()`.
- [x] **T6 (P1)** — `db/advisoryLockKeys.ts` registry (waste, brain-digest keys; prevents collision before T16/T17).
- [x] **T7 (P1)** — `brainDigestService.sendOrgDigests`: deterministic template from `GROUP BY org` 7-day stats; skip zero-memory orgs; deliver via `notificationService`.
- [x] **T8 (P1)** — Wire Sunday-8pm interval via `withAdvisoryLock` **and keep** the in-memory guard.
- [x] **T9 (P1, CRITICAL REGRESSION)** — Retrofit `sendWeeklyWasteDigests` onto the lock, keep `lastWasteDigestRun`; regression test: fires once Sunday-8pm across many ticks + 2 instances.

### Parallelization
Lane A (client + `brainService`) ∥ Lane B (new digest service + `index.ts`) — no shared files. Build in parallel worktrees, merge independently. Within Lane A, DT1 waits on T1.

### NOT locked (parked)
Nothing — Phase 3 was **un-parked 2026-07-11** once the signal-capture layer shipped. See the Phase 3 build spec below.

---

## Phase 3 build spec — T18 / T16 / T17 (locked 2026-07-11, un-parked)

`/plan-eng-review` un-parked Phase 3 (supersedes the 2026-07-09 park decision) now that the
analytics signal is capturing. **Mechanisms + configs are locked; tuning values ship as
settings, set later on real data** (no hardcoded guesses). Build in three sequential lanes.

### Locked decisions
| Area | Decision |
|---|---|
| Build order | **Lane 1 T18 dashboards → Lane 2 T16 compaction → Lane 3 T17 nudges** — dashboards first give the observability to tune the rest |
| T16 disposal | **Soft-archive** merged sources (`status='archived'`), never hard-delete — recall (`status='ready'`) drops them immediately, reversible/auditable. Hard-purge = later opt-in setting |
| Tuning | Ranking weights, compaction cap (`0=off`), nudge rate-limit all ship as `site_setting`s, tuned on real data |
| T17 depth | Plumbing now; nudge **generation/triggering/NudgeCard UX gets its own /plan-design-review + product call** at Lane 3 |
| Reuse | `withAdvisoryLock`, `createInApp`, `brainDistillService`, `brainWorker` SKIP-LOCKED, the live `fact_brain_*` — Phase 3 is assembly, not greenfield |

### Lane 1 — T18 dashboards + re-embed + ranking-config ✅ SHIPPED (PR #59)
- [x] **L1-1 (P2)** — extract recall ranking weights to `site_setting`s (`brain_rank_similarity_weight` 0.7 · `brain_rank_recency_weight` 0.2 · `brain_rank_recency_halflife_days` 30); read in `brainRecallService` (settings already loaded there); byte-identical at defaults. _Half-life floored at 0.001; analytics WHERE uses indexed `date_key`._
- [x] **L1-2 (P2)** — `brainAnalyticsService` read fns: `getRecallStats` (hit-rate/latency/count) + `getCorpusStats` (growth/size/failed) via raw SQL over `fact_brain_recall`/`fact_brain_corpus`.
- [x] **L1-3 (P2)** — admin dashboards in Settings → Brain (`GET /api/brain/analytics`, admin): hit-rate/latency + corpus growth + status breakdown.
- [x] **L1-4 (P2)** — admin re-embed panel: reset `status='failed'` → `'pending'` for the worker (`POST /api/brain/reembed-failed`, admin).

### Lane 2 — T16 compaction + full distiller ✅ SHIPPED (PR #60)
- [x] **L2-1 (P2)** — `brainDistillService.summarizeMemories(bodies[])` → distilled digest (`claude-haiku`, ops-distiller hardening).
- [x] **L2-2 (P2)** — `brainCompactionService`: pick coldest N over cap (`last_recalled_dttm` NULLS FIRST), summarize → INSERT `memory_kind='digest'`, UPDATE sources `status='archived'`; cap = `brain_compaction_cap` (`0`=off).
- [x] **L2-3 (P2)** — nightly compaction via `withAdvisoryLock` (`brainCompaction` key), off unless `brain_compaction_enabled` + cap>0; recall + `listMemories` exclude `archived`.

### Lane 3 — T17 nudges ✅ SHIPPED (PR #61, prod-migrated)
**Design pivot (2026-07-11):** the design pass (L3-2) ran this session, not deferred — and
we chose to build the **full generation** now (not stubbed). Two product calls settled it:
**ops-action nudges** (act on the user's most recent ready ops memory — PO/waste/stock/prep/
menu) delivered via the **existing notification bell** (D-T5's "For you" NudgeCard is
superseded — the app has no operator dashboard to host it yet).
- [x] **L3-1** — `brainNudgeService`: `runNudges()` daily job under `withAdvisoryLock(brainNudge)`, no-op unless `brain_enabled` + `brain_nudges_enabled` + `brain_nudge_rate_limit`>0; iterates opted-in users, per-user rate-limit (`recentNudgeCount`, 7-day window), dedupes on source `related_entity_id`, `createInApp` `BRAIN_NUDGE` delivery.
- [x] **L3-2** — nudge **generation** built: `generateNudgeText` (fail-soft `claude-haiku`, sanitized+delimited untrusted body, returns null on error/NONE). Per-user opt-in: `user.brain_nudges_opt_in` (off) + `GET|PUT /api/brain/nudges/opt-in` (`brain:read`) + `NudgeOptIn` toggle on Your Brain. `NotificationBell` renders `BRAIN_NUDGE` (+ backfilled `BRAIN_DIGEST`, previously unrendered).
- [x] **Prod migration done** — `addBrainNudgeOptIn.ts` run + verified on prod (column `boolean`, `idx_user_brain_nudges_opt_in` present, `brain_nudge_rate_limit='2'`) before the PR #61 merge.

### Data-gated (deferred — set on real signal, not now)
Ranking weight values · compaction cap value · nudge triggering thresholds. The Lane 1 dashboards are what make these tunable on evidence.

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
- **✅ T14c — org-admin management surface** (PR #54, 2026-07-10). Org-admins correct/delete other members' shared memories via admin-gated actions on the existing Shared tab; author attribution on `ProvenanceChip` (decrypted, "Former team member" when the author has left the org); delete/correct/pin/scope hardened against a TOCTOU race with `FOR UPDATE` transactions.
- **✅ T15 — org digest** (PR #55, 2026-07-10). Weekly deterministic "what your kitchen's Brain learned" in-app digest to org admins (`brainDigestService`), guarded by the new `withAdvisoryLock` (`pg_try_advisory_xact_lock` — no pool-leak); the existing weekly waste digest was retrofitted onto the same lock. **Phase 2 complete.**

## ✅ Done — Phase 3 (intelligence layer)

| Task | Plain English | Ship |
|---|---|---|
| **T18 — Ranking tuning + admin re-embed panel + dashboards** | Ranking weights to settings; admin Brain analytics (hit-rate/latency/corpus growth); re-embed-failed panel. | PR #59 |
| **T16 — Compaction + full distiller** | Merge/summarize cold memories over a per-scope cap into a `digest`, soft-archive sources. Adds `last_recalled_dttm`. Off unless `brain_compaction_enabled` + cap>0. | PR #60 |
| **T17 — Proactive nudges** | Ops-action nudges (act on recent PO/waste/stock/prep/menu memory) delivered to the **notification bell** (D-T5 NudgeCard superseded — no dashboard yet). Opt-in + rate-limited; `brain_nudges_enabled` off. | PR #61 |

---

## Recommended pick-up order
1. ~~**T11 (org tier)**~~ — ✅ done + merged (PR #46).
2. ~~**T12 (ops capture)**~~ — ✅ done + merged (PR #46). It's now "kitchen memory."
3. ~~**T13 (recall in the Labs)**~~ — ✅ done + merged (PR #46). R&D is grounded. Copilot deferred (no LLM there yet).
4. ~~**T14 (rich "Your Brain" UI)**~~ — ✅ done + merged (slice 1 PR #47, T14b PR #48): scope tabs, source filters, pin/correct/scope-toggle, Labs grounded chip.
5. ~~**T14c (org-admin management surface)**~~ — ✅ done + merged (PR #54). Admin-gated Shared-tab actions + author attribution + TOCTOU-hardened mutations.
6. ~~**T15 (org digest)**~~ — ✅ done + merged (PR #55). Weekly advisory-lock-guarded digest. **Phase 2 complete.**
7. ~~**Phase 3 (T18 dashboards → T16 compaction → T17 nudges)**~~ — ✅ built: T18 PR #59, T16 PR #60, T17 shipping. Tuning values (ranking weights, compaction cap, nudge rate-limit) ship as settings, set later on real signal from the Lane 1 dashboards.

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
