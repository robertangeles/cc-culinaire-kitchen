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

## 5. Demand Elegance (Balanced)

-   For non-trivial changes ask: "Is there a more elegant solution?"
-   If a fix feels hacky, refactor before presenting
-   Avoid over-engineering simple problems

## 6. Autonomous Bug Fixing

-   When given a bug report: investigate logs and errors and resolve it
-   Do not require the user to guide debugging steps
-   Fix failing tests and CI issues independently when possible

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

    culinaire-kitchen/

    client/
      components/
      pages/
      styles/
      hooks/

    server/
      routes/
      controllers/
      services/
      models/
      middleware/

    shared/
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

Claude must follow this structure when generating code.

------------------------------------------------------------------------

# Separation of Concerns

## Frontend

Location:

    client/

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

    server/

Responsibilities:

-   API endpoints
-   request validation
-   authentication
-   orchestration of services

Backend must never contain frontend UI logic.

------------------------------------------------------------------------

## Services Layer

Location:

    server/services/

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

    server/routes/

Routes must remain thin.

They should:

-   receive requests
-   call controllers
-   return responses

------------------------------------------------------------------------

## Controllers

Location:

    server/controllers/

Responsibilities:

-   validate input
-   call services
-   format responses

Controllers must not contain heavy business logic.

------------------------------------------------------------------------

## Models

Location:

    server/models/

Models represent database entities such as:

-   User
-   Conversation
-   Message

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
    ``>

    Prompts must never be hardcoded inside application logic.

    ---

    # API Design

    Example endpoint:

    POST /api/chat

    Request:

{ "message": "How do I sear scallops?" }


    Response:

{ "response": "...", "sources": \[\] }


    ---

    # Conversation Handling

    Conversation schema example:

conversation id user_id created_at

message id conversation_id role content timestamp


    Roles:

    - user
    - assistant

    ---

    # AI Integration

    AI service location:

server/services/aiService


    Responsibilities:

    - construct prompts
    - call LLM APIs
    - return responses

    Routes must never call LLM APIs directly.

    ---

    # Security Guidelines

    - Store API keys in environment variables
    - Never commit secrets
    - Validate all request inputs
    - Sanitize user data
    - Implement rate limiting

    ---

    # Documentation

    Documentation location:

docs/


    Structure:

docs/ architecture/ specs/ \`\`\`

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
