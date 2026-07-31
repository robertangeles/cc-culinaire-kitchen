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

**Verification** — never mark done without proof. Ask: "Would a staff engineer approve this?" Update `docs/` before closing any user-facing task.

**Demand Elegance** — ask "Is there a more elegant solution?" If hacky, refactor before presenting.

**Autonomous Bug Fixing** — investigate logs and resolve without requiring user guidance. Fix failing tests and CI independently. Always follow Debugging Protocol.

---

## Testing

Write the failing test first. Watch it fail. Then fix. Test behavior that can break, not that a constructor sets a field. Hard to test = information about the design.

New features require: unit, integration, E2E, edge cases and failure scenarios.

Every new service function needs a unit test. Every new API endpoint needs an integration test. Every user-facing feature needs at least one E2E test. Test the unhappy path: invalid input, missing auth, rate limits, edge cases.

**Regression protocol before closing any task:**
1. `pnpm test`
2. `pnpm test:integration`
3. `pnpm tsc`
4. Schema changed → `drizzle-kit push` from `packages/server/`
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
docs/architecture/ | docs/specs/
tasks/todo.md | tasks/lessons.md
wiki/
```

Never create files at repo root under `client/`, `server/`, or `shared/`. Always use `packages/client/`, `packages/server/`, `packages/shared/`.

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

Branch naming: `feature/ck-web/<slug>` · `fix/ck-web/<slug>` · `hotfix/ck-web/<slug>`

CI: `pnpm install --frozen-lockfile` → lint → `tsc --noEmit` → vitest → build. All must pass.

Commit format: `<verb> <area>: <detail>`

---

## Wiki

Read `wiki/index.md` at every session start.

Folders:
- `entities/` — named things (Antoine, RAG pipeline, subscription system)
- `concepts/` — patterns and ideas (architecture, data flow, RAG, voice persona)
- `decisions/` — architectural decisions with date and rationale
- `synthesis/` — cross-cutting analysis, open questions
- `raw-index/` — pointer pages to `prompts/`, briefs (wiki documents these, never relocates them)

Note: `raw/` is conceptual only — no literal `raw/` folder. `prompts/*` stays where it is; code reads it at runtime.

**Page format:**
```
---
title:
category: [entity|concept|decision|synthesis|raw-index]
created: YYYY-MM-DD
updated: YYYY-MM-DD
related: [[slug]]
---
```

Always update `wiki/index.md` when creating a page. Always append `wiki/log.md` after every session.

**Ingest** (`pnpm wiki:ingest --url <url>` | `--file <path>` | `--paste --slug <slug>`):
1. `--in-repo` for small public sources. Else `--external` → `wiki/raw-index/`
2. Read the placed page in full
3. Open every overlapping page — update, add `[[slug]]` cross-ref, bump `updated:`
4. Create new `entities/` or `concepts/` pages if source introduces new subjects
5. Update `wiki/index.md`
6. Append `wiki/log.md` with `## YYYY-MM-DD — Ingest: <title>`
7. `pnpm wiki:graph build`
8. `pnpm wiki:lint`

**Lint** (`pnpm wiki:lint`) — run at session start (>50 pages), before any PR touching `wiki/`, after every ingest. Fix hard errors first. Surface contradictions to user — never silently overwrite.

**Query** — `pnpm wiki:search` and `pnpm wiki:graph neighbors <slug>` before opening full pages. Reusable synthesis → `wiki/synthesis/`.

**Graph** (`pnpm wiki:graph`): `build`, `stats`, `neighbors <slug>`, `orphans`, `category <name>`, `broken`. Run `build` after any `related:` or `[[slug]]` edit.

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

Skill routing: `/office-hours` (ideas) → `/plan-ceo-review` (strategy) → `/plan-eng-review` (architecture) → `/investigate` (bugs) → `/qa` (testing) → `/review` (code) → `/design-review` (visual) → `/ship` (deploy) → `/spec` (backlog)