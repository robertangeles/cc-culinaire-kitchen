# CulinAIre Kitchen — Technical Architecture Guide

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Monorepo | pnpm workspaces + Turborepo | pnpm 10, turbo 2 |
| Language | TypeScript (strict mode) | 5.7+ |
| Frontend | React + Vite + Tailwind CSS 4 | React 19, Vite 6 |
| AI (client) | @ai-sdk/react (useChat hook) | v4 |
| AI (server) | Vercel AI SDK (@ai-sdk/anthropic, @ai-sdk/openai) | v4 |
| Backend | Express | 5.x (ESM) |
| Database | PostgreSQL + Drizzle ORM | Drizzle 0.38 |
| Auth | jsonwebtoken + bcrypt + otplib | JWT-based |
| Email | Resend SDK | — |
| Payments | Stripe SDK | — |
| Logging | Pino + pino-pretty | — |
| Testing | Vitest | 3.x |
| Validation | Zod | — |

## Monorepo Structure

```
culinaire-kitchen/
├── packages/
│   ├── client/          React SPA (@culinaire/client)
│   ├── server/          Express API (@culinaire/server)
│   └── shared/          Zod schemas & types (@culinaire/shared)
├── knowledge-base/      Curated markdown documents
├── prompts/chatbot/     System prompt templates
├── docs/architecture/   This documentation
├── tasks/               todo.md, lessons.md
├── uploads/             Static files (logos, favicons)
├── turbo.json           Task orchestration
├── pnpm-workspace.yaml  Workspace definition
└── .env                 Environment configuration
```

**Dependency graph**: Both `client` and `server` depend on `shared` (workspace:*).

**Turborepo tasks**: `build` respects `^build` dependency order. `dev` runs all packages in parallel with persistent mode.

---

## Server Startup Sequence

`packages/server/src/index.ts` executes in this order:

```
1. dotenv.config({ path: "../../.env" })     Load environment variables
2. Mount Stripe webhook (raw body)           Before express.json()
3. Apply middleware                          helmet, CORS, JSON, cookies, rate limit
4. Mount all route handlers                  /api/auth, /api/chat, etc.
5. Mount error handler                       Must be after routes
6. ensureEncryptionKey()                     Generate or load AES key
7. hydrateEnvFromCredentials()               Decrypt DB credentials → process.env
8. buildIndex()                              Scan knowledge-base/, build search index
9. app.listen(port)                          Start accepting requests
```

Steps 6–8 ensure that by the time the server accepts requests, all credentials are available in `process.env` and the knowledge base is searchable.

---

## Request Lifecycle

```
Browser
  → Vite dev proxy (/api/* → localhost:3001)
    → Express middleware (helmet, CORS, JSON parser, rate limiter)
      → Route matcher (e.g., /api/chat → chatRouter)
        → Middleware chain (authenticate, checkUsageLimit)
          → Controller (validate input, call service)
            → Service (business logic, DB queries, AI calls)
              → Response (JSON or stream)
```

**Convention**: Routes are thin (just wire middleware + controller). Controllers validate and delegate. Services contain all business logic.

---

## Authentication

### Token Strategy

- **Access token**: JWT, 15-minute expiry, stored in `access_token` httpOnly cookie
- **Refresh token**: Random 64-byte hex, 7-day expiry, stored in `refresh_token` httpOnly cookie
- **Token payload**: `{ sub: userId, roles: string[], permissions: string[] }`
- **Cookie settings**: httpOnly, secure (production), sameSite=strict

### Registration Flow

```
POST /api/auth/register { name, email, password }
  → Zod validation (8+ chars, 1 uppercase, 1 number)
  → Check email uniqueness (case-insensitive)
  → bcrypt hash (12 rounds)
  → INSERT user
  → Assign "Subscriber" role (userRole join)
  → Generate verification token → INSERT emailVerification (24h expiry)
  → Send email via Resend
  → Return 201 { message, userId }
```

### Login Flow

```
POST /api/auth/login { email, password }
  → Find user by email
  → bcrypt.compare password
  → Check emailVerifiedInd = true
  → Check userStatus (not suspended/cancelled)
  → If MFA enabled:
      → Return { requiresMfa: true, mfaSessionToken } (5-min JWT)
  → Else:
      → Generate access + refresh tokens
      → Set httpOnly cookies
      → Return { user: AuthUser }
```

### Token Refresh

The client auto-refreshes every 14 minutes via `AuthContext`:

```
POST /api/auth/refresh (refresh_token cookie sent automatically)
  → Hash token → look up in refreshToken table
  → Verify not expired
  → Generate new access token → set cookie
  → Return { user: AuthUser }
```

### OAuth (Google / Microsoft)

```
GET /api/auth/google → redirect to Google consent screen
GET /api/auth/google/callback?code=... → exchange code for tokens
  → Fetch user profile from Google
  → Find or create user + link oauthAccount
  → Generate tokens, set cookies
  → Redirect to CLIENT_URL
```

### Middleware

- `authenticate(req, res, next)` — Verify access_token cookie, attach `req.user`
- `requireRole(...roles)` — Check `req.user.roles` includes at least one
- `requirePermission(...perms)` — Check `req.user.permissions` includes at least one

---

## AI Chat Flow

### Client Side

```typescript
// ChatContainer.tsx
const { messages, handleSubmit } = useChat({
  api: "/api/chat",
  onFinish: (msg) => persistMessages(...)
});
```

`useChat()` from `@ai-sdk/react` handles streaming, message state, and SSE parsing.

### Server Side

```typescript
// chatController.ts → aiService.ts
async function streamChat(messages, res) {
  const systemPrompt = await getSystemPrompt();
  const model = getModel();  // anthropic or openai based on AI_PROVIDER

  const result = streamText({
    model,
    system: systemPrompt,
    messages,
    tools: {
      searchKnowledge,        // search indexed knowledge-base
      readKnowledgeDocument   // fetch full document content
    },
    maxSteps: 3               // max tool call iterations
  });

  result.pipeDataStreamToResponse(res);
}
```

### AI Tools

The AI has two tools available:

1. **searchKnowledge(query, category?)** — Searches the in-memory index. Scores documents by term matches in title (+10), tags (+8), and content (+3). Returns top 5 results with snippets.

2. **readKnowledgeDocument(filePath)** — Reads a full markdown document. Includes path traversal protection.

### Message Persistence

Messages are persisted lazily by the client after the stream completes:

```
1. First message → POST /api/conversations { id: UUID, title }
2. After stream → POST /api/conversations/:id/messages { messages[] }
3. Navigate to /chat/:id
```

---

## Database Schema

### Naming Conventions

- Table names: **singular** (user, not users)
- Boolean columns: **_ind** suffix (emailVerifiedInd, mfaEnabledInd)
- Timestamp columns: **_dttm** suffix (createdDttm, updatedDttm)
- Primary keys: **tableName + Id** (userId, roleId)

### Tables

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| **user** | userId (serial PK), userEmail, userPasswordHash, freeSessions, subscriptionStatus, subscriptionTier, stripeCustomerId | User accounts |
| **role** | roleId (serial PK), roleName | Role definitions (Administrator, Subscriber, Paid Subscriber) |
| **permission** | permissionId (serial PK), permissionKey, permissionDescription | Fine-grained permissions (admin:manage-users, chat:access, etc.) |
| **userRole** | userId, roleId | Many-to-many join |
| **rolePermission** | roleId, permissionId | Many-to-many join |
| **refreshToken** | refreshTokenId, userId, tokenHash, expiresAtDttm | Token revocation tracking |
| **emailVerification** | emailVerificationId, userId, verificationToken, expiresAtDttm, usedInd | Email verification tokens |
| **oauthAccount** | oauthAccountId, userId, oauthProvider, oauthProviderId | OAuth provider linking |
| **conversation** | conversationId (UUID PK), conversationTitle, userId | Chat conversations |
| **message** | messageId (UUID PK), conversationId, messageRole, messageBody, messageSequence | Chat messages |
| **prompt** | promptId, promptName, promptBody, defaultInd | System prompts (default vs. custom) |
| **promptVersion** | promptVersionId, promptId, promptBody, versionNumber | Prompt history (max 7 per prompt) |
| **siteSetting** | siteSettingId, settingKey, settingValue | KV configuration store |
| **credential** | credentialId, credentialKey, credentialValue (encrypted), credentialIv, credentialTag, credentialCategory | Encrypted API keys and secrets |

### Seed Data

Run `pnpm --filter @culinaire/server db:seed` to insert:
- Roles: Administrator, Subscriber, Paid Subscriber
- Permissions: admin:dashboard, admin:manage-users, admin:manage-roles, admin:manage-settings, chat:access, chat:unlimited, org:create-organisation, org:manage-organisation
- Role-permission assignments
- Default system prompt

---

## Knowledge Base

### File Format

Each document uses YAML frontmatter parsed by `gray-matter`:

```markdown
---
title: "Searing Technique"
category: "techniques"
tags: ["maillard", "high-heat", "proteins"]
---

# Content here...
```

### Directory Structure

```
knowledge-base/
├── techniques/    searing, braising, emulsions, knife-skills
├── pastry/        chocolate, custards, doughs
├── spirits/       cocktail-structures
└── ingredients/   fats, herbs
```

### Indexing

At startup, `knowledgeService.buildIndex()` recursively scans all `.md` files, parses frontmatter, and builds an in-memory array. No vector database — search uses weighted term matching.

---

## Credential Encryption

### Encryption Method

AES-256-GCM via Node.js `crypto` module. Each credential is stored as three values: ciphertext, IV (initialization vector), and auth tag — all hex-encoded.

### Key Management

`ensureEncryptionKey()` runs at server startup:
1. Check `process.env.CREDENTIALS_ENCRYPTION_KEY`
2. If missing, check `.env` file contents
3. If still missing, generate a random 32-byte key, append to `.env`, set in process.env

### Startup Hydration

`hydrateEnvFromCredentials()` runs after encryption key is available:
1. Query all rows from `credential` table
2. Decrypt each value using the encryption key
3. Set each as `process.env[key]`
4. All services read from `process.env` — no distinction between .env and DB-stored credentials

### Credential Registry

`credentialService.ts` defines `CREDENTIAL_REGISTRY` — a list of all recognized credential keys organized by category: OAuth (Google, Microsoft), AI (Anthropic, OpenAI), Email (Resend), Payments (Stripe), Security (reCAPTCHA).

---

## Settings & Admin

### Site Settings

Key-value store in `siteSetting` table. Cached in memory (Map). Used for page title, description, favicon path, etc.

### System Prompts

- Default prompt loaded from `prompts/chatbot/systemPrompt.md`
- Admin can edit via UI → stored in `prompt` table (custom, defaultInd=false)
- Each save creates a version record (max 7 kept, older pruned)
- Rollback to any previous version
- **Fallback chain**: in-memory cache → DB custom row → file on disk

### Role-Based Access Control

```
User → userRole → Role → rolePermission → Permission
```

Middleware functions `requireRole()` and `requirePermission()` gate access at the route level.

---

## Stripe Billing

### Free Tier

Every new user gets `freeSessions = 5`. The `checkUsageLimit()` middleware blocks chat requests when free sessions are exhausted, returning `{ upgradeRequired: true }`.

### Paid Subscriptions

```
POST /api/stripe/checkout { tier: "monthly" | "yearly" }
  → Create Stripe Checkout Session
  → Return { url } for redirect

POST /api/stripe/webhook (Stripe signature verified)
  → checkout.session.completed: activate subscription
  → customer.subscription.deleted: downgrade to free
```

---

## API Reference

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | /api/auth/register | No | Register new user |
| POST | /api/auth/login | No | Login (returns JWT or MFA challenge) |
| POST | /api/auth/logout | Yes | Logout, revoke tokens |
| POST | /api/auth/refresh | No | Refresh access token |
| GET | /api/auth/me | Yes | Get current authenticated user |
| GET | /api/auth/verify-email | No | Verify email via token |
| POST | /api/auth/resend-verification | No | Resend verification email |
| GET | /api/auth/google | No | Start Google OAuth |
| GET | /api/auth/google/callback | No | Google OAuth callback |
| GET | /api/auth/microsoft | No | Start Microsoft OAuth |
| GET | /api/auth/microsoft/callback | No | Microsoft OAuth callback |
| POST | /api/auth/mfa/setup | Yes | Generate MFA secret + QR |
| POST | /api/auth/mfa/enable | Yes | Enable MFA with TOTP code |
| POST | /api/auth/mfa/disable | Yes | Disable MFA |
| POST | /api/auth/mfa/verify | No | Verify TOTP during login |
| POST | /api/chat | Yes | Stream AI chat response |
| POST | /api/conversations | Yes | Create conversation |
| GET | /api/conversations | Yes | List user's conversations |
| GET | /api/conversations/:id | Yes | Get conversation with messages |
| PATCH | /api/conversations/:id | Yes | Update conversation title |
| POST | /api/conversations/:id/messages | Yes | Save messages |
| DELETE | /api/conversations/:id | Yes | Delete conversation |
| GET | /api/prompts | Admin | List all prompts (metadata) |
| POST | /api/prompts | Admin | Create new prompt |
| GET | /api/prompts/:name | Admin | Get prompt content by name |
| PUT | /api/prompts/:name | Admin | Update prompt content |
| POST | /api/prompts/:name/reset | Admin | Reset prompt to default |
| GET | /api/prompts/:name/versions | Admin | Get version history |
| POST | /api/prompts/:name/versions/:id/rollback | Admin | Rollback to version |
| GET | /api/settings | No | Get site settings |
| PATCH | /api/settings | Admin | Update site settings |
| GET | /api/credentials | Admin | List all credentials (masked) |
| PUT | /api/credentials/:key | Admin | Save/update credential |
| DELETE | /api/credentials/:key | Admin | Delete credential |
| GET | /api/users | Admin | List users (paginated, searchable) |
| DELETE | /api/users/:id | Admin | Delete user (cascade) |
| PATCH | /api/users/:id/suspend | Admin | Suspend user |
| PATCH | /api/users/:id/reactivate | Admin | Reactivate user |
| PATCH | /api/users/:id/cancel | Admin | Cancel user |
| PATCH | /api/users/:id/free-sessions | Admin | Update free sessions |
| POST | /api/users/:id/roles | Admin | Assign role to user |
| DELETE | /api/users/:id/roles/:roleId | Admin | Remove role from user |
| POST | /api/users/:id/email | Admin | Send direct email to user |
| POST | /api/stripe/checkout | Yes | Create checkout session |
| POST | /api/stripe/webhook | No | Stripe webhook (signature verified) |
| GET | /api/health | No | Health check |

---

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| DATABASE_URL | PostgreSQL connection string |
| AI_PROVIDER | `anthropic` or `openai` |
| AI_MODEL | Model name (e.g., `claude-sonnet-4-20250514`) |
| ANTHROPIC_API_KEY | Anthropic API key (if AI_PROVIDER=anthropic) |
| JWT_ACCESS_SECRET | Secret for signing access tokens |
| JWT_REFRESH_SECRET | Secret for signing refresh tokens |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3001 | Server port |
| CLIENT_URL | http://localhost:5173 | Frontend URL (for CORS) |
| BCRYPT_ROUNDS | 12 | Password hashing rounds |
| OPENAI_API_KEY | — | OpenAI API key (if AI_PROVIDER=openai) |
| RESEND_API_KEY | — | Resend email API key |
| RESEND_FROM_EMAIL | noreply@culinaire.kitchen | Sender email |
| GOOGLE_CLIENT_ID | — | Google OAuth client ID |
| GOOGLE_CLIENT_SECRET | — | Google OAuth client secret |
| GOOGLE_CALLBACK_URL | http://localhost:3001/api/auth/google/callback | Google OAuth redirect |
| MICROSOFT_CLIENT_ID | — | Microsoft OAuth client ID |
| MICROSOFT_CLIENT_SECRET | — | Microsoft OAuth client secret |
| MICROSOFT_CALLBACK_URL | http://localhost:3001/api/auth/microsoft/callback | Microsoft OAuth redirect |
| STRIPE_SECRET_KEY | — | Stripe secret key |
| STRIPE_PUBLISHABLE_KEY | — | Stripe publishable key |
| STRIPE_WEBHOOK_SECRET | — | Stripe webhook signing secret |
| STRIPE_PRICE_MONTHLY | — | Stripe monthly price ID |
| STRIPE_PRICE_YEARLY | — | Stripe yearly price ID |
| RECAPTCHA_SITE_KEY | — | reCAPTCHA v3 site key |
| RECAPTCHA_SECRET_KEY | — | reCAPTCHA v3 secret key |

### Auto-Generated

| Variable | Description |
|----------|-------------|
| CREDENTIALS_ENCRYPTION_KEY | 64-char hex (32 bytes). Generated on first startup if missing. |

---

## Key Architectural Patterns

### Lazy Initialization

- **Database**: `db/index.ts` uses a Proxy that defers the actual PostgreSQL connection until the first query. This allows dotenv to load `DATABASE_URL` before any import triggers a connection.
- **Stripe**: `stripeService.ts` initializes the Stripe SDK on first use, after credential hydration has set `STRIPE_SECRET_KEY` in process.env.
- **OAuth env vars**: `authService.ts` uses getter functions (`getGoogleClientId()`) instead of module-level constants, so DB-hydrated values are picked up at call time.

### In-Memory Caching

- **System prompts**: `promptService.ts` caches in a Map, invalidated on edit
- **Site settings**: `settingsService.ts` caches in a Map, invalidated on update
- **Credentials**: `credentialService.ts` caches decrypted values in a Map
- **Knowledge index**: `knowledgeService.ts` holds the full index in memory

### Error Handling

- Controllers use try/catch and return specific error messages with appropriate HTTP status codes
- Unknown errors fall through to the global `errorHandler` middleware
- The error handler detects AI provider errors (API key issues) and returns 502
- `res.headersSent` guard prevents double-response crashes

---

## Testing

### Setup

- **Server**: Vitest with `node` environment (`packages/server/vitest.config.ts`)
- **Client**: Vitest with `jsdom` environment + `@testing-library/react` (`packages/client/vitest.config.ts`)
- **Shared**: Vitest with `node` environment

### Running Tests

```bash
pnpm test                              # All packages
pnpm --filter @culinaire/server test   # Server only
pnpm --filter @culinaire/client test   # Client only
pnpm --filter @culinaire/shared test   # Shared only
```

### Test File Convention

Test files are co-located with source files: `foo.ts` → `foo.test.ts`.

### Current Coverage

- Server: crypto, credentialService, authController, errorHandler, usage middleware, settingsService
- Client: AuthContext, PasswordRequirements
- Shared: types and utils

---

## Development Commands

```bash
pnpm dev                    # Start all packages in dev mode
pnpm build                  # Build all packages
pnpm test                   # Run all tests
pnpm lint                   # Lint all packages

# Database
pnpm --filter @culinaire/server db:push    # Push schema to PostgreSQL
pnpm --filter @culinaire/server db:seed    # Seed initial data
pnpm --filter @culinaire/server db:studio  # Open Drizzle Studio (DB GUI)
```
