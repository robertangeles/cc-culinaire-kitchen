# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

------------------------------------------------------------------------

# Project Overview

CulinAIre Kitchen is a multi-module operating system for working culinary professionals — the line cook trying to fix a broken hollandaise at midnight, the restaurateur approving POs across two locations, the patissier iterating on a new dough. It's not a recipe site and it's not a spreadsheet replacement. It's an AI-grounded workbench that sits next to the actual cooking and the actual running of a kitchen.

The product clusters into roughly four lobes today, all reachable from a single sidebar:

-   **Chat Assistant** — the founding module. A culinary knowledge chatbot grounded in curated content for technique, pastry, spirits, and ingredients. The "ask anything, get a real answer" door.
-   **Creative Labs** — Recipe Lab, Patisserie Lab, Spirits Lab. R&D space for developing new dishes, pastries, and cocktails.
-   **Kitchen Operations** — the running-a-kitchen toolkit: Recipe Book, Stock Room (inventory), Purchasing (POs, approvals, receiving with photo evidence and credit notes), Menu Intelligence, Kitchen Copilot, Waste Intelligence. This is the area you've been pushing hardest lately — the Purchasing v1 work in the recent commits is here.
-   **Community** — a shared CulinAIre Recipe Book + The Bench (real-time chat for the operator/chef community).

The audience is operators, not engineers, so copy is plain English, key info stays above the fold, no jarring loading flashes during normal flows, no scrolling for the things they look at most.

In short: knowledge access + creative R&D + day-to-day kitchen ops + community, wrapped in an AI workbench that feels like it was built by someone who's actually stood on the line.

------------------------------------------------------------------------

Project Rules for Claude Code Project: CulinAIre Kitchen

------------------------------------------------------------------------

# Workflow Orchestration

## 1. Plan Mode Default

-   Enter plan mode for ANY non-trivial task (3+ steps or architectural
    decisions)
-   If something goes sideways, STOP and re-plan immediately --- do not
    keep pushing
-   Use plan mode for verification steps, not just building
-   Write detailed specs upfront to reduce ambiguity

## 2. Subagent Strategy

-   Use subagents liberally to keep main context window clean
-   Offload research, exploration, and parallel analysis to subagents
-   For complex problems, use multiple subagents for parallel reasoning
-   One task per subagent for focused execution

## 3. Self-Improvement Loop

-   After ANY correction from the user: update `tasks/lessons.md`
-   After ANY significant implementation, architectural decision, or
    non-obvious bug fix: record it in `tasks/lessons.md`
-   Format: Problem / Fix / Rule
-   Write rules that prevent repeating mistakes
-   Review lessons at session start

## 4. Verification Before Done

-   Never mark a task complete without proving it works
-   Diff behavior between main and your changes when relevant
-   Ask: "Would a staff engineer approve this?"
-   Run tests, check logs, demonstrate correctness
-   When any user-facing feature is added or modified, the corresponding
    `docs/` file must be created or updated before the task is marked
    complete

## 5. Demand Elegance (Balanced)

-   For non-trivial changes ask: "Is there a more elegant solution?"
-   If a fix feels hacky, refactor before presenting
-   Avoid over-engineering simple problems

## 6. Autonomous Bug Fixing

-   When given a bug report: investigate logs and errors and resolve it
-   Do not require the user to guide debugging steps
-   Fix failing tests and CI issues independently when possible

## 7. Testing Standards

Act as a senior QA engineer. Test at the smallest level possible.

When a new feature is added, generate:

1.  Unit tests — for services, utilities, and pure functions
2.  Integration tests — for API routes with real database
3.  End-to-end tests — for full user flows
4.  Edge cases and failure scenarios

Rules:

-   Every new service function needs a unit test
-   Every new API endpoint needs an integration test
-   Every user-facing feature needs at least one E2E test
-   Test the unhappy path: invalid input, missing auth, rate limits,
    edge cases

### Regression Testing Protocol

After every new feature, before marking work complete:

1. Run the full test suite: `pnpm test`
2. Run integration tests: `pnpm test:integration`
3. Check for TypeScript errors: `pnpm tsc`
4. If any DB schema changes were made, run `drizzle-kit push` (from `packages/server/`) to sync the remote database
5. **MANDATORY: Test every new/updated API route via curl or ctx_execute fetch:**
   - List every route the feature touches
   - Verify 200 + correct response shape for happy path
   - Verify 401 without token
   - Verify 404/400 for invalid params
   - Only wire the frontend AFTER backend routes are verified
6. Smoke test all affected routes and list them in your task summary
7. Confirm no existing tests were broken, modified, or deleted without justification
8. Report pass/fail results before closing the task

Never consider a feature done until all existing tests pass, the database schema is in sync, and all API routes are verified via curl.

## 8. Enterprise Code Quality

Every change must meet production-grade standards:

-   No shortcuts, workarounds, or "good enough" implementations
-   Every feature must be tested end-to-end before marking complete
-   Error handling must be specific and actionable (no generic messages)
-   Configuration must be admin-controllable (no hardcoded values that
    users need to change)
-   API keys and credentials must be database-driven via the
    Integrations panel
-   UI changes must refresh immediately without requiring a page reload
-   Unused or experimental code must not ship — verify all code paths
    work
-   When integrating any external API, make a real test call during
    implementation to verify the endpoint/model/key works

## 9. Debugging Protocol

Follow this sequence strictly. Do not skip steps.

1. Read the error output exactly as written. Do not interpret.
2. Identify the exact file, line, and function where the error originates.
3. State only what the error message confirms. Label anything else [Inference].
4. Do not suggest a fix until root cause is confirmed by evidence in the code or logs.
5. If root cause cannot be determined from available information, state: "I need more information." Then list exactly what information is needed.
6. Never guess. Never patch. Never suggest multiple fixes hoping one works.
7. One confirmed problem. One evidence-based fix. One test to verify.

### Investigation Format

Every debugging response must follow this structure:

- Confirmed: [what the error proves]
- Evidence: [exact file, line, log output]
- Root cause: [only if confirmed by evidence]
- Fix: [only after root cause is confirmed]
- Verify with: [exact command or test]

------------------------------------------------------------------------

# Architecture Principles

The system must follow:

-   Separation of concerns
-   Modular architecture
-   Maintainable code
-   Scalable services
-   Clear folder structure

Frontend, backend, AI services, prompts, and knowledge content must
remain separated.

## Database Design — Mandatory Standards

Apply these rules to ALL database work in this project, including migrations,
schema files, Drizzle ORM definitions, and any ad-hoc SQL.

---

### 1. Normalization (2NF)

- Every table must be in Second Normal Form before review.
- No transitive dependencies. Each non-key column depends only on the primary key.
- Repeating groups, comma-separated values, and JSON blobs used as relational
  columns are not allowed.
- Exception: pgvector `embedding` columns and JSONB audit/metadata columns
  are permitted where explicitly noted in a comment.

---

### 2. Star Schema (Analytics Layer)

- Separate OLTP tables (normalized, transactional) from OLAP tables
  (denormalized, reporting).
- Analytics tables follow strict star schema:
  - One central fact table per analytical domain (e.g. `fact_usage`)
  - Dimension tables prefixed with `dim_` (e.g. `dim_user`, `dim_role`)
  - Fact tables hold foreign keys to dimensions and numeric measures only.
  - No dimension data lives inside a fact table.
- Do not mix OLTP and OLAP concerns in the same table.

---

### 3. Naming Conventions

| Object           | Pattern                          | Example                     |
| ---------------- | -------------------------------- | --------------------------- |
| Tables           | `snake_case`, plural noun        | `recipe_versions`           |
| Fact tables      | `fact_` prefix                   | `fact_recipe_usage`         |
| Dimension tables | `dim_` prefix                    | `dim_ingredient`            |
| Primary key      | `id` (UUID preferred)            | `id uuid primary key`       |
| Foreign keys     | `{referenced_table_singular}_id` | `user_id`, `recipe_id`      |
| Timestamps       | `created_at`, `updated_at`       | standard on every table     |
| Boolean cols     | `is_` or `has_` prefix           | `is_published`, `has_image` |
| Junction tables  | both entity names, alphabetical  | `ingredient_recipe`         |

- No abbreviations unless universally understood (e.g. `id`, `url`).
- No camelCase in SQL or schema files.

---

### 4. Index Strategy

- Every foreign key column gets an index. No exceptions.
- Add a composite index when two or more columns are consistently queried together.
- Unique constraints replace unique indexes wherever the constraint is semantic
  (e.g. `unique(user_id, recipe_id)` on a junction table).
- pgvector columns use `ivfflat` index with `lists` tuned to dataset size.
- Do not add indexes speculatively. Every index must have a stated query it serves,
  written as a comment directly above the index definition.
- Partial indexes are preferred over full indexes for low-selectivity boolean
  columns (e.g. `WHERE is_published = true`).

---

### Enforcement

Before generating or reviewing any schema:

1. State which normal form the table satisfies.
2. Confirm every FK has an index.
3. Flag any column that violates naming conventions.
4. Identify whether the table is OLTP or OLAP and confirm it follows the
   correct design pattern for that layer.

If a design decision deviates from any rule above, state the deviation
explicitly and provide a justification before proceeding.

------------------------------------------------------------------------

# Project Folder Structure

This is a **pnpm monorepo**. All application code lives under `packages/`.

    cc-culinaire-kitchen/

    packages/
      client/
        src/
          components/
          pages/
          context/
          hooks/
          styles/
      server/
        src/
          routes/
          controllers/
          services/
          db/            ← Drizzle ORM schema + migrations (no models/ folder)
          middleware/
          utils/
      shared/
        src/
          types/
          utils/

    knowledge-base/
      techniques/
      pastry/
      spirits/
      ingredients/

    prompts/
      chatbot/

    docs/
      architecture/
      specs/

    tasks/
      todo.md
      lessons.md

Claude must follow this structure when generating code. Never create
files under `client/`, `server/`, or `shared/` at the repo root —
always use `packages/client/`, `packages/server/`, `packages/shared/`.

------------------------------------------------------------------------

# Separation of Concerns

## Frontend

Location:

    packages/client/src/

Responsibilities:

-   UI rendering
-   chat interface
-   API communication
-   state management

Rules:

-   HTML contains structure only
-   CSS contains styling only
-   JavaScript handles UI behavior
-   No business logic allowed

------------------------------------------------------------------------

## Backend

Location:

    packages/server/src/

Responsibilities:

-   API endpoints
-   request validation
-   authentication
-   orchestration of services

Backend must never contain frontend UI logic.

------------------------------------------------------------------------

## Services Layer

Location:

    packages/server/src/services/

Examples:

-   aiService
-   chatService
-   knowledgeService

Responsibilities:

-   domain logic
-   AI integration
-   knowledge retrieval

------------------------------------------------------------------------

## Routes

Location:

    packages/server/src/routes/

Routes must remain thin.

They should:

-   receive requests
-   call controllers
-   return responses

------------------------------------------------------------------------

## Controllers

Location:

    packages/server/src/controllers/

Responsibilities:

-   validate input
-   call services
-   format responses

Controllers must not contain heavy business logic.

------------------------------------------------------------------------

## Database / Models

Location:

    packages/server/src/db/

The project uses **Drizzle ORM** with PostgreSQL. There is no `models/`
folder. Database entities (User, Conversation, Message, etc.) are
defined as Drizzle table schemas in `packages/server/src/db/schema.ts`.
Migrations are managed via `drizzle-kit` and output to
`packages/server/drizzle/`.

------------------------------------------------------------------------

# Knowledge Base Structure

The chatbot uses curated culinary knowledge content.

    knowledge-base/

Example structure:

    knowledge-base/

    techniques/
      searing.md
      emulsions.md
      braising.md

    pastry/
      custards.md
      doughs.md
      creams.md

    spirits/
      cocktail-structures.md
      classic-cocktails.md

    ingredients/
      herbs.md
      acids.md
      fats.md

Claude must not embed large knowledge documents inside code files.

------------------------------------------------------------------------

# Prompt Management

Prompt templates live inside:

    prompts/chatbot/

Examples:

    systemPrompt.md
    techniquePrompt.md
    troubleshootingPrompt.md

Prompts must never be hardcoded inside application logic.

------------------------------------------------------------------------

# API Design

Example endpoint:

    POST /api/chat

Request:

    { "message": "How do I sear scallops?" }

Response:

    { "response": "...", "sources": [] }

------------------------------------------------------------------------

# Conversation Handling

Conversation schema example:

    conversation: id, user_id, created_at
    message:      id, conversation_id, role, content, timestamp

Roles:

-   user
-   assistant

------------------------------------------------------------------------

# AI Integration

AI service location:

    packages/server/src/services/aiService.ts

Responsibilities:

-   construct prompts
-   call LLM APIs
-   return responses

Routes must never call LLM APIs directly.

------------------------------------------------------------------------

# Security Guidelines

-   Store API keys in environment variables
-   Never commit secrets
-   Validate all request inputs
-   Sanitize user data
-   Implement rate limiting

------------------------------------------------------------------------

# Documentation

Documentation location:

    docs/

Structure:

    docs/
      architecture/
      specs/

------------------------------------------------------------------------

# Code Quality Rules

-   Keep files small and focused
-   Prefer modular functions
-   Avoid deeply nested logic
-   Use descriptive variable names
-   Avoid duplicated logic

------------------------------------------------------------------------

# MANDATORY: Infection Virus Design Standard

Every UI element must make the user want to touch it. This is not optional polish — it is a core design requirement for every page, component, and interaction in the application.

## Principles

- **Glass morphism**: Use `backdrop-blur`, semi-transparent backgrounds (`bg-surface-2/50`), and `border-white/5` to create depth layers
- **Subtle amber glows**: Selected, active, and focused elements get soft glow shadows (`shadow-[0_0_12px_rgba(255,214,10,0.15)]`)
- **Gradient accents**: Buttons, borders, and highlights use gradients (`bg-gradient-to-r from-accent to-amber-600`) instead of flat colors
- **Depth that pulls you in**: Radial gradient backgrounds, inner shadows on inputs, cards that lift on hover (`hover:-translate-y-1 hover:shadow-dark-lg`)
- **Micro-animations that respond**: Spring easing (`ease-spring`), scale-in on selection, slide-up on mount, shimmer during loading, pulse on idle CTAs
- **Per-platform identity**: Each social platform gets its own accent color for chips, tabs, and preview cards — never generic gray
- **No flat surfaces**: Every card, panel, and section should have visible depth through gradients, borders, or shadows
- **Keyboard-first power user flow**: Every major action has a keyboard shortcut with visible hints

## When Building New UI

1. Apply glass morphism to cards and panels
2. Add hover lift effects to interactive cards
3. Use platform-specific colors where applicable
4. Add stagger animations on list/grid mounts
5. Ensure focus states have accent glow rings
6. Progress bars and counters use color gradients (green → amber → red)
7. Empty states must be inspiring, not clinical — use hero icons with glow, gradient text, and quick-start cards

---

# When Generating Code

Claude must:

-   follow the folder structure
-   maintain separation of concerns
-   keep files modular
-   avoid monolithic code
-   generate production-quality implementations

# Security and Testing Standards

Security must be considered during development, not after.

All new functionality must include security review and testing aligned with OWASP principles.

## Security Review Requirements

When generating or modifying code:

- Review for common vulnerabilities
- Validate input handling
- Ensure proper authentication and authorization
- Prevent injection vulnerabilities
- Avoid hardcoded secrets
- Validate external dependencies
- Ensure secure configuration defaults

## OWASP Risk Categories

Code and APIs must be reviewed for the following classes of risk:

1. Broken Access Control
2. Cryptographic Failures
3. Injection Vulnerabilities
4. Insecure Design
5. Security Misconfiguration
6. Vulnerable or Outdated Components
7. Authentication Failures
8. Software and Data Integrity Failures
9. Logging and Monitoring Failures
10. Server-Side Request Forgery (SSRF)

## Security Testing Expectations

When implementing a feature Claude must generate:

- Unit tests for validation logic
- Integration tests for API and service communication
- Security tests for malicious inputs
- Authentication and authorization tests
- Edge-case and failure scenario tests

## Threat Modeling

For new features Claude should evaluate:

- potential attack surfaces
- privilege escalation risks
- data exposure risks
- abuse scenarios

## Secure Coding Practices

Claude must prefer:

- parameterized queries
- strict input validation
- least privilege access
- strong encryption libraries
- environment variables for secrets
- dependency vulnerability checks

## Security First Principle

If a feature introduces security risk, Claude must:

- flag the risk
- propose a safer implementation
- document the mitigation

------------------------------------------------------------------------

# Git Workflow — Trunk-Based Development

`main` is the trunk. Every push auto-deploys via Render. CI must pass.

References:

- https://www.atlassian.com/continuous-delivery/continuous-integration/trunk-based-development
- https://trunkbaseddevelopment.com/

## Rules

- **MANDATORY**: CI pipeline (GitHub Actions) must pass before merging. Never bypass.
- **MANDATORY**: Always ask for explicit user confirmation before running `git push`. Never push automatically.
- Small changes (< 3 files, config, docs): commit directly to `main`
- Non-trivial changes: short-lived feature branch (max 2 days)
- Merge to `main` with `--no-ff` when CI passes
- For incomplete features touching shared code: use feature flags
- Pre-commit hooks (Husky + lint-staged) run lint + format on staged files

## Branch Naming

    feature/ck-web/translation-layer-editor
    fix/ck-web/guest-session-timeout
    hotfix/ck-web/stripe-webhook-failure

## CI Pipeline (GitHub Actions)

Every push and PR to `main` runs:

    1. pnpm install --frozen-lockfile
    2. Lint (eslint)
    3. TypeScript check (tsc --noEmit for shared, server, client)
    4. Unit tests (vitest)
    5. Build (pnpm build)

All steps must pass. No exceptions.

## Merge Flow

    git checkout -b feature/my-feature
    # ... work and commit (keep branch < 2 days) ...
    # Push branch, CI runs automatically
    git checkout main
    git merge feature/my-feature --no-ff
    # Confirm with user before pushing
    git push origin main
    git branch -d feature/my-feature

## Commit Message Format

    <verb> <area>: <detail>

    Examples:
    Add content parsing endpoint
    Fix streaming burst mode: selfHandleResponse in Vite proxy
    Update usage middleware: replace console.log with pino logger

## Never

- Push to any remote without explicit user confirmation
- Push broken code to `main`
- Commit `.env` files or secrets
- Skip pre-commit hooks (--no-verify)
- Let a feature branch live longer than 2 days

# Local Development Ports

This project runs on non-default ports to avoid conflicts with other local projects.

- Frontend (Vite): 5179
- Backend (Express): 3009

Never change these ports without explicit confirmation. Do not default to 3000, 5173