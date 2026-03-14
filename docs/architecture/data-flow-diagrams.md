# CulinAIre Kitchen — Data Flow Diagrams

## 1. System Architecture

```
                              External Services
                         ┌──────────────────────────┐
                         │  Anthropic / OpenAI (AI)  │
                         │  Stripe (Payments)        │
                         │  Resend (Email)           │
                         │  Google / Microsoft (OAuth)│
                         └────────────┬─────────────┘
                                      │
  ┌──────────────┐    HTTP/WS    ┌────┴─────────────┐    SQL    ┌──────────────┐
  │              │  (Vite Proxy) │                   │          │              │
  │   Browser    ├──────────────►│   Express API     ├─────────►│  PostgreSQL  │
  │   (React)    │◄──────────────┤   Server          │◄─────────┤  Database    │
  │              │   JSON/SSE    │                   │          │              │
  └──────────────┘               │   ┌─────────────┐│          └──────────────┘
                                 │   │ Knowledge   ││
                                 │   │ Base (files) ││
                                 │   └─────────────┘│
                                 └──────────────────┘

  Port 5173                      Port 3001                      Railway PG
  (dev only)
```

---

## 2. Server Startup Sequence

```
  Server starts (node dist/index.js)
  │
  ├─ 1. Load .env ──────────────────────────────── dotenv.config()
  │
  ├─ 2. Configure Express ──────────────────────── helmet, CORS, JSON, cookies
  │
  ├─ 3. Mount routes ──────────────────────────── /api/auth, /api/chat, etc.
  │
  ├─ 4. Mount error handler ───────────────────── must be after routes
  │
  ├─ 5. Ensure encryption key ─────────────────── ensureEncryptionKey()
  │     │
  │     ├─ Key in process.env? ──── Yes ──► done
  │     ├─ Key in .env file? ────── Yes ──► load into process.env
  │     └─ Neither? ────────────── Generate ──► append to .env + set process.env
  │
  ├─ 6. Hydrate credentials ──────────────────── hydrateEnvFromCredentials()
  │     │
  │     ├─ Query credential table
  │     ├─ Decrypt each row (AES-256-GCM)
  │     └─ Set process.env[key] = decryptedValue
  │
  ├─ 7. Build knowledge index ────────────────── buildIndex()
  │     │
  │     ├─ Scan knowledge-base/ recursively
  │     ├─ Parse YAML frontmatter (gray-matter)
  │     └─ Store in-memory array of { title, category, tags, content, path }
  │
  └─ 8. Listen on port ──────────────────────── app.listen(3001)
```

---

## 3. Authentication Sequence

### 3a. Registration + Email Verification

```
  User                    Browser                   Server                    Database
   │                        │                         │                         │
   │  Fill form + submit    │                         │                         │
   │───────────────────────►│                         │                         │
   │                        │  POST /api/auth/register│                         │
   │                        │────────────────────────►│                         │
   │                        │                         │  Validate (Zod)         │
   │                        │                         │  Hash password (bcrypt) │
   │                        │                         │  INSERT user ──────────►│
   │                        │                         │  INSERT userRole ──────►│
   │                        │                         │  INSERT emailVerification►│
   │                        │                         │  Send email (Resend) ───►  Email
   │                        │  201 { message }        │                         │
   │                        │◄────────────────────────│                         │
   │  "Check your email"    │                         │                         │
   │◄───────────────────────│                         │                         │
   │                        │                         │                         │
   │  Click email link      │                         │                         │
   │───────────────────────►│                         │                         │
   │                        │  GET /verify-email?token│                         │
   │                        │────────────────────────►│                         │
   │                        │                         │  Lookup token ─────────►│
   │                        │                         │  UPDATE user verified ─►│
   │                        │  Redirect to /login     │                         │
   │                        │◄────────────────────────│                         │
```

### 3b. Login + Token Refresh

```
  User                    Browser                   Server                    Database
   │                        │                         │                         │
   │  Enter credentials     │                         │                         │
   │───────────────────────►│                         │                         │
   │                        │  POST /api/auth/login   │                         │
   │                        │────────────────────────►│                         │
   │                        │                         │  Find user by email ───►│
   │                        │                         │  bcrypt.compare         │
   │                        │                         │  Check verified + status│
   │                        │                         │  Generate tokens        │
   │                        │                         │  INSERT refreshToken ──►│
   │                        │  Set-Cookie (httpOnly)  │                         │
   │                        │  { user: AuthUser }     │                         │
   │                        │◄────────────────────────│                         │
   │  Navigate to /chat     │                         │                         │
   │◄───────────────────────│                         │                         │
   │                        │                         │                         │
   │         ... 14 minutes later ...                 │                         │
   │                        │                         │                         │
   │                        │  POST /api/auth/refresh │                         │
   │                        │  (cookie sent auto)     │                         │
   │                        │────────────────────────►│                         │
   │                        │                         │  Verify refresh token ─►│
   │                        │                         │  Generate new access    │
   │                        │  Set-Cookie (new access)│                         │
   │                        │◄────────────────────────│                         │
```

---

## 4. AI Chat Message Flow

```
  User                    Browser                   Server                      AI Provider
   │                        │                         │                            │
   │  Type message + send   │                         │                            │
   │───────────────────────►│                         │                            │
   │                        │  POST /api/chat         │                            │
   │                        │  { messages: [...] }    │                            │
   │                        │────────────────────────►│                            │
   │                        │                         │  authenticate (JWT)        │
   │                        │                         │  checkUsageLimit           │
   │                        │                         │  Load system prompt        │
   │                        │                         │  Select model (provider)   │
   │                        │                         │                            │
   │                        │                         │  streamText() ────────────►│
   │                        │                         │    system: prompt          │
   │                        │                         │    messages: [...]         │
   │                        │                         │    tools: search, read     │
   │                        │                         │                            │
   │                        │                         │         ┌─ Tool call? ─────┤
   │                        │                         │         │                  │
   │                        │                         │  searchKnowledge(query)    │
   │                        │                         │    → search in-memory index│
   │                        │                         │    → return top 5 results  │
   │                        │                         │         │                  │
   │                        │                         │  readKnowledgeDocument()   │
   │                        │                         │    → read markdown file    │
   │                        │                         │    → return content        │
   │                        │                         │         │                  │
   │                        │                         │         └─ Continue ───────►│
   │                        │                         │                            │
   │                        │  SSE stream (chunks)    │  ◄── Stream tokens ────────│
   │  See answer appear     │◄────────────────────────│                            │
   │  word by word          │                         │                            │
   │◄───────────────────────│                         │                            │
   │                        │                         │                            │
   │                        │  Stream complete        │                            │
   │                        │                         │                            │
   │                        │  POST /conversations    │                            │
   │                        │  (create if new)        │     Database               │
   │                        │────────────────────────►│────────►│                  │
   │                        │                         │         │                  │
   │                        │  POST /conversations/   │         │                  │
   │                        │    :id/messages          │         │                  │
   │                        │────────────────────────►│────────►│                  │
   │                        │                         │         │                  │
```

**Key detail**: Messages are streamed to the user immediately but only persisted to the database after the stream completes. This means the AI response appears instantly while persistence happens in the background.

---

## 5. Credential Encryption Flow

### 5a. Saving a Credential (Admin UI)

```
  Admin                   Browser                   Server                    Database
   │                        │                         │                         │
   │  Enter API key value   │                         │                         │
   │───────────────────────►│                         │                         │
   │                        │  PUT /api/credentials/  │                         │
   │                        │    ANTHROPIC_API_KEY     │                         │
   │                        │  { value: "sk-ant-..." }│                         │
   │                        │────────────────────────►│                         │
   │                        │                         │  encrypt(value)          │
   │                        │                         │    ├─ Generate random IV │
   │                        │                         │    ├─ AES-256-GCM encrypt│
   │                        │                         │    └─ Return { ciphertext,│
   │                        │                         │         iv, authTag }    │
   │                        │                         │                         │
   │                        │                         │  UPSERT credential ────►│
   │                        │                         │    (ciphertext, iv, tag) │
   │                        │                         │                         │
   │                        │                         │  process.env[key] = value│
   │                        │                         │  Invalidate cache       │
   │                        │  200 { success }        │                         │
   │                        │◄────────────────────────│                         │
```

### 5b. Startup Hydration

```
  Server starts
   │
   ├─ ensureEncryptionKey()
   │   └─ CREDENTIALS_ENCRYPTION_KEY available in process.env
   │
   └─ hydrateEnvFromCredentials()
       │
       ├─ SELECT * FROM credential
       │   └─ Returns: [{ key, ciphertext, iv, authTag }, ...]
       │
       ├─ For each row:
       │   ├─ decrypt(ciphertext, iv, authTag)
       │   │   ├─ Read encryption key from process.env
       │   │   ├─ AES-256-GCM decrypt
       │   │   └─ Return plaintext
       │   │
       │   └─ process.env[key] = plaintext
       │
       └─ All credentials now in process.env
           (ANTHROPIC_API_KEY, STRIPE_SECRET_KEY, etc.)
```

---

## 6. Subscription & Usage Flow

```
  Free User                Browser                   Server                    Stripe
   │                        │                         │                         │
   │  Chat (session 5/5)    │                         │                         │
   │───────────────────────►│  POST /api/chat         │                         │
   │                        │────────────────────────►│                         │
   │                        │                         │  checkUsageLimit()       │
   │                        │                         │  freeSessions = 0       │
   │                        │  403 { upgradeRequired } │                         │
   │                        │◄────────────────────────│                         │
   │  "Upgrade" prompt      │                         │                         │
   │◄───────────────────────│                         │                         │
   │                        │                         │                         │
   │  Click "Upgrade"       │                         │                         │
   │───────────────────────►│  POST /api/stripe/      │                         │
   │                        │    checkout              │                         │
   │                        │────────────────────────►│                         │
   │                        │                         │  Create session ───────►│
   │                        │  { url }                │                         │
   │                        │◄────────────────────────│                         │
   │                        │  Redirect to Stripe     │                         │
   │                        │─────────────────────────────────────────────────►│
   │  Complete payment      │                         │                         │
   │───────────────────────►│                         │                         │
   │                        │                         │  Webhook ◄──────────────│
   │                        │                         │  checkout.session       │
   │                        │                         │    .completed           │
   │                        │                         │                         │
   │                        │                         │  UPDATE user            │
   │                        │                         │    subscriptionStatus   │
   │                        │                         │    = "active"           │
   │                        │                         │                         │
   │  Redirect back         │                         │                         │
   │◄─────────────────────────────────────────────────────────────────────────│
   │                        │                         │                         │
   │  Chat (unlimited)      │  POST /api/chat         │                         │
   │───────────────────────►│────────────────────────►│                         │
   │                        │                         │  checkUsageLimit()       │
   │                        │                         │  subscriptionStatus     │
   │                        │                         │    = "active" ✓         │
   │                        │  Stream response        │                         │
   │                        │◄────────────────────────│                         │
```

---

## 7. Request Processing Pipeline

```
  Incoming Request
   │
   ├─ helmet()              Security headers
   ├─ cors()                Origin validation
   ├─ express.json()        Parse JSON body
   ├─ cookieParser()        Parse cookies
   ├─ rateLimit()           60 req/min per IP
   │
   ├─ Route matched?
   │   │
   │   ├─ No  ──► 404
   │   │
   │   └─ Yes ──► Route middleware chain
   │              │
   │              ├─ authenticate?     Verify JWT from cookie
   │              ├─ requireRole?      Check user roles
   │              ├─ requirePermission? Check user permissions
   │              ├─ checkUsageLimit?  Verify subscription/quota
   │              │
   │              └─ Controller
   │                  ├─ Validate input (Zod)
   │                  ├─ Call service(s)
   │                  └─ Return response
   │
   └─ Error? ──► errorHandler middleware
                  ├─ ZodError → 400 { error, details }
                  ├─ AI key error → 502 { error }
                  └─ Other → 500 { error: "Internal server error" }
```
