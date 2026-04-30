# Wiki Session Log

Append-only. Newest entry on top.

---

## 2026-04-30 — Ways of working: every PR ships with a structured description

**What was established**
User formalised a norm after PR #9: every pull request opened against this repo must include a structured description body covering Summary / Why / What ships / Out of scope / Test plan / Risk / Depends on. Default `gh`-generated bodies and one-liners are not acceptable. PR #9's description is the canonical example.

**Why now**
PR #9 (catalog-spine Phase 1) was the first PR to include this kind of structured overview. The user explicitly asked for it on every subsequent PR so reviewers (and future Claude sessions) can understand the PR without reading every commit. Without "Out of scope" + "Test plan" sections, every review re-surfaces scope-creep questions that should have been answered upfront.

**What was done**
- Wrote [wiki/concepts/pr-description-template.md](concepts/pr-description-template.md) — the seven required sections, the `--body-file` pattern (write to `C:/tmp/pr<N>-body.md` first), what NOT to do.
- Indexed in `wiki/index.md`.
- Saved as a feedback memory in the user's auto-memory store so the norm persists across machines + sessions.
- PR #9's description was retroactively written in the new format and is referenced as the canonical example.

**How this composes with existing rules**
- CLAUDE.md "Git Workflow — Trunk-Based Development" — covers commits + branching but not PR descriptions specifically. This concretises that gap.
- Existing commit message format ("verb area: detail") still applies per CLAUDE.md.
- The Dev-server + Playwright norm (2026-04-29) feeds directly into the "Test plan" section of the PR body.

---

## 2026-04-29 — UI ways of working: Dev server + Playwright as a default

**What was established**
User formalised a working norm: every UI change in this project must be rendered in the live dev server and inspected via Playwright before being reported as done. No "should work" without a screenshot. Backend-only changes still follow the curl-based regression protocol from CLAUDE.md.

**Why now**
Established at the kickoff of Phase 0 of the catalog-spine initiative, before any UI work lands. Scoping the rule before Phase 1 ships keeps the IngredientPicker variants, Unlinked badge, allergen rollups, variance pills, and mise en place sheet from accumulating round-trips on visual defects.

**What was done**
- Wrote [wiki/concepts/dev-server-plus-playwright-verification.md](concepts/dev-server-plus-playwright-verification.md) — workflow, port reminders (Vite 5179 / Express 3009), backend-vs-frontend distinction, tool selection (`webapp-testing` / `browse`).
- Indexed in `wiki/index.md`.
- Also saved as a feedback memory in the user's auto-memory store so future Claude sessions on different machines pick it up.

**How this composes with existing rules**
- CLAUDE.md "Verification Before Done" — that section already mandated end-to-end verification; this concretises *how* for UI.
- CLAUDE.md "Local Development Ports" — same ports referenced (5179 / 3009).
- CLAUDE.md "Regression Testing Protocol" — Playwright is additive for UI; curl coverage of API routes still required separately.

---

## 2026-04-29 — CI pipeline wired up (post-mortem on Render deploy failure)

**What happened**
A Render deploy failed on `tsc` with TS2493 in `packages/server/src/middleware/rateLimiter.test.ts:116` — a vitest mock-call tuple typing weakness compiled into production output because the server tsconfig had no `*.test.ts` exclude. The test file landed via PR #6 (`7d876d4`) and survived two intermediate commits before our docs push triggered a rebuild that exposed it.

**What was done**
1. Fix (commit `ec0e422`): excluded `**/*.test.ts` from `packages/server/tsconfig.json`. Render redeployed cleanly.
2. Investigation: confirmed there is **no** `.github/workflows/`, no Husky, no lint-staged. CLAUDE.md describes a CI pipeline that was never wired up. PR #6 had no automated check whatsoever.
3. Wire-up (this work, on `feature/ck-web/wire-up-ci`):
   - `.github/workflows/ci.yml` — single job, 5 steps mapped 1:1 to CLAUDE.md (install / lint / tsc:check / test / build), Node 22, pnpm 10.31.0 pinned to `packageManager`, ubuntu-latest, 15-min cap, concurrency cancellation per ref.
   - Added `tsc:check` script to each package + a turbo task. `pnpm tsc:check` runs all three packages in ~6.5s locally.
   - Wrote [wiki/decisions/ci-pipeline.md](decisions/ci-pipeline.md) with the full failure-mode mapping and trade-offs considered.

**Why a feature branch this time**
Per CLAUDE.md, changes >3 files normally branch. More importantly: the very first run of the new workflow needs to happen on the PR, not on main, so we can see green/red before it gates anything else. If we'd committed to main directly, the first CI run would have been on main — and a broken CI on main would block subsequent PRs too.

**Follow-ups not done in this branch**
- Branch protection rule on `main` requiring this check before merge (must be configured in GitHub Settings → Branches; not in code).
- Husky + lint-staged for pre-push fast feedback (CLAUDE.md describes this; it doesn't exist either). Optional after CI is green.
- E2E (Playwright) tests in CI — needs a separate workflow with services. Deferred.

---

## 2026-04-29 — Mobile API contract documented

**What was done**
Wrote [wiki/concepts/mobile-api-contract.md](concepts/mobile-api-contract.md) — the first cross-cutting concept page filling a gap surfaced in the original audit. Documents the contract between this web monorepo (API only, port 3009) and the separate CulinAIre mobile repo (React Native, on-device Gemma 3n E4B).

**Coverage**
- Auth transport split — Bearer header (mobile) vs httpOnly cookie (web), unified by one `authenticate` middleware
- Mobile-specific entry point — `POST /api/auth/google/idtoken` returns `tokens` in body for keychain storage
- The single `/api/mobile/*` route — `GET /api/mobile/prompts/:slug` (commit `128a119`), with rate-limit (30/min/user), slug regex validation, and the deliberate 404-unification that prevents server-runtime prompt enumeration
- Device tokens — `device_token` table is wired and registration works; FCM/APNs dispatch is **not yet implemented**
- Notification types defined for the kitchen-ops events that mobile will eventually listen on
- Test coverage points that lock the contract
- Three known gaps for the backlog: push dispatch, mobile token rotation, sparse `/api/mobile/*` namespace

**Bidirectional links added**
Updated `related:` frontmatter on `culinaire-kitchen-platform`, `prompt-system`, `technical-architecture` to link back to the new page. Hook auto-rebuilt the graph: 11 → 12 nodes, 23 → 26 edges → final state after this turn includes 6+ edges into `mobile-api-contract`.

**Why this page first**
Highest-leverage gap from the audit: there's a parallel mobile repo whose Claude session needs this contract written down. API drift between repos is the highest-risk class of cross-repo work.

**Validation**
- PostToolUse hook fired on the Write — graph rebuilt automatically.
- `node scripts/wiki-graph.mjs neighbors mobile-api-contract` confirms wiring.
- All file:line citations in the page were sourced from the live codebase via an Explore subagent — verifiable.

---

## 2026-04-29 — Claude Code hooks for wiki workflow

**What was done**
Added two hooks to `.claude/settings.json` so the wiki workflow stops being best-effort and becomes harness-enforced.

- `PostToolUse` on `Edit|Write|MultiEdit` → runs `node scripts/wiki-graph.mjs auto`. The new `auto` subcommand reads the hook input from stdin, gates on `tool_input.file_path` matching `wiki/*.md`, and rebuilds `wiki/.graph.json` silently. Non-matching paths and malformed JSON exit 0 silently — never blocks tool flow.
- `Stop` (no matcher → fires on every Claude stop) → emits a JSON `systemMessage` reminding to append a dated entry to `wiki/log.md` if anything significant happened in the turn. Soft nudge, does not block Stop.

**Files changed**
- `scripts/wiki-graph.mjs` — added `auto` subcommand for stdin-gated hook entrypoint.
- `.claude/settings.json` — added `hooks.PostToolUse` + `hooks.Stop` blocks; preserved all 48 existing `permissions.allow` entries.

**Why this matters**
Previously the "rebuild graph after wiki edit" and "log session work" loops relied on Claude remembering. With hooks, the harness runs them — Claude's discretion is no longer required.

---

## 2026-04-29 — Level 2 + Level 4 tooling wired up

**What was done**
Added the Karpathy gist's Level 2 (fast local search) and Level 4 (graph relationships) tooling. Both implemented as pure-Node scripts under `scripts/`, no new dependencies.

**Files created / changed**
- `scripts/wiki-search.mjs` — Level 2: regex search across all wiki `.md` files; `-c` flag prints 2-line context per match.
- `scripts/wiki-graph.mjs` — Level 4: walks wiki/, parses minimal frontmatter, extracts every `[[slug]]` reference (frontmatter + body), persists `wiki/.graph.json`. Subcommands: `build`, `stats`, `neighbors <slug>`, `orphans`, `category <name>`, `broken`.
- `.gitignore` — added `wiki/.graph.json` (regenerable artefact).
- `CLAUDE.md` — added "Wiki tooling" subsection under the LLM Wiki section with usage and an upgrade note (swap JSON for `node:sqlite` past ~1000 nodes).
- `wiki/index.md` — added a "Tooling" section table.

**Decisions taken**
- Karpathy's gist names `qmd` for Level 2; on npm `qmd` is a dead placeholder package (v0.0.0, no code). Substituted with a pure-Node text searcher to avoid shipping a squatted dep.
- Bash version of `wiki-search` was scrapped because `rg` is not on PATH in Git Bash on this machine (only buried inside VS Code's bundled extensions). Pure-Node path is portable across shells.
- For Level 4 the gist suggests SQLite; v1 uses JSON because (a) the graph is tiny (11 nodes today) and inspectable, (b) zero deps, (c) Node 22+ ships `node:sqlite` built-in so the upgrade is one swap when needed.

**Smoke tests**
- `wiki-search OpenRouter` → 7 hits across concepts, decisions, entities, synthesis, index, log.
- `wiki-search -c hollandaise` → context preview from `raw-index/knowledge-base.md`.
- `wiki-graph stats` → 11 nodes, 23 edges. By category: concept 2, decision 2, entity 3, raw-index 2, synthesis 2.
- `wiki-graph neighbors prompt-system` → outgoing 2, incoming 3.
- `wiki-graph broken` → none.
- `wiki-graph orphans` → none.

---

## 2026-04-29 — Wiki initialisation from existing markdown

**What was done**
Initialised the LLM Wiki Brain by auditing every markdown file under `docs/`, `knowledge-base/`, `prompts/`, `tasks/`, and the repo root, and creating a structured wiki alongside the originals (no relocations, no deletions).

**Pages created**
- `wiki/index.md` — master catalog
- `wiki/log.md` — this file
- `wiki/entities/culinaire-kitchen-platform.md`
- `wiki/entities/store-locations-system.md`
- `wiki/entities/prompt-system.md`
- `wiki/concepts/technical-architecture.md`
- `wiki/concepts/data-flow-architecture.md`
- `wiki/decisions/openrouter-migration.md`
- `wiki/decisions/duplicate-recipe-refinement-prompt.md`
- `wiki/synthesis/project-status.md`
- `wiki/synthesis/lessons-index.md`
- `wiki/raw-index/knowledge-base.md`
- `wiki/raw-index/landing-page-creative-brief.md`

**Decisions taken during this session**
- `knowledge-base/` and `prompts/` stay where they are. Both are read by code at runtime (pgvector sync, prompt loader, mobile fetch endpoint, runtime guard). The wiki documents them via pointer pages under `wiki/raw-index/` and `wiki/entities/` instead of moving them.
- `raw/` is conceptual ("immutable source content"), not a literal folder. No `raw/` directory was created.
- `tasks/lessons.md` and `tasks/todo.md` stay in `tasks/`. Wiki gets `wiki/synthesis/lessons-index.md` and `wiki/synthesis/project-status.md` as discoverable surfaces.
- `CLAUDE.md` stays in place; `wiki/index.md` links to it as the most important document in the project.
- Duplicate prompt file at `prompts/recipe/recipeRefinementPrompt.md` is logged in `wiki/decisions/duplicate-recipe-refinement-prompt.md` and added to `tasks/todo.md` for cleanup. Not deleted yet.

**Gaps and questions identified**
- Phase 6 in `tasks/todo.md` is partially captured in `wiki/synthesis/project-status.md` (read was truncated at line 60) — recommend a follow-up read of the full file to backfill remaining shipped items and any "Up Next" entries.
- No wiki coverage yet for: the Purchasing v1 work (POs, approvals, receiving, credit notes), the Stock Room, Recipe Lab/Patisserie Lab/Spirits Lab as distinct entities, the Community / The Bench, or RBAC roles + permissions architecture. These are real pieces of the product per `CLAUDE.md` and `docs/architecture/overview.md` but have no dedicated docs to migrate from.
- Mobile repo is separate; web side has the API contract but no architectural doc describing the cross-repo handshake (commit `128a119`, prompt runtime guard tests in `c263bad`). Would benefit from a `wiki/concepts/mobile-api-contract.md`.
- `tasks/lessons.md` was only read to ~line 60 — the lessons-index lists 1–8 explicitly; remaining ~37 entries should be skimmed and added to the index in a follow-up session.

**Originals preserved**
No files moved. No files deleted. Wiki is purely additive.
