# Wiki Session Log

Append-only. Newest entry on top.

---

## 2026-06-16 — Dev/prod database separation (+ migrations rejected)

**What was done**

Split local dev off the shared production Postgres. Local dev now runs against a local Postgres (`culinaire_kitchen_dev`) seeded from a sanitized prod snapshot (`pg_dump` read-only → `pg_restore` → new `packages/server/scripts/sanitize-local.sql`: PII nulled, secret/token tables deleted, fresh local encryption keys, uniform dev password, `admin@local.test`). Root `.env` repointed to local with rotated keys; prod URL saved to gitignored `.env.production.local`. Added a boot guard in `packages/server/src/db/index.ts` that refuses a remote DB host unless `NODE_ENV=production`.

**Decided**

Did **not** adopt drizzle-kit versioned migrations. A drift gate (baseline `0000` from `schema.ts` → empty throwaway DB → `pg_dump --schema-only` diff vs prod snapshot) reconfirmed [[schema-drift-may-2026]] and surfaced new drift (4 DB functions/triggers, `citext`/`uuid-ossp`, code-only indexes, `_fkey` vs verbose FK names). Removed the migration scaffolding; the repo keeps its targeted-tsx-script workflow until drift is reconciled.

**Touched**: `wiki/decisions/dev-prod-db-separation.md` (new), `wiki/synthesis/schema-drift-may-2026.md` (drift items 5–8 + 2026-06-16 section), `wiki/index.md`, `tasks/lessons.md` (#52).

---

## 2026-06-01 — Formula audit: complete catalog + reconciliation matrix

**What was done**

Full audit of every formula in the CulinAIre Kitchen calculation engine. Read 13 source files across the server and shared packages, documented 27 formulas with forward/backward proofs, and created a reconciliation matrix showing how stock-affecting and cost-affecting operations must balance.

**Pages created**
- `wiki/concepts/formula-catalog.md` — 27 formulas across 8 categories (Unit Conversion, Stock, WAC, Menu Cost, Prep, PO, Forecast, Yield Variance). Each formula documented with ID, source file:line, inputs/outputs, precision/rounding, forward proof, backward proof, dependency chain, conversion system used, and test file status.
- `wiki/concepts/reconciliation-matrix.md` — 8 operations mapped (receiving, transfer send, transfer receive, stock take approve, consumption, waste logging, PO creation, menu cost recalculation) with stock effects, cost effects, balance rules, and 5 cross-operation invariants.

**Key findings**
- Two unit conversion systems coexist: System A (static, `shared/utils/units.ts`) for menu cost engine, System B (DB-backed, `unitConversionService.ts`) for stock take. Documented explicitly to prevent confusion.
- Pure math modules (`prepMath.ts`, `poMath.ts`, `stockMath.ts`, `forecastMath.ts`) are well-separated from I/O services. These are the easiest to test and have the best coverage.
- Test coverage gaps identified: `poMath.ts`, `wacService.ts`, `stockService.ts`, `thresholdService.ts`, `autoPoSuggestService.ts`, and `forecastService.ts` (integration) all lack dedicated test files.
- Precision varies across formulas: `.toFixed(2)` is the most common (menu costs, PO totals), `Math.round` for prep portions, `Math.floor` for depletion days, `Math.ceil` for reorder quantities, and `Math.round(x*1000)/1000` for on-hand display. All documented per formula.

**Pages updated**
- `wiki/index.md` — added both new concept entries.

---

## 2026-05-05 — Play Console legal-URL pattern: SPA-route surface override + `/delete-account`

Two web sessions today, both driven by Play Console submission requirements for the mobile app.

### Session 1 — Privacy + Terms wired to mobile-surface rows (PR #15, merged)

Robert needed a public HTTPS URL for Play Console's "Privacy policy URL" listing field. The web SPA already had `/privacy` and `/terms` routes (from commit `9d770f1`), but they fetched `/api/site-pages/{slug}` with the controller's default `surface=web` — and only the mobile-surface rows are published on prod (web rows are still draft, intentionally per the 2026-05-03 surface-partition decision). So a Play reviewer hitting `https://www.culinaire.kitchen/privacy` was getting the SPA's "Page not found" state.

Discovery flow worth keeping for the next time a "page is published but the URL 404s" report comes in:

1. Pulled main, ran `pnpm install` (lockfile drift from PR #15's tree-shaking — `tesseract.js` flagged for `pnpm approve-builds`, approved).
2. Naive curl `https://www.culinaire.kitchen/privacy` returned `Cannot GET /privacy` (Express envelope) — initially thought the route wasn't mounted, mirroring the 2026-05-03 incident. Re-checked with a browser-like `Accept: text/html` header and the SPA fallback at [packages/server/src/index.ts:338-346](../packages/server/src/index.ts#L338-L346) kicked in → 200 + SPA shell. Lesson: the SPA fallback is gated on Accept; curl's default `*/*` misses it. Always test with browser headers when reasoning about what reviewers see.
3. Curled `/api/site-pages/privacy?surface=web` → JSON 404 envelope `{"error":"Page not found"}` and `/api/site-pages?surface=web` → `[]`. That's the "route mounted, data layer null" envelope from the 2026-05-03 decision — pointed straight at publish-state, not deploy.
4. Confirmed Robert's "I published this a long time ago" was correct for `surface=mobile` (10,344 bytes / 14,211 bytes on prod, matches yesterday's resolution log) and unfilled for `surface=web`. Same admin-UI surface ambiguity from yesterday's incident — the editor doesn't show the surface, only the sidebar group does.

Fix: SPA-route surface override. New optional `surface` prop on `<PublicPage>`, passed through to `usePublicPage`; `App.tsx` passes `surface="mobile"` on `/privacy` and `/terms` only. `/pages/:slug` (the generic catch-all) and the controller default both stay on `web`, so future admin-authored web pages still work. Three-line change. Verified locally with Playwright (full-page screenshots saved to `C:/tmp/legal-{privacy,terms}.png`); after merge + Render auto-deploy, re-verified against prod (new bundle hash `index-kloymna2.js`, h1s and bodies all match).

### Session 2 — `/delete-account` for Play data-deletion policy (in flight)

Mobile session posted a new ask in `mobile-needs.md` — Google Play's data-deletion policy requires a public URL with three required elements (app/dev name, deletion steps, data-deleted/kept breakdown), enforced at Closed Testing review onward. Same SPA-route surface-override pattern fits cleanly:

1. Server `sitePageService.ts` — added `delete-account` to `RESERVED_SLUGS` and to the boot-time seed list. New seed count is 2 surfaces × 3 slugs = 6 inserts. Updated tests for both the new reserved-slug guard and the seed count.
2. Client `App.tsx` — added `<Route path="/delete-account" element={<PublicPage slug="delete-account" surface="mobile" />} />` next to `/privacy` and `/terms`.
3. Server suite green (217 passed); client typecheck clean.

The post-deploy step is on Robert: open `Settings → Mobile → Pages → Deleting your account`, paste the body (suggested copy supplied by mobile in `mobile-needs.md`), tick Published. URL goes into Play Console → App content → Data deletion → "Delete account URL".

### Pattern documented

[concepts/surface-partition.md](concepts/surface-partition.md) updated with a new "SPA-route surface override" section explaining when to override the default `web` surface at the route level vs at the controller default. Cross-repo `decisions.md` (`cc-culinaire-shared-context/decisions.md`) is the canonical source for the pattern across both repos — added a 2026-05-05 entry that lists the three URLs (`/privacy`, `/terms`, `/delete-account`) and the four-step recipe for adding a new one.

The takeaway: app-store review URLs are a third class of consumer for the `site_page` table. Web users default to web copy, mobile users default to mobile copy, and reviewers get the mobile copy via SPA-route override. The controller default stays `web` because that's still the right answer for everything else.

---

## 2026-05-03 (afternoon) — Mobile v1.2 unblock, cross-repo coordination, auto-injected shared-context hook

Three concurrent work streams, all driven by the parallel mobile session.

### Mobile v1.2 unblock — commit `62ce119`

The mobile session asked (URGENT in `mobile-needs.md`) for an FR placeholder slug + a feature-flag endpoint so the v1.2 language picker could be tested end-to-end without waiting for the authored translation + eval pass. Shipped both:

- **FR placeholder.** [packages/server/src/scripts/createFrPlaceholderPrompt.ts](../packages/server/src/scripts/createFrPlaceholderPrompt.ts) — idempotent one-shot that inserts a device-runtime `prompt` row with key `antoine-system-prompt-fr`. Body is the EN body verbatim with `[PLACEHOLDER — pending culinary review, not production-ready]` as the first line so no downstream reader can mistake it for the authored translation. Reachable at `GET /api/mobile/prompts/antoine-system-prompt-fr` via the existing route — no controller change required.
- **`GET /api/mobile/feature-flags`** — new route, Bearer-authed, reuses the 30 req/min `mobilePromptRateLimit`. Sets `Cache-Control: public, max-age=3600` (drops to private/no-store if per-user flags are added later). Response shape `{ "languages_enabled": ["en"] }` driven by a new `mobile_languages_enabled` site setting (JSON-encoded array). Service falls back to `["en"]` on parse failure so the mobile picker always has at least the default. Forward-compatible — adding a `features` map later won't break older mobile clients. Tests cover parse fallbacks, cache header, error pass-through (13 new tests; server suite now 173 passing).

### Cross-repo coordination

Parallel mobile asks landed in shared-context throughout the day; this session owned the responses:

- **`shared-context/api-contracts.md`** — rewritten. Endpoints A (Mobile Prompt Fetch), B (Mobile RAG Retrieval), C (Mobile Feature Flags), and D (Public Site Pages with the `?surface=` query param) all populated with auth, rate limits, response shapes, and behavioural notes. Authentication and Subscription Verification still TBD.
- **`shared-context/decisions.md`** — appended a durable record: mobile consumes Terms + Privacy via the JSON site-pages API scoped by surface, not by linking out to the web HTML pages.
- **`shared-context/mobile-needs.md`** — both today's mobile asks marked complete with URLs, repro commands, and cache-header notes.

A late-afternoon mobile ask landed (`mobile-needs.md` head): prod `GET /api/site-pages/{terms,privacy}?surface=mobile` still returning 404 despite Robert ticking Published in the admin. Working hypothesis from mobile: the admin UI was toggling the **web**-surface rows, not the mobile ones — i.e. either the `Settings → Mobile → Pages` tab is wired to the wrong surface or Robert clicked under `Settings → Web → Pages` by accident. Open; not yet investigated.

### Auto-injected shared-context (hook)

Wired a `UserPromptSubmit` hook in [.claude/settings.local.json](../.claude/settings.local.json) that runs before every prompt and injects the head of `mobile-needs.md` and `decisions.md` (~80 lines each, with mtime headers) wrapped in `<system-reminder>`. Trade: ~10 KB of context per turn for cross-repo awareness without manual prompting. Confirmed firing this session — no longer need the user to nudge me with "check shared context".

Recommended reading order for any future session: this entry, then `mobile-needs.md` head (already auto-injected), then `decisions.md` head (also auto-injected). Older entries from earlier today below.

---

## 2026-05-03 — Settings scope clarity + dead `knowledge-base/` folder removed

**Settings reorganised by app surface.** The Settings sidebar now groups tabs under **Web / Mobile / Shared**. Empty primary groups still render their header with a "No tabs yet" hint so the cherry-pick targets stay visible. Tab placement is configurable via a new optional `group` field on the tab registry in [SettingsLayout.tsx](../packages/client/src/components/settings/SettingsLayout.tsx).

Two existing single-tab features were extended to support per-surface scoping using the same pattern:
- **Prompts** — `PromptsTab` accepts `runtimeFilter` (`"server" | "device"`); registry now has a Mobile-scoped Prompts tab (`runtime='device'`) and the Shared one filters to `runtime='server'`. Antoine and the other on-device prompts now appear under Mobile → Prompts only.
- **Pages** — `PagesTab` accepts `surface` (`"web" | "mobile"`). The `site_page` table gained a `surface` column with composite unique on `(slug, surface)`, applied to the remote DB via a one-shot idempotent script ([addSitePageSurface.ts](../packages/server/src/scripts/addSitePageSurface.ts)) because `drizzle-kit push` was hanging on an interactive prompt even with `--force`. Reserved slugs (`terms`, `privacy`) are now seeded for both surfaces; the mobile app's legal copy is fully separate from the web's.

**Knowledge base folder removed.** The top-level `knowledge-base/` folder (10 markdown files seeded in the project's earliest weeks) had no runtime consumer — no `fs.readFile`, no `readdir`, no SHA-256 sync. The wiki page describing it was actively wrong about boot-time behaviour. Removed via `git rm -r knowledge-base/` (recoverable from history) and rewrote [raw-index/knowledge-base.md](raw-index/knowledge-base.md) to point at the actual source of truth: the `knowledge_document` + `knowledge_document_chunk` Postgres tables, authored through Settings → Knowledge Base.

**Prompts folder pruned.** Audit found the `prompts/` folder was genuinely live but had drifted. The `seed.ts` recipe-lab block referenced three files that either never existed (`recipePromptV2.md`) or had been deliberately deleted in Phase 8 (`patisseriePrompt.md`, `spiritsPrompt.md`). The `try/catch` wrapper meant `pnpm db:seed` was silently failing for three of four recipe-lab prompts on every fresh deploy. Per the Phase 8 commit message ("Recipe prompts moved from MD files to database (admin-editable)"), the deliberate target state is DB-only authoring through Settings → Mobile → Prompts. Cleaned up:
- Removed the `recipePrompts[]` seeding block + `RECIPE_PROMPTS_DIR` constant from `packages/server/src/db/seed.ts`.
- Deleted `prompts/recipe/patisseriePromptV2.md`, `prompts/recipe/spiritsPromptV2.md`, and `packages/server/src/db/migrations/update-domain-prompts-v2.ts` — the V2 files only existed as inputs to that one-shot migration, which has long since been applied.
- Deleted the duplicate `prompts/recipe/recipeRefinementPrompt.md`; preserved the canonical `prompts/chatbot/recipeRefinementPrompt.md` as the runtime fallback for `promptService.loadPromptFromFile()` (which hard-codes `PROMPTS_DIR = prompts/chatbot`).
- Updated [entities/prompt-system.md](entities/prompt-system.md) to reflect DB-as-source-of-truth, marked [decisions/duplicate-recipe-refinement-prompt.md](decisions/duplicate-recipe-refinement-prompt.md) RESOLVED, and ticked off the todo entry.

End state of `prompts/`: just two files, both genuinely load-bearing — `prompts/chatbot/systemPrompt.md` (seed + runtime fallback) and `prompts/chatbot/recipeRefinementPrompt.md` (runtime fallback only).

**Docs swept** to remove stale references and the fictitious `buildIndex()` startup step:
- `CLAUDE.md` — folder listing trimmed; "Knowledge Base Structure" section rewritten to describe DB-backed storage; wiki rules updated to drop the `knowledge-base/` immutability claim.
- `docs/architecture/overview.md`, `docs/architecture/technical-guide.md`, `docs/architecture/data-flow-diagrams.md` — folder listings trimmed; startup sequence corrected to `ensureSeededPages()` (truthful) instead of `buildIndex()` (never existed); Knowledge Base section rewritten around pgvector + admin UI.
- `wiki/index.md`, `wiki/concepts/technical-architecture.md` — pointer entries updated.

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

## 2026-05-26 — Recipe purge FK fix + schema drift catalog

**Problem**: Server logged `Recipe archive purge failed` on every startup. PG error 23503: `recipe_version_recipe_id_fkey` FK had no ON DELETE rule, so `purgeArchivedRecipes` couldn't delete recipes that had any version rows.

**Fix shipped**:
- Edited `packages/server/src/db/schema.ts` — added `onDelete: "cascade"` to `recipeVersion.recipeId` FK, `onDelete: "set null"` to `prepTask.recipeId` and `prepMenuSelection.recipeId`.
- Wrote `packages/server/scripts/fix-recipe-fk-cascade.ts` — targeted tsx migration that applied the two real FK changes (`recipe_version` → CASCADE, `prep_menu_selection` → SET NULL) in a transaction. Verified via `scripts/check-recipe-fks.ts`.
- `drizzle-kit push` aborted before applying anything (pg_stat_statements_info bug + unrelated drift it wanted to surface). Used the targeted script instead.

**Drift surfaced (NOT fixed today, see synthesis page)**:
1. `prep_task.recipe_id` — code declares FK with SET NULL, DB has no constraint at all.
2. `knowledge_document.file_path` — column dropped from code, DB still holds 18 rows.
3. Five unique constraints declared but missing on live DB (`guide.guide_key`, `model_option.model_id`, `bench_channel.channel_key`, `recipe.slug`, `store_location.store_key`).
4. `drizzle-kit push` bug: tries to drop `pg_stat_statements_info` view, postgres rejects.

**Wiki pages touched**
- Created `wiki/synthesis/schema-drift-may-2026.md` — full drift catalog + safe migration workflow.
- Updated `wiki/index.md` — added synthesis entry.
- Appended `tasks/lessons.md` — lesson #50 (never `drizzle-kit push` blind).

**Rule going forward**: until the drift list is zero, all schema changes go through targeted tsx scripts under `packages/server/scripts/` following the `apply-ckm-feedback.ts` pattern. No `drizzle-kit push`.

## 2026-06-16 — Org-admin permissions + supplier address

Fixed two onboarding blockers and added supplier addresses (branch `fix/ck-web/org-create-admin-role-state`):
- **Org admin → inventory perms**: new org creators (system role Subscriber) got 403 "Insufficient permissions" on inventory/purchasing routes. `getUserWithRolesAndPermissions` now unions an `ORG_ADMIN_PERMISSIONS` set when the user is `admin` of any org; `handleCreateOrganisation` re-mints the JWT (exported `setAuthCookies`) so perms apply without re-login. See lesson #51.
- **Location-less org resolution**: `resolveOrgId` (8 copies) derived org from location context only → 400 for location-less admins. `LocationContext` now exposes `organisationId` from membership; each `resolveOrgId` falls back to it.
- **Supplier address**: `supplier` table gained the 6-field address block (mirrors organisation/store_location). Migration via targeted tsx script `scripts/add-supplier-address.ts` (no `drizzle-kit push`, per lesson #50). Wired through Zod schemas, `createSupplier`/`updateSupplier`, client `Supplier` type, and the `SupplierManager` form. Verified create+update round-trip via API.
