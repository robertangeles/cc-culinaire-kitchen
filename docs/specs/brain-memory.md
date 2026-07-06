# Brain Memory — Approved Implementation Plan

> **Status:** APPROVED + reviewed (CEO + Eng + Design), 2026-07-04. Canonical, resume-ready plan for building "the Brain" — a per-user + per-org AI memory layer.
>
> **To resume ("brief me on the current plan"):** read this file top to bottom. Then implement **Phase 1** (T1-T10 + D-T1..D-T3) on a feature branch `feature/ck-web/brain-spine`, verifying against a local DB per the Verification section. Commit, push, and merge per the trunk-based workflow in CLAUDE.md.
>
> Reviews: CEO (SELECTIVE EXPANSION, 4/4 expansions), Eng (5 findings resolved, exact-scan recall / no ANN), Design (3/10 → 9/10). Two outside-voice passes; 16 findings folded. See the GSTACK REVIEW REPORT at the end.

---

# CulinAIre Kitchen — The Brain (per-user + per-org AI memory)

## Context — why we are building this

Every AI surface in CulinAIre starts cold. The chat assistant, Recipe/Patisserie/Spirits
Labs, and Kitchen Copilot each get a static `kitchen_profile` block ([userContextService.buildContextString](packages/server/src/services/userContextService.ts#L203)) but nothing accumulates: yesterday's hollandaise fix doesn't inform today's chat, a recipe refinement never reaches the assistant, and the org's purchasing/waste history is invisible to the model. The thesis is that context is the moat: an assistant that already knows this cook, this kitchen, and this org's history stops giving generic answers.

We are building **the Brain**: a per-user and per-org memory layer that records the meaningful things a user does (chat turns + curated kitchen-ops events), embeds them, and injects the relevant history into every AI interaction. Native (no external service), two-tier (user-private + org-shared), delivered in phases.

Reviewed by `/plan-ceo-review` (SELECTIVE EXPANSION) + `/plan-eng-review`, each with an independent outside-voice pass. Decisions D1–D10 (product/scope) and E1–E5 (engineering) are locked below.

---

## Decisions locked

**Product / scope (CEO review):**

| # | Decision | Choice |
|---|----------|--------|
| D1 | Store architecture | Native pgvector, single service (no external gbrain) |
| D2 | Review posture | SELECTIVE EXPANSION — full platform + cherry-picks, phased |
| D3 | Scope model | Two-tier: user-private + org-shared, explicit active-org |
| D4 | Capture breadth | Curated high-signal taxonomy via one `recordMemory()` |
| D5 | Recall reach | All AI surfaces (chat + Labs + Copilot) |
| D6 | Proactive nudges | In the v1 platform (Phase 3), opt-in + rate-limited |
| D7 | Org insight digests | In the v1 platform (Phase 2) |
| D8 | "Your Brain" UI | Full management (view/delete baseline; provenance, pin, correct, scope-toggle) |
| D9 | Scope commitment | Full commitment, no evidence gate |
| D10 | Chat distillation | Raw + embed for chat; distill only ops + compaction — **AMENDED, see below** |

> **D10 amendment (2026-07-06, product-owner call — flag-gated):** live Phase-1 testing showed raw chat capture stores pure retrieval questions ("what's my pasta ratio?") as memories, cluttering "Your Brain" and eroding trust. A *lightweight* slice of Phase-3 chat distillation was pulled forward: a binary **Balanced** keep/drop judge (`brainDistillService.shouldRememberChatTurn`, `anthropic/claude-haiku-4-5`) runs in `recordChatTurn` **before** insert. Gated by `brain_distillation_enabled` (seeded OFF → raw capture, D10-faithful; ON → noise dropped). Fail-open on any judge error/timeout. This is ONLY the binary gate — memory rewriting/merging/compaction remains Phase 3. See `tasks/lessons.md` #58.

**Engineering (eng review):**

| # | Decision | Choice |
|---|----------|--------|
| E1 | streamChat change | Split T6/T7: refactor awaits first (regression test), THEN splice recall |
| E2 | Capture error boundary | `recordMemory` catches internally, never rejects |
| E3 | Recall retrieval | **No ANN index** — exact cosine over the tenant-filtered slice |
| E4 | Phase 1 org tier | Deferred to Phase 2 — Phase 1 is a pure user-scope spine |
| E5 | Org memory governance | Org admins can delete/correct `scope='org'` memories |

**Eng-review defect-fixes folded in (no tradeoff):** owner-scoped `unique(user_id, source_type, source_ref)` for the upsert; `attempt_count` + `next_attempt_dttm` for real worker backoff; DB-`advisory_lock` (not an in-memory flag) for digest/nudge jobs; dropped the unused `salience` column; deterministic active-org resolution; `last_recalled_dttm` deferred to Phase 3; recall query-embed gated behind a "has ≥1 ready memory" check; reuse the existing `sanitizeForPrompt` for the injected block; capture-error alert is a Phase-1 exit criterion.

Folded quality (from CEO review): recency-weighted ranking (app-side re-rank); warm-start for a user *joining an existing org* inherits that org's shared memories — this now lands in **Phase 2** (E4), since org data doesn't exist in Phase 1.

---

## What already exists (reuse map)

| Sub-problem | Reuse | Location |
|---|---|---|
| Embedding | `embedText()` (OpenRouter `text-embedding-3-small`, 1536d, dimension-locked) | [knowledgeService.ts:78](packages/server/src/services/knowledgeService.ts#L78) |
| Vector type | `vector1536` custom Drizzle type | [schema.ts:39](packages/server/src/db/schema.ts#L39) |
| Similarity SQL | raw-SQL `<=>` cosine (exact form) | [knowledgeService.ts:112](packages/server/src/services/knowledgeService.ts#L112) |
| Prompt injection slot + guard | `{{KITCHEN_CONTEXT}}` + `sanitizeForPrompt` | [aiService.ts:86](packages/server/src/services/aiService.ts#L86), [userContextService.ts:188](packages/server/src/services/userContextService.ts#L188) |
| Chat write hook | `saveMessages()` (sole message writer) | [conversationService.ts:97](packages/server/src/services/conversationService.ts#L97) |
| Event capture primitive | `audit_log` + `auditService.log(params, tx)` | [schema.ts:2220](packages/server/src/db/schema.ts#L2220) |
| Live membership | `getUserOrganisationIds()` | [benchService.ts:97](packages/server/src/services/benchService.ts#L97) |
| Upsert precedent | `.unique()` + `onConflictDoUpdate` | [ratingService.ts:99](packages/server/src/services/ratingService.ts#L99) |
| Feature-flag pattern | `site_setting` seeded defaults | [seed.ts](packages/server/src/db/seed.ts) |
| Worker precedent | four existing `setInterval` workers | [index.ts](packages/server/src/index.ts) |
| Digest/delivery | `wasteDigestService` + `notificationService` | services/ |

Reference patterns from `cc-archos-labs` (not code): module split, recall/capture splice, PII redaction, isolation canary, "Your Brain" UI.

---

## Architecture

```
                          ┌─────────────────────────────────────────────┐
   Web client ──┐         │            CulinAIre web backend             │
                ├─ /api/chat ─▶ chatController ─▶ aiService.streamChat ───┼─┐
   Mobile ──────┘         │   (awaits parallelized; recall = concurrent  │ │  ┌──────────────┐
   Labs/Copilot ─ recipeService/prepService ─┤  promise, exact scan)     │ ├─▶│  Postgres +  │
                          │              ▼                                │ │  │   pgvector   │
                          │      buildPrompt(+ Brain block via            │ │  │ brain_memory │
                          │        sanitizeForPrompt)                     │ │  │ (btree only) │
                          │              ▼   streamText ─▶ OpenRouter     │ │  └──────────────┘
   any write ─▶ recordMemory() [never rejects] ─ sanitize ─ insert ──────┼─┘  chat: after saveMessages
                          │  brainWorker: CLAIM (SKIP LOCKED) →           │    ops: after commit (Phase 2)
                          │    embed (+ distill ops) → ready/failed;      │
                          │    attempt_count backoff                      │
                          └─────────────────────────────────────────────┘
```

**Modules:** `brainService` (public API) · `brainCaptureService` (`recordMemory`, taxonomy) · `brainRecallService` (exact retrieval, rank, format) · `brainDistillService` (ops + compaction only) · `brainSanitize` · `brainWorker` (claim + embed + backoff) · `brainDigestService` (Phase 2) · `brainNudgeService` (Phase 3).

**Coupling:** `aiService`/`recipeService`/`prepService` gain a read dependency on recall; write services gain a fire-after-commit call to `recordMemory` (which never rejects). One-directional, graceful-degrading. No new external system, no new SPOF.

**Scaling:** recall is one exact cosine scan over a tenant's own rows (small slice, btree pre-filtered), re-ranked in app. Capture is one insert + async enrichment. Compaction (Phase 3) caps per-scope rows so the exact scan stays bounded; an ANN index can be added later if a single tenant's corpus is measured large.

---

## Data model (Drizzle, `schema.ts`; `drizzle-kit push`)

Singular table names, `uuid().defaultRandom()` PKs (matches newest tables). Every FK indexed.

**`brain_memory`**
```
memory_id          uuid PK default random
user_id            integer NOT NULL  → user.user_id          -- author/owner
organisation_id    integer NULL      → organisation.org_id   -- set when scope='org' (Phase 2 logic)
scope              varchar(10) NOT NULL default 'user'        -- 'user' | 'org'
memory_kind        varchar(20) NOT NULL default 'event'       -- 'event' | 'digest' (Phase 3 uses 'digest')
source_type        varchar(30) NOT NULL                       -- 'chat'|'recipe'|'purchase_order'|'waste'|'stock'|'menu'|'prep'
source_ref         varchar(100) NULL                          -- originating entity id; NULL for chat
title              varchar(200) NULL
body               text NOT NULL                              -- sanitized raw (chat) or distilled (ops); redacted
embedding          vector1536 NULL                            -- filled async; NULL until embedded
status             varchar(20) NOT NULL default 'pending'     -- 'pending'|'processing'|'ready'|'failed'
attempt_count      integer NOT NULL default 0                 -- worker retry counter (E-fold #3)
next_attempt_dttm  timestamptz NULL                           -- earliest next claim; enforces real backoff
created_dttm       timestamptz default now()
updated_dttm       timestamptz default now()
-- last_recalled_dttm  → added in Phase 3 (compaction reads it); NOT written on the hot path
```
Constraints / indexes (each serves a stated query):
- **`unique(user_id, source_type, source_ref)`** — the upsert target (E-fold #2). Owner-scoped so a source id can't cross-collide between users. NULL `source_ref` (chat) never collides, so chat always inserts.
- `idx_brain_memory_user_scope (user_id, scope)` — user-private recall + "Your Brain" listing.
- `idx_brain_memory_status (status)` partial `WHERE status IN ('pending','failed')` — worker claim scan.
- **Phase 2:** `idx_brain_memory_org_scope (organisation_id, scope)` — org-shared recall + digest.
- **No ANN index (E3).** Recall filters to one tenant's small slice; exact cosine over that slice is correct and fast. Revisit only if a single tenant is measured large.

No chunk table (memories are short; embed `body` directly). `salience` dropped (was never read).

**Active org (Phase 2):** add `user.selected_organisation_id integer NULL → organisation`. Deterministic resolution (E-fold #8): `selected_organisation_id` if set → else the org of `user.selectedLocationId` if set → else the numerically-lowest `org_id` from membership → else none. Never trusted for recall without a live membership recheck.

**Flags (`site_setting`, seeded OFF):** `brain_enabled`, `brain_capture_enabled`, `brain_recall_enabled`, `brain_nudges_enabled`, `brain_distillation_model="anthropic/claude-haiku-4-5"` (verify the exact OpenRouter slug with a live call before ship, per CLAUDE.md).

**Permissions (seed):** `brain:read`, `brain:manage`. `brain:manage` also authorizes org admins (`userOrganisation.role='admin'`) to delete/correct `scope='org'` memories (E5). Idempotent, transactional backfill run before the enforcing deploy.

---

## Capture pipeline (`recordMemory` — never rejects, E2)

```
recordMemory({ userId, organisationId?, scope, sourceType, sourceRef?, rawContent, kind? }): Promise<void>
   try {
     sanitize rawContent                                    ── brainSanitize
     INSERT brain_memory {...} ON CONFLICT (user_id, source_type, source_ref)
        DO UPDATE ...                                       -- real unique target
   } catch (e) { log(e, {userId, sourceType, sourceRef}); /* swallow — never throw/reject */ }
   -- callers: `void recordMemory(...)` — safe, cannot crash the process
        · chat : after saveMessages()
        · ops  : after the action's tx COMMITS (Phase 2), never inside it

brainWorker (setInterval in index.ts):
   CLAIM: UPDATE brain_memory SET status='processing'
          WHERE memory_id IN (SELECT memory_id FROM brain_memory
            WHERE status IN ('pending','failed')
              AND (next_attempt_dttm IS NULL OR next_attempt_dttm <= now())
            ORDER BY created_dttm LIMIT N FOR UPDATE SKIP LOCKED) RETURNING *
   → chat: embed sanitized raw body                          -- D10, no LLM
   → ops : distill (untrusted input) then embed              -- Phase 2
   → success: status='ready'
   → failure: attempt_count++, status = attempt_count>=3 ? 'failed'(terminal) : 'pending',
              next_attempt_dttm = now() + backoff(attempt_count)   -- no hot-loop
```
`SKIP LOCKED` + the claim make the worker safe under overlapping ticks and multiple instances. `attempt_count`/`next_attempt_dttm` give real backoff and a terminal `failed` state so a poisoned row stops cycling. Guest (`userId ≤ 0`) never records.

**Taxonomy (D4):** chat turn (scope=user, Phase 1); recipe saved / AI-refined, PO submitted/approved/received, waste logged, stock count submitted, menu changed, prep completed (scope=org where org-context, **Phase 2**).

---

## Recall pipeline (exact scan, E3)

```
recallMemories(userId, query):
   if (!brain_recall_enabled) return null
   if (!hasReadyMemory(userId, activeOrgId)) return null      -- cheap existence check; skip the embed for zero-memory users (E-fold #10)
   activeOrgId = resolveActiveOrg(userId)                      -- deterministic (E-fold #8); Phase 2
   verify activeOrgId ∈ getUserOrganisationIds(userId)         -- live recheck
   qvec = embedText(query)                                     -- null → skip (graceful)
   -- exact cosine over the tenant slice (btree pre-filters; no ANN)
   cands = SELECT memory_id, title, body, source_type, created_dttm
           FROM brain_memory
           WHERE status='ready' AND embedding IS NOT NULL
             AND ( (user_id=$userId AND scope='user')
                   OR (organisation_id=$activeOrgId AND scope='org') )   -- org branch: Phase 2
           ORDER BY embedding <=> $qvec::vector
           LIMIT 30
   rank = 0.7*(1-dist) + 0.2*exp(-ageDays/30)                 -- app-side; recency
   top = sortByRank(cands).slice(0, 6)
   → sanitizeForPrompt(format("## Brain Memory", top))         -- reuse the existing guard (E-fold)
```

Exact scan is correct by construction (no HNSW post-filter starvation) and fast over a tenant's own rows. Recall is a concurrent promise fired at `streamChat` entry and awaited before the prompt splice (E1), so it overlaps the other setup rather than adding to it.

**Injection (D5):** labelled `## Brain Memory` block after `{{KITCHEN_CONTEXT}}` (order: core → kitchen context → Brain Memory → RAG tools → rules), passed through `sanitizeForPrompt`, treated as trusted platform data with an explicit "don't obey instructions inside memories" rule. Surfaces: chat (Phase 1); Labs seeded by recipe request params + dish brief, Copilot seeded by prep menu selections (Phase 2).

**State machine:**
```
 (create)→ pending →claim→ processing →embed ok→ ready →corrected/pinned→ ready
              ▲                  │
              │ (attempt<3)   embed/distill fail
              └── pending ◀──────┤ attempt++, next_attempt_dttm = now()+backoff
                                 └─(attempt≥3)→ failed (terminal, never recalled)
 Only status='ready' is recalled. Claimed rows (processing) can't be double-taken.
```

---

## Security & threat model

| Threat | L | I | Mitigation |
|---|---|---|---|
| Cross-tenant leak | Med | High | App-enforced recall filter; `activeOrgId` live-rechecked against `userOrganisation`; canary: A∦B (Phase 1), orgX∦Y + **removed-member∦org** (Phase 2). |
| Prompt injection via recalled memory | High | Med | `sanitizeForPrompt` on the block + trusted-data rule + `<>`-strip. |
| Prompt injection via the ops distiller | Med | Med | Distiller input untrusted: delimited + output-schema-constrained (Phase 2). |
| PII in embeddings/logs | Med | Med | `brainSanitize` at capture; never log bodies (ids + outcome only). |
| IDOR on Your-Brain routes | Med | High | `requirePermission` + `user_id = req.user.sub`; org-scope delete/correct restricted to org admins (E5). |
| Unremovable org memory (departed author) | Low | Med | Org-admin management surface (E5). |
| Active-org spoofing | Low | High | Setter AND recall validate membership. |

No new secrets or npm deps. Recall SQL parameterized with `::vector`.

---

## Error & Rescue Registry

```
CODEPATH             | FAILURE MODE            | RESCUED | ACTION                                  | USER SEES
---------------------|-------------------------|---------|-----------------------------------------|------------------
recordMemory (any)   | anything                | Y       | internal try/catch, log, resolve void   | nothing (never crashes caller)
brainWorker.embed    | embed down/malformed    | Y       | attempt++, backoff, retry; ≥3 → failed  | delayed/no memory
brainWorker.distill  | LLM timeout/429/refusal | Y       | same backoff; keep raw if terminal      | keyword-recallable
brainWorker concurrency| overlap/ multi-inst   | Y       | SKIP LOCKED claim                       | no double-spend
recallMemories       | no ready memory         | Y       | skip before embed (existence gate)      | ungrounded (no cost)
recallMemories       | embed null / DB err / budget | Y  | skip recall, proceed                     | ungrounded (no error)
resolveActiveOrg     | stale/non-member org    | Y       | drop org scope this recall              | own memories only
digest/nudge job     | multi-instance          | Y       | pg advisory_lock guards the run         | one digest, not N
brain routes         | missing permission      | Y       | 403 via requirePermission               | access-denied
```
No catch-all swallow-and-continue except the deliberate best-effort capture path (logged with full context). **No `RESCUED=N + SILENT` row → no critical gaps.**

---

## Performance

- **No ANN index (E3):** recall is exact cosine over a tenant's own rows; the btree `(user_id, scope)` narrows to the slice first. Fast at realistic per-tenant sizes; Phase-3 compaction caps slice growth.
- **Zero-memory users pay nothing:** the `hasReadyMemory` gate skips the query-embed entirely (E-fold #10).
- **Cost:** chat = embed only (no LLM). Ops/compaction distillation = cheap `claude-haiku-4-5`, batched, claimed-once.
- **No N+1:** recall is one query + in-app re-rank over ≤30 rows; capture is one insert.
- **Pool:** shares the existing postgres.js pool; worker concurrency capped so it never starves requests.

---

## Observability

Structured logs (ids + outcome, never bodies) at capture, worker tick (claimed/ready/failed), recall (hit count, latency, budget-skip, **existence-skip**), digest. Metrics: memories/day by scope+source, worker queue depth + failure rate, recall hit-rate + p99 + skip-rate, distillation spend. **Because `recordMemory` swallows errors (E2), the capture-error-rate + memories/day alerts are a Phase-1 exit criterion — a 100%-broken capture must page, not look healthy.** Admin: brain flags + queue depth + "re-embed failed" action.

---

## Deployment & rollout

```
1. drizzle-kit push (additive tables + nullable cols → zero-downtime)
2. db:seed (perms + brain_* flags OFF)
3. backfillBrainPermissions (before enforcing)
4. deploy code (capture/recall gated OFF)
5. enable brain_capture_enabled (corpus warms)
6. wire + verify capture-error alert (Phase-1 exit criterion)
7. enable brain_recall_enabled
8. Phase 2: org tier + ops capture + digests; Phase 3: compaction + nudges
ROLLBACK: flags → "false" (instant, no deploy) → git revert. Tables additive.
```
No ANN index build step (E3), so no `CREATE INDEX CONCURRENTLY` write-lock concern. Digest/nudge jobs (Phase 2/3) guard runs with a `pg_advisory_lock`, not an in-memory flag, so multiple instances send one digest.

---

## Testing plan

- **Unit:** `brainSanitize`; the app-side rank blend; taxonomy classification; deterministic `resolveActiveOrg` (incl. **zero-org user → user scope only**); `recordMemory` **never rejects** (inject a DB failure, assert it resolves void + logs); worker backoff (attempt_count increments, terminal at 3, `next_attempt_dttm` honored).
- **Integration (real DB):** capture→claim→embed→recall round-trip; **user-isolation canary A∦B (Phase 1)**; org-canary X∦Y + removed-member∦org (Phase 2); exact-scan recall correctness; worker double-claim safety (`SKIP LOCKED`); upsert on the real unique constraint; every new route 200/401/403/404; org-scope delete/correct allowed for org admin, denied for member (E5); guest never records; ops fire-after-commit (memory-insert failure does NOT abort the PO — Phase 2).
- **Regression (CRITICAL, E1):** T6 streamChat await-parallelization asserts byte-identical prompt + output for the existing path with recall OFF.
- **E2E:** chat turn remembered + recalled next session; org recipe surfaces for a colleague (Phase 2); "Your Brain" delete removes from recall; correct→re-embed changes recall (Phase 2).
- **Failure/chaos:** embed API down (pending, chat answers); recall over budget (ungrounded); worker run twice (idempotent, claimed); poisoned row stops at 3 attempts.
- **LLM/prompt:** add the Brain-block injection to the prompt eval suite; verify the trusted-data guardrail resists an injected "ignore instructions" memory and the ops distiller resists a hijack.

---

## Phased implementation tasks

**Phase 1 — User-scope spine (ship first, fully exercised):**
- [ ] **T1 (P1)** — schema: `brain_memory` (incl. nullable `organisation_id` column for later, `attempt_count`, `next_attempt_dttm`), `unique(user_id, source_type, source_ref)`, `idx_user_scope`, `idx_status` partial. NO ANN index. `drizzle-kit push`.
- [ ] **T2 (P1)** — seed `brain:read`/`brain:manage` + `brain_*` settings (OFF); `backfillBrainPermissions.ts` (transactional).
- [ ] **T3 (P1)** — `brainSanitize` + unit tests.
- [ ] **T4 (P1)** — `recordMemory` (chat raw+embed, **internal catch, returns void**) + `brainWorker` (SKIP LOCKED claim, `processing`, `attempt_count` backoff, terminal `failed`).
- [ ] **T5 (P1)** — chat capture after [saveMessages](packages/server/src/services/conversationService.ts#L97) via `void recordMemory(...)`.
- [ ] **T6 (P1, E1)** — refactor [streamChat](packages/server/src/services/aiService.ts#L67) awaits to `Promise.all` (standalone) + **CRITICAL regression test** (byte-identical output, recall OFF).
- [ ] **T7 (P1, E1)** — `recallMemories` (exact scan, user-scope, `hasReadyMemory` gate, `sanitizeForPrompt`) as a concurrent promise spliced into streamChat with the trusted-data guard + latency budget + skip metric.
- [ ] **T8 (P1)** — "Your Brain" view/delete route + UI (consent baseline).
- [ ] **T9 (P1)** — wire + verify capture-error-rate + memories/day alert (**Phase-1 exit criterion**, E-fold).
- [ ] **T10 (P1)** — **user-isolation canary (A∦B)** + `recordMemory`-never-rejects test + `resolveActiveOrg`-zero-org test + route auth tests.

**Phase 2 — Org tier + capture breadth + reach + UI + digests (E4):**
- [ ] **T11 (P1)** — org tier: `user.selected_organisation_id` + deterministic selector + `idx_org_scope` + org-scope recall branch + org-canary (X∦Y, ex-member) + org-inherit warm-start.
- [ ] **T12 (P1)** — ops-event capture at curated call-sites (fire-after-commit, `void`) + ops distillation (untrusted-input hardened).
- [ ] **T13 (P2)** — recall in Labs + Copilot (seeded as specified).
- [ ] **T14 (P2)** — "Your Brain" rich controls: provenance, pin, correct(→re-embed), scope-toggle + **org-admin management surface** (delete/correct org memories, E5).
- [ ] **T15 (P2)** — org digest (`brainDigestService`, `pg_advisory_lock`-guarded) + delivery.

**Phase 3 — Intelligence layer:**
- [ ] **T16 (P2)** — add `last_recalled_dttm` (async best-effort write) + compaction/digest memories + per-scope cap.
- [ ] **T17 (P2)** — proactive nudges (`brainNudgeService`, advisory-lock-guarded, opt-in, rate-limited).
- [ ] **T18 (P3)** — ranking tuning + admin re-embed panel + dashboards.

---

## NOT in scope

- External gbrain / MCP — unnecessary; we own pgvector.
- ANN index — not needed while recall is tenant-filtered to a small slice (E3); add later if measured.
- Cross-org memory sharing; fine-grained per-memory ACLs beyond two-tier.
- Embedding-model swap tooling — 1536 dimension-locked.
- Connection-pooling overhaul — pre-existing gap, flagged.
- Evidence gate on Phases 2-3 — considered, declined (D9).

## Dream-state delta

Moves most of the way to the 12-month ideal: every AI surface grounded in the user's and org's real history. Remaining after Phase 3: cross-org benchmarking + fully proactive planning, both building on `recordMemory`/`recallMemories`.

## Long-term trajectory

Reversibility 4/5 (flag-killable, additive tables). Debt: the worker is an in-process interval with correct claiming + backoff. The `recordMemory`/`recallMemories` boundary is the seam every later feature uses.

## Worktree parallelization

Phase 1 is largely sequential on `packages/server/src/services/brain*` + `schema.ts`. Independent lanes once T1-T4 land: **Lane A** T8-T9 (Your-Brain UI + observability, `components/` + logging) can run parallel to **Lane B** T6-T7 (streamChat, `aiService`). T10 (tests) after both. Phase 2 lanes: org-tier (T11) → then T12/T13/T14/T15 are largely independent (capture call-sites vs Labs prompts vs UI vs digest job).

## Design/UX — UI scope detected

"Your Brain" page, active-org selector (Phase 2), nudge slot, org-digest view, org-admin management. **Recommend `/plan-design-review`** before the Phase 2 UI.

## Verification (end-to-end)

1. `drizzle-kit push` + `db:seed`; confirm `\d brain_memory` shows the unique constraint + btree indexes, **no** vector index.
2. Flip `brain_enabled` + `brain_capture_enabled`; send a chat turn; confirm a row appears and the worker moves it `pending→processing→ready`; kill the embed key and confirm a poisoned row stops at `attempt_count=3`, `failed`.
3. Flip `brain_recall_enabled`; new conversation referencing the earlier turn; confirm the `## Brain Memory` block is injected and the answer reflects it; confirm a brand-new user pays no embed (existence gate).
4. Run the user-isolation canary (A∦B); confirm the streamChat regression test is byte-identical with recall OFF.
5. curl every new route: 200 / 401 / 403 / 404.
6. Kill the embed provider; confirm chat still answers and `recordMemory` never crashes the process.

## UI/UX Design (design review — full 7-dimension pass)

**System:** no DESIGN.md; calibrate to CLAUDE.md's Infection-Virus standard. Tokens: `bg-surface-2/50` glass, `border-white/5`, amber `#FFD60A` + `shadow-[0_0_12px_rgba(255,214,10,0.15)]` glow on active/pinned/focus, `from-accent to-amber-600` on primary CTAs, `hover:-translate-y-0.5` + `ease-spring`, stagger-in on mount. **Classification: APP UI** (calm surface hierarchy, one accent, list-not-grid, utility copy). New components must fit this vocabulary: `MemoryRow`, `ProvenanceChip`, `ScopeToggle`, `BrainEmptyState`, `NudgeCard`, `BrainGroundedChip`.

**Design decisions:**
- **DR1 Recall trust signal (D3=A):** answers that used memory show a subtle, dismissible "grounded in your Brain" chip beneath the reply, expandable to reveal which memories informed it. Quiet by default, never per-sentence footnotes. New `BrainGroundedChip`, ships with recall (Phase 1).
- **DR2 Your Brain IA (D4=A):** scope segmented control [Private to you | Shared with your kitchen]; within each, newest-first + a source-type filter.
- **DR3 Nudge placement (D5=A):** dismissible `NudgeCard`s in a dedicated "For you" home/dashboard slot; opt-in, never interrupts.

**Information architecture (Your Brain page):**
```
┌ Your Brain ───────────────────────────────────────────────┐
│ Your Brain                                                 │ title
│ What CulinAIre remembers, so it always has your context    │ trust subtitle
│ [🔍 search…]                          [ Private | Shared ]  │ search + scope tabs
│ [chat][recipes][purchasing][waste] …           filter chips│
│ ┌────────────────────────────────────────────────────────┐│
│ │ Prefers gluten-free substitutions          ★   ⋯       ││ MemoryRow (hover: pin/edit/delete/scope)
│ │ from a chat · Jul 2                                     ││ ProvenanceChip
│ └────────────────────────────────────────────────────────┘│
│ … newest first …                                           │
└────────────────────────────────────────────────────────────┘
Empty (new user): hero glow icon · gradient "Your Brain is warming up" ·
"Keep cooking and chatting — CulinAIre starts remembering what matters to your kitchen."
```
Primary = the memory list; secondary = search/filter; tertiary = per-row actions (hover/focus). Nav item in the sidebar; active-org switcher in the top bar for multi-org users (Phase 2).

**Interaction states:**
```
FEATURE          | LOADING       | EMPTY                    | ERROR                          | SUCCESS                  | PARTIAL
-----------------|---------------|--------------------------|--------------------------------|--------------------------|--------------------------
Your Brain list  | skeleton rows | inspiring warm state     | "Couldn't load your memories — retry" | rows stagger-in          | "learning…" chip on rows still embedding
Delete memory    | row spinner   | —                        | "Couldn't remove that — try again"    | row fades + toast "Removed" | —
Scope toggle (P2)| toggle spinner| —                        | "Couldn't change sharing — retry"     | chip flips + toast        | —
Recall in chat   | (concurrent)  | no memory → no chip      | silent ungrounded (never an error)    | answer + grounded chip (DR1) | —
Nudge (P3)       | —             | no nudges → slot hidden  | —                              | dismissible card          | —
```
Empty states are warm and specific, never "No items found."

**User journey:**
```
STEP | USER DOES              | FEELS       | SUPPORTED BY
1    | opens Your Brain (new) | curious     | warm empty state
2    | keeps cooking/chatting | —           | silent capture
3    | AI recalls a note      | seen/trust  | DR1 grounded chip ("it remembered me")
4    | opens Your Brain again | in control  | scope tabs, provenance, edit/delete
5    | joins an org (Phase 2) | instant fit | inherits org-shared memories
```
Time-horizons: 5-sec = the grounded chip; 5-min = steering the list; 5-year = a Brain visibly, controllably smarter about this kitchen.

**Responsive & accessibility:**
- Mobile (375px): full-width rows; scope control = full-width toggle; hover actions → always-visible `⋯` overflow (no hover on touch); search collapses to an icon; ≥44px targets.
- a11y: `tablist`/`tab` semantics on the scope control; full keyboard nav (tab to row, Enter to expand, focusable actions); ARIA labels on icon-only actions; amber focus rings (≥3:1); body ≥16px and ≥4.5:1 contrast on dark; `prefers-reduced-motion` disables lift+stagger; the grounded chip is announced to screen readers.

**Anti-slop guardrails:** memories are a LIST with hover-reveal, never a 3-column card grid (hard-rejection #7); one amber accent only; no colored-left-border cards, no decorative blobs, no emoji-as-UI, a real typeface (not system-ui); provenance is a small chip.

**Design tasks (added):**
- [ ] **D-T1 (P1)** — `BrainGroundedChip` in chat (DR1), ships with recall (T7).
- [ ] **D-T2 (P1)** — `BrainEmptyState` + `MemoryRow` + `ProvenanceChip` + the states table for the Your-Brain baseline (T8).
- [ ] **D-T3 (P1)** — responsive + a11y spec on the Your-Brain baseline.
- [ ] **D-T4 (P2)** — `ScopeToggle` + scope tabs + source filter IA (DR2) on the rich page (T14).
- [ ] **D-T5 (P3)** — `NudgeCard` + "For you" dashboard slot (DR3) with nudges (T17).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | clean | 4 proposals, 4 accepted, 0 deferred |
| Codex Review | `/codex review` | Independent 2nd opinion | 2 (claude) | issues_found | CEO pass 9 (7 fixed); eng pass 10 (7 folded, 3 decided) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 5 findings, all resolved; 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | 3/10 → 9/10, 3 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

- **OUTSIDE VOICE:** two independent passes (Claude subagent; Codex not installed). CEO pass: 9 findings, 7 fixed. Eng pass: 10 new findings — 7 folded as defect-fixes (unique constraint, worker backoff, advisory-lock jobs, dropped `salience`, deterministic active-org, deferred `last_recalled_dttm`, zero-memory embed gate) and 3 decided by the user (E3 drop ANN / exact scan, E4 defer org tier to Phase 2, E5 org-admin management). Both passes confirmed the prior fixes hold.
- **CROSS-MODEL:** the outside voice found no disagreement with the review's architecture; it surfaced new defects both review lenses had missed (filtered-HNSW under-recall, upsert constraint, worker hot-loop, multi-instance digest safety). All resolved.
- **DESIGN:** full 7-dimension pass took design completeness 3/10 → 9/10; 3 decisions locked (DR1 trust-signal chip, DR2 scope-tab IA, DR3 dismissible nudge slot). AI mockups deferred — the designer needs an OpenAI key.
- **VERDICT:** CEO + ENG + DESIGN CLEARED — ready to implement.

NO UNRESOLVED DECISIONS

---

## Implementation status — Phase 1 SHIPPED (2026-07-05, branch `feature/ck-web/brain-spine`)

T1–T10 + D-T1..D-T3 are implemented, tested (server 479/479, client 42/42, shared 51/51; 21 Brain-specific tests incl. the A∦B canary), and verified end-to-end against the local DB — including a LIVE capture→embed→recall round-trip (real OpenRouter embedding; Antoine recalled a prior-session hollandaise fix with the grounded chip firing).

**Key files:** `brain_memory` in [schema.ts](../../packages/server/src/db/schema.ts) · `brainSanitize` / `brainCaptureService` / `brainWorker` / `brainRecallService` / `brainService` in `packages/server/src/services/` · routes `packages/server/src/routes/brain.ts` · capture hook in `conversationController.handleSaveMessages` · recall splice in `aiService.streamChat` · client `pages/YourBrainPage.tsx` + `components/brain/*` + `hooks/useBrainMemories.ts`.

**Documented deviations from this spec (all deliberate, none change locked decisions):**
1. **Worker claim selects `status='pending'` only** (spec's claim SQL listed `'failed'` too). The state machine makes `failed` terminal and the chaos criterion is "poisoned row stops at 3 attempts" — claiming failed rows would contradict both. Failed rows re-enter only via the future admin re-embed action. Stale `processing` rows (dead process) are reclaimed after 10 min.
2. **`resolveActiveOrg` not implemented in Phase 1** (T10 listed a zero-org unit test). E4 defers the org tier entirely; implementing an unused resolver would be dead code. The zero-org posture is covered by an integration test: a user with zero org memberships recalls user-scope memories.
3. **Deployment step 1 is NOT `drizzle-kit push`** — this DB has managed drift and the standing rule (lessons #52/#54) bans whole-schema push. The targeted, idempotent replacement is `packages/server/src/scripts/createBrainMemoryTable.ts` (already applied to local dev; run on prod before the code deploys).
4. **Brain-block fallback append**: the active system prompt is admin-editable DB content and was observed WITHOUT the `{{KITCHEN_CONTEXT}}` placeholder — a silent no-op splice would make the grounded chip lie. When the placeholder is missing, the Brain block is appended to the prompt end (kitchen context keeps its legacy placeholder-dependent behaviour; pre-existing gap flagged in lessons #55).
5. **`sanitizeForPrompt` applied per-item, not to the whole block** — applying it to the formatted block would strip the `## Brain Memory` label itself; per-item preserves the guard on untrusted content and the trusted scaffolding.

**Prod rollout checklist (unchanged otherwise):** run `createBrainMemoryTable.ts` → `db:seed` → `backfillBrainPermissions.ts` → deploy (flags OFF) → flip `brain_enabled`+`brain_capture_enabled` → wire log alert on `alert:"brain_capture_error"` + watch `GET /api/brain/stats` → flip `brain_recall_enabled`. **Prod prompt check:** verify the active `systemPrompt` row still contains `{{KITCHEN_CONTEXT}}`; if not, kitchen-context injection has been silently broken in prod (pre-existing) — restore the placeholder.
