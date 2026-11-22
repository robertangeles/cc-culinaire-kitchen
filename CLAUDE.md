# CLAUDE.md — CulinAIre Kitchen

## 0. Read Before You Write
Before writing, read every file you will touch. Copy existing patterns and check imports to see what the project actually uses. Ask when you cannot find a pattern.

## 1. Think Before Coding
State assumptions explicitly. Name tradeoffs. If multiple interpretations exist, present them — do not pick silently. Stop and ask when genuinely confused. Role play as Nobel Laureate solving this problem.

## 2. Simplicity
Minimum code for the problem now. No speculative features, abstractions, or impossible-case error handling. Hardcode values until there is a real reason to configure. Test: if abstracted only "in case we need to" — over-built.

## 3. Surgical Changes
Touch only what the task requires. Match existing style. No reformatting. Every changed line must trace to the request. "While I was in there" → revert.

## 4. Goal-Driven Execution
Define success criteria before coding. For multi-step tasks, state the plan first.
`"Add validation"` → `"reject malformed email, return 400, test both cases"`

## 5. Dependencies
Every dependency is permanent code you do not control. Check stdlib first. State why when adding one.

## 6. Communication
Say what you did and why. Flag concerns even when you did exactly what was asked. Precise uncertainty: "I am not sure this library supports streaming" not "I think this should work."

## 7. Common Failure Modes
- **Kitchen Sink** — restructuring unrelated code
- **Wrong Abstraction** — generalising after two copy-pastes
- **Optimistic Path** — 500 unhandled
- **Runaway Refactor** — fix cascades across files

Stop when you catch any of these.

---

## Workflow

**Plan Mode** — any task with 3+ steps or architectural decisions. Re-plan immediately if anything goes sideways.

**Subagents** — spawn liberally, one task each for focused execution.

**Self-Improvement Loop** — after ANY user correction or significant implementation: update `tasks/lessons.md`. Format: Problem / Fix / Rule. Review at session start.

**Verification** — never mark done without proof. Ask: "Would a staff engineer approve this?" Update the matching dev brain page (`architecture/`, `specs/`) before closing any user-facing task.

**Jev semantic lint (advisory)** — before opening a PR, run `node --env-file=.env scripts/jev/lint.mjs` (needs `TYPESAFE_API_KEY` in `.env`; costs a fraction of a cent). It asks TypeSafe's Jev model whether the branch diff breaks the rules in `scripts/jev/rules.mjs` (business logic in routes, LLM called outside `aiService`, hardcoded secrets/config, endpoint without permission, FK without index). Read every flag and decide; flags are leads, never verdicts, and never block a merge. **Data rule:** only source diffs go out — never prod data, secrets or user details. Rules and thresholds live only in `rules.mjs`. Add a rule only after testing it on `scripts/jev/lintPilot.mjs` cases. Jev is for narrow yes/no or scored decisions; it cannot write or edit code. Skip it where grep, types or tests already decide.

**Demand Elegance** — ask "Is there a more elegant solution?" If hacky, refactor before presenting.

**Autonomous Bug Fixing** — investigate logs and resolve without requiring user guidance. Fix failing tests and CI independently. Always follow Debugging Protocol.

---

## Testing

Write the failing test first. Watch it fail. Then fix. Test behavior that can break, not that a constructor sets a field. Hard to test = information about the design.

New features require: unit, integration, E2E, edge cases and failure scenarios.

Every new service function needs a unit test. Every new API endpoint needs an integration test. Every user-facing feature needs at least one E2E test. Test the unhappy path: invalid input, missing auth, rate limits, edge cases.

**Regression protocol before closing any task:**
1. `pnpm test`
2. `pnpm test:integration` (against the Render dev DB these suites are very slow; for the real-DB ones run `scripts/localIntegrationDb.sh start`, then `eval "$(scripts/localIntegrationDb.sh env)"`; 58 tests take 8 s there)
3. `pnpm tsc:check` (never bare `pnpm tsc`: it emits `.js` files into `src/` and breaks vitest)
4. Schema changed → add a numbered migration in `packages/server/src/migrations/` and apply it with `src/scripts/migrate.ts` (never `drizzle-kit push` against a shared or production database: it has drifted from `schema.ts`, see `tasks/lessons.md` #50, #52, #56). `drizzle-kit push` is only for a throwaway local database
5. Verify every touched route: 200 happy path, 401 no auth, 400/404 bad params — frontend wired only after backend verified
6. Report pass/fail before closing

---

## Debugging Protocol (MANDATORY)

1. Read error exactly as written. Do not interpret.
2. Identify exact file, line, function.
3. Label anything beyond the error as [Inference].
4. No fix until root cause confirmed by evidence.
5. Unknown root cause → "I need more information" + list what.
6. One problem. One fix. One test. Change one thing at a time.
7. Never paper over a null. Find why it is null.

Format every response:
- Confirmed: [what error proves]
- Evidence: [file, line, log]
- Root cause: [if confirmed]
- Fix: [after root cause only]
- Verify with: [command or test]

---

## Enterprise Quality

- No shortcuts, workarounds, or generic error messages
- No hardcoded config — admin-controllable
- API keys via database Integrations panel only
- No unused code ships — verify all code paths
- Make a real test API call when integrating any external service
- UI changes refresh immediately without page reload

---

## Architecture

Separation of concerns: frontend (UI only), backend (API, validation, auth), controllers (validate input, call services, format responses), services (domain logic, AI, knowledge), routes (thin wrappers).

**Monorepo structure:**
```
packages/
  client/src/
    components/ | pages/ | context/ | hooks/ | styles/
  server/src/
    routes/ | controllers/ | services/ | db/ | middleware/ | utils/
  shared/src/
    types/ | utils/
prompts/chatbot/
mobile/                       (Expo phone app; a workspace member, imports @culinaire/shared)
tasks/todo.md | tasks/lessons.md
```
Notes, plans and docs are not in the repo: they live in the dev brain (see Dev Brain below).

Never create files at repo root under `client/`, `server/`, or `shared/`. Always use `packages/client/`, `packages/server/`, `packages/shared/`.

**Phone app (`mobile/`).** Its scripts are named `check:types`, `check:lint`, `check:test`, `check:bundle` on purpose: turbo's `lint`/`tsc:check`/`test`/`build` skip it. Every `pnpm install` (CI, Render) installs the phone app's dependencies too: with `node-linker=hoisted` pnpm's `--filter` does not exclude a workspace from install (tested 2026-11-19), so the only deploy guard is Render's path filter ignoring `mobile/**`. CI's separate `mobile` job runs them (build `packages/shared` first: Metro follows `main` into `dist/`). `check:test` runs logic tests (node) and screen tests (`mobile/tests/`, real screens through react-native-web in jsdom; tests never go under `mobile/app/`, which expo-router turns into routes). `check:e2e` runs the phone's real client, session, count store and outbox against a running server and the seeded E2E user (also a step in the CI E2E job). Locally: `pnpm --filter @culinaire/mobile run check:types` etc. Never add a `build` script to `mobile/package.json` (the web deploy runs `turbo run build`). React is pinned to one version for the whole workspace in `pnpm-workspace.yaml` `overrides`; bump it together with the Expo SDK, never separately. Screens never call `fetch` (lint rule); only `mobile/src/api` does.

Rules:
- Routes must never call LLM APIs directly → `aiService` only
- No business logic inside routes or controllers
- No business logic inside frontend components

**Ports:** Frontend (Vite): 5179 · Backend (Express): 3009. Never change without explicit confirmation. Never default to 3000 or 5173.

---

## Database (Drizzle + PostgreSQL)

Standards apply to all schema files, migrations, and ad-hoc SQL. All schema changes require a migration file.

Every table: 2NF minimum. No repeating groups or comma-separated values. Exception: pgvector `embedding` and JSONB audit columns where noted.

Analytics: strict star schema. `fact_` tables with numeric measures only. `dim_` tables for dimensions. Never mix OLTP and OLAP.

**Naming:**
| Object | Pattern | Example |
|---|---|---|
| Tables | snake_case **plural** | `recipe_versions` |
| Fact tables | `fact_` prefix | `fact_recipe_usage` |
| Dimension tables | `dim_` prefix | `dim_ingredient` |
| Primary key | `id` UUID | `id uuid primary key` |
| Foreign keys | `{table_singular}_id` | `user_id`, `recipe_id` |
| Timestamps | `created_at`, `updated_at` | on every table |
| Booleans | `is_` or `has_` prefix | `is_published` |
| Junctions | both names, alphabetical | `ingredient_recipe` |

No camelCase in SQL. No abbreviations beyond `id`, `url`.

Index rules: every FK gets an index — no exceptions. Every index needs a comment stating the query it serves. Partial indexes preferred for low-selectivity booleans. pgvector columns use `ivfflat` with `lists` tuned to dataset size.

**Before any schema review confirm:** normal form satisfied, every FK indexed, naming violations flagged, OLTP vs OLAP identified. State any deviation explicitly before proceeding.

Drizzle rules: never `select *`. Use `.prepare()` for repeated queries. Log generated SQL in development. Raw SQL for complex/OLAP queries. Always use connection pooling.

---

## Knowledge Base

Culinary knowledge lives in Postgres:
- `knowledge_documents` — one row per document (title, source, metadata)
- `knowledge_document_chunks` — chunked text + pgvector embeddings

Manage exclusively through admin UI at **Settings → Knowledge Base** (`KnowledgeBaseTab.tsx`). Server ingest: `knowledgeManagementService.ts`. Chatbot reads via `searchKnowledge` / `readKnowledgeDocument`. Mobile reads via `retrieveForMobile`.

Never embed knowledge documents inside code files. Add content through the admin UI, not the repo.

---

## Prompt Management

Templates live in `prompts/chatbot/` — never hardcoded in application logic. Treat as immutable source. Never modify without understanding the runtime path — the prompt loader and mobile prompt-fetch route both read from it.

---

## API

`POST /api/chat` — Request: `{ message }` → Response: `{ response, sources[] }`

Conversation schema:
- `conversations`: id, user_id, created_at
- `messages`: id, conversation_id, role (user|assistant), content, timestamp

---

## Access Control — Permission-Driven (MANDATORY)

Every feature that exposes data or actions is gated by a **permission**, never a hardcoded role. Access checked against user's `permissions[]` populated at login.

**Administrator is superuser with implicit all-access** — bypasses every `requirePermission` on server (`middleware/auth.ts`) and every client check (`useHasPermission`, `filterNav`). Non-admin roles get a new permission ONLY when explicitly granted.

**Nav-hiding is UX only. Hiding a sidebar item is never access control.** Server route is the security boundary. Every gated nav item MUST have matching server `requirePermission` AND client route guard.

**Checklist — adding a new permission (ALL steps required):**

1. **Define the key.** Add `"<domain>:<action>"` (e.g. `orders:read`, `orders:manage`) to `defaultPermissions` in `db/seed.ts`. Split read vs write unless reason not to.
2. **Grant to non-admin roles.** Add to `rolePermMappings` in `db/seed.ts` for Subscriber / Paid Subscriber. Administrator excluded — superuser bypass applies.
3. **Seed it.** `pnpm --filter @culinaire/server db:seed`. Unseeded key is invisible in Settings → Roles editor.
4. **Enforce all three layers:**
   - Server: `requirePermission("<key>")` on the route(s) in `routes/`
   - Client route: wrap in `RequirePermission anyOf={["<key>"]}` in `App.tsx`
   - Nav: add to `components/layout/navConfig.ts` with `gate: { anyPermission: ["<key>"] }`
5. **Backfill existing installs.** Write idempotent script under `server/src/scripts/` (pattern: `backfillNavPermissions.ts`). Run BEFORE enforcing code deploys — else existing users 403. Wrap grant loop in transaction.
6. **Test the boundary.** Integration test: 403 without permission, 200 with it, 401 without token, pass for Administrator (pattern: `routes/navPermissions.test.ts`).

---

## Security

OWASP review on every feature: Broken Access Control, Cryptographic Failures, Injection, Insecure Design, Misconfiguration, Outdated Components, Auth Failures, Data Integrity Failures, Logging Failures, SSRF.

Security tests for every feature: validation unit tests, API integration tests, malicious input tests, auth/authorization tests, edge cases.

Threat modeling for every new feature: attack surfaces, privilege escalation risks, data exposure risks, abuse scenarios.

Rules: parameterized queries always · env vars for all secrets · least privilege access · never commit `.env` files · never expose raw API errors · risk introduced → flag, propose safer implementation, document mitigation.

---

## UI — Infection Virus Design Standard (MANDATORY)

Every UI element must make the user want to touch it. Not optional polish — core requirement.

Rules:
- **Glass morphism** — `backdrop-blur`, semi-transparent backgrounds (`bg-surface-2/50`), `border-white/5` for depth layers
- **Amber glows** — selected/active/focused elements: `shadow-[0_0_12px_rgba(255,214,10,0.15)]`
- **Gradient accents** — `bg-gradient-to-r from-accent to-amber-600` on buttons and highlights — never flat colors
- **Hover lift** — interactive cards: `hover:-translate-y-1 hover:shadow-dark-lg`
- **Micro-animations** — spring easing (`ease-spring`), scale-in on selection, slide-up on mount, shimmer on loading, pulse on idle CTAs
- **No flat surfaces** — every card and panel has depth through gradients, borders, or shadows
- **Stagger animations** on list/grid mounts
- **Keyboard shortcuts** visible on every major action
- **Empty states** — hero icons with glow, gradient text, quick-start cards — never clinical
- **Progress bars** — color gradients: green → amber → red

Building new UI: apply glass morphism → add hover lift → stagger animations on mount → focus states with accent glow rings.

---

## Git

`main` auto-deploys via Render. CI must pass before merging — never bypass.

**Always ask for explicit confirmation before `git push`. Never push automatically.**

- All changes go through a feature branch — no direct commits to `main`
- Feature branches max 2 days, merge `--no-ff`
- For incomplete features touching shared code: use feature flags
- Pull `main` before starting any new branch
- One feature per branch — never bundle unrelated changes
- PR descriptions: assume the next reader has zero context
- Code review required for non-trivial changes before merging
- Never rebase shared branches
- Never force push to `main`
- Never commit `.env` files
- Never skip pre-commit hooks (Husky + lint-staged)

Branch naming: `feature/ck-web/<slug>` · `fix/ck-web/<slug>` · `hotfix/ck-web/<slug>` · `refactor/ck-web/<slug>`

CI: `pnpm install --frozen-lockfile` → lint → `tsc --noEmit` → vitest → build. All must pass.

Commit format: `<verb> <area>: <detail>`

---

## Dev Brain (gbrain)

Project notes, plans, decisions and design docs live in the **dev brain**, a gbrain database on the HERMES home server, not as files in this repo. It replaces the old `wiki/` and `docs/` folders (still in git history). Not the same as the Knowledge Base above, which is product data for customers.

**Reach it.** The database only listens on HERMES, so open the SSH tunnel first (away from home, Tailscale must be on):
```bash
ssh -f -N -L 5433:127.0.0.1:5432 hermes
export GBRAIN_HOME=~/.gbrain-culinaire-dev    # CLI config; Claude Code uses the same through its `gbrain` MCP server
gbrain stats                                  # ~81 pages. A connection error means the tunnel is down: say so, do not work around it
```
New machine: see the README in the private repo `robertangeles/culinaire-dev-brain`.

Run `gbrain get index` at every session start.

**Slugs** are paths, no `.md`: `entities/`, `concepts/`, `decisions/` (with date and rationale), `synthesis/`, `raw-index/` (pointers to `prompts/` and briefs, which stay where they are: code reads `prompts/*` at runtime), `architecture/`, `specs/`, `designs/`, `qa/`, `security/`; plus top-level `index` and `log`. `tasks/todo.md` and `tasks/lessons.md` stay files in this repo; the brain's `todo` and `lessons` pages are old snapshots, never edit them.

**Page format** (front matter, then the body; link pages with `[[slug]]`):
```
---
title:
category: [entity|concept|decision|synthesis|raw-index]
created: YYYY-MM-DD
updated: YYYY-MM-DD
related: [[slug]]
---
```

**Read and search** (keyword search only; embeddings are off on purpose, turning them on needs the owner's consent):
`gbrain search "<keywords>"` · `gbrain get <slug>` · `gbrain graph <slug>` · `gbrain backlinks <slug>` · `gbrain orphans`. Search and follow links before opening full pages.

**Write:**
- New page: `gbrain put <slug> < page.md`
- Change a page: read its revision with `gbrain get <slug> --json`, edit, then `gbrain put <slug> --expected-revision <rev> < page.md`. Never `--force`.
- Always add a new page to `index`, and bump `updated:` on any page you change.
- After adding `[[slug]]` links run `gbrain extract links --source db`.
- Reusable synthesis goes in `synthesis/`.

**Log.** After every session, append a `## YYYY-MM-DD — <title>` entry to the end of the `log` page: `gbrain append log < entry.md`. (Newest is last now; the old file had newest first.)

**Ingest** (a source worth keeping): write it as a page, open every overlapping page and cross-link it, create `entities/` or `concepts/` pages for new subjects, update `index`, append to `log`, run `gbrain extract links --source db`.

**Lint.** `gbrain doctor` after any bulk change. Surface contradictions between pages to the user; never silently overwrite.

**Backup.** `ck-prod-backup brain` runs daily from the owner's laptop to the private offsite repo (brain page `architecture/offsite-backup`). Check `~/.local/state/ck-backup/last_success_brain` at session start.

---

## Shared Context

Location: `../cc-culinaire-shared-context/` — read at the start of every cross-project session.

**File ownership:**
- YOU OWN: `api-contracts.md`, `db-schema.md`, `web-needs.md` — update immediately when routes, schema, or needs change
- READ ONLY: `mobile-needs.md`, `model-config.md` — check `mobile-needs.md` at session start

**Cross-project workflow:**
1. Need something from mobile → write to `web-needs.md`
2. Pending need in `mobile-needs.md` → fulfill and mark complete
3. Significant cross-project decisions → `decisions.md` with today's date
4. Never guess at mobile requirements — read `mobile-needs.md` first

---

## gstack (REQUIRED)

```bash
test -d ~/.claude/skills/gstack/bin && echo "GSTACK_OK" || echo "GSTACK_MISSING"
```

If GSTACK_MISSING: STOP. Install before proceeding:
```bash
git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup --team
```

Skill routing: see `~/.claude/CLAUDE.md` (`# gstack` section) — applies here too; if a task doesn't clearly match a stage, invoke `/gstack` to route it.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec