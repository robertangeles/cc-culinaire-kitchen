# Wiki Session Log

Append-only. Newest entry on top.

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
