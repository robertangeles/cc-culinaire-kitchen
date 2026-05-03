# CulinAIre Kitchen — System Overview

## What Is CulinAIre Kitchen?

CulinAIre Kitchen is an AI-powered platform for chefs, restaurateurs, and culinary professionals. It provides a conversational assistant that draws on a curated knowledge base of cooking techniques, ingredients, pastry fundamentals, and spirits to deliver expert-level culinary guidance. Users chat with the AI, which can search and reference authoritative culinary documents to provide sourced, reliable answers.

## How It Works

1. **A user creates an account** and verifies their email address.
2. **They log in** and land on the chat interface.
3. **They ask a culinary question** (e.g., "How do I fix a broken emulsion?").
4. **The server sends the question to an AI model** (Anthropic Claude or OpenAI) along with a culinary-focused system prompt.
5. **The AI can search the knowledge base** — a library of curated markdown documents covering techniques, pastry, spirits, and ingredients — to find relevant information.
6. **The AI streams its answer back** in real time, displayed as it arrives.
7. **The conversation is saved** so the user can return to it later.

```
User (Browser)
    |
    |  asks a question
    v
React App  ──────>  Express API Server  ──────>  AI Provider
                        |         |                (Claude / GPT)
                        |         |
                        v         v
                   PostgreSQL   Knowledge Base
                   (users,      (markdown files:
                    chats,       techniques,
                    settings)    ingredients, etc.)
```

## Key Features

- **AI Chat** — Real-time streaming conversation with a culinary AI assistant
- **Knowledge Base** — Curated, authoritative culinary documents the AI can search and reference
- **Conversation History** — All chats are saved and organized in a sidebar
- **Admin Settings** — Site configuration, system prompt editing with version history
- **Integrations Management** — API keys and OAuth credentials stored encrypted in the database, manageable from the admin UI
- **Role-Based Access** — Admin, Subscriber, and Paid Subscriber roles with fine-grained permissions
- **Subscription Billing** — Free tier (5 sessions) with Stripe-powered paid upgrades
- **Authentication** — Email/password, Google OAuth, Microsoft OAuth, multi-factor authentication (TOTP)
- **Email Verification** — Users must verify their email before logging in
- **Store Locations** — Multi-location support for restaurant groups. Organisations hold multiple store locations (HQ, Branch, Commissary, Satellite). Staff are assigned to locations, and all Kitchen Ops data is scoped by location. See [store-locations.md](store-locations.md) for full architecture.
- **Kitchen Operations** — Menu Intelligence, Kitchen Copilot, and Waste Intelligence modules, all location-aware

## System Components

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Frontend** | React 19, Vite, Tailwind CSS | User interface — chat, settings, auth pages |
| **Backend** | Express 5, TypeScript | API server — routes, business logic, AI integration |
| **Database** | PostgreSQL, Drizzle ORM | Stores users, conversations, messages, settings, credentials |
| **AI Provider** | Anthropic Claude or OpenAI | Generates chat responses |
| **Knowledge Base** | Markdown files with YAML metadata | Curated culinary reference documents |
| **Email** | Resend | Sends verification emails |
| **Payments** | Stripe | Subscription checkout and billing |
| **OAuth** | Google, Microsoft | Social login |

## User Roles

| Role | What They Can Do |
|------|-----------------|
| **Subscriber** (default) | Chat with the AI (5 free sessions), view conversation history |
| **Paid Subscriber** | Unlimited chat sessions |
| **Admin** | All of the above, plus: manage users, edit system prompts, configure site settings, manage integrations, assign roles |

## Security

- **Passwords** are hashed with bcrypt (12 rounds) — never stored in plain text
- **Authentication** uses secure, HTTP-only cookies with JWT tokens that auto-refresh
- **API keys and OAuth secrets** are encrypted with AES-256-GCM before storage in the database
- **Email verification** is required before a user can log in
- **Multi-factor authentication** (TOTP-based) is available for additional account security
- **Rate limiting** prevents abuse (60 requests per minute per IP)
- **Input validation** on every API endpoint using Zod schemas
- **CORS and Helmet** headers protect against common web attacks

## Project Structure (Simplified)

```
culinaire-kitchen/
  packages/
    client/        The web application users see (React)
    server/        The API server handling requests (Express)
    shared/        Code shared between client and server (types, validation)
  prompts/         AI system prompt templates
  docs/            Documentation (you are here)
  uploads/         Uploaded files (logos, favicons)
```
