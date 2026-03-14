# CLAUDE.md

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

------------------------------------------------------------------------

# Project Overview

CulinAIre Kitchen is an AI-powered platform for chefs, restaurateurs,
and culinary professionals.

The first module is the **Culinary Knowledge Chatbot**, which provides
conversational assistance for:

-   cooking techniques
-   culinary troubleshooting
-   ingredient knowledge
-   pastry and spirits fundamentals

Future modules may include:

-   Recipe Development Lab
-   Culinary Ratio Engine
-   Menu Intelligence
-   Kitchen Operations Copilot

The system must be modular and extensible.

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

------------------------------------------------------------------------

# Project Folder Structure

This is a **pnpm monorepo**. All application code lives under `packages/`.

    culinaire-kitchen/

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
