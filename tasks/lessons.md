# CulinAIre Kitchen — Lessons Learned

Format: Problem / Fix / Rule

---

## 1. Never use Google Drive for Node.js projects
- **Problem**: pnpm install failed repeatedly — Google Drive doesn't support symlinks, which pnpm (and npm workspaces) require for linking packages
- **Fix**: Moved project to local drive `D:\My AI Projects\cc-culinaire-kitchen\`. Install completed in 32s (vs hanging for 10+ minutes on Google Drive)
- **Rule**: Always use a local filesystem for Node.js projects. Use Git + GitHub for backup instead of cloud sync drives

---

## 2. Monorepo dotenv path requires explicit config
- **Problem**: `import "dotenv/config"` defaults to `process.cwd()`, which in a monorepo with turbo is the package directory (e.g., `packages/server`), not the root where `.env` lives
- **Fix**: Use `config({ path: "../../.env" })` from dotenv instead of `import "dotenv/config"`
- **Rule**: In monorepos, always use explicit dotenv path relative to the package

---

## 3. DB module must use lazy initialization in monorepos
- **Problem**: `db/index.ts` read `process.env.DATABASE_URL` at module load time, before dotenv had a chance to populate it (ESM import ordering)
- **Fix**: Used a Proxy to lazily initialize the DB connection on first access, so env vars are loaded by the time the DB is actually used
- **Rule**: Never read env vars at module top-level in shared modules; use lazy init or factory functions

---

## 4. Database naming conventions
- **Table names**: Always **singular** (e.g. `prompt`, not `prompts`)
- **Boolean columns**: Use `_ind` suffix (indicator) — e.g. `default_ind`
- **Timestamp columns**: Use `_dttm` suffix — e.g. `created_dttm`, `updated_dttm`
- **Foreign keys**: Always use integer FKs (e.g. `prompt_id`) instead of joining on strings — better performance and proper relational design
- **Column names**: Prefix with table name — e.g. `prompt_id`, `prompt_name`, `prompt_body`
- **Rule**: Apply these conventions to all new tables and when renaming existing columns

---

## 5. Services that depend on optional API keys must use lazy init
- **Problem**: `emailService.ts` called `new Resend(process.env.RESEND_API_KEY)` at module load time. When the env var was unset, Resend threw immediately and crashed the entire server on startup — preventing all routes (including auth) from working
- **Fix**: Lazy-initialize the Resend client inside a `getResend()` function; return `null` and skip email sending when the key isn't configured
- **Rule**: Never instantiate SDK clients at module top-level when the API key is optional. Use lazy init and degrade gracefully

---

## 6. Keep imports consistent across route files
- **Problem**: `credentials.ts` imported `requireRole` from a nonexistent `../middleware/rbac.js`, while every other route imported it from `../middleware/auth.js`. This caused `ERR_MODULE_NOT_FOUND` and crashed the server on startup
- **Fix**: Changed the import to `../middleware/auth.js` to match all other routes
- **Rule**: When adding new routes, copy import patterns from existing route files. If a module doesn't exist, check where other files import the same function from

---

## 7. otplib v4+ API migration
- **Problem**: Code used `import { authenticator } from "otplib"` which worked in otplib v12 (classic) but not in otplib v4+ (rewritten). The new version doesn't export `authenticator`
- **Fix**: Use the top-level function exports: `generateSecret`, `generateURI({ secret, issuer, label })`, and `verify({ token, secret })` (async, returns `{ valid, delta }`)
- **Rule**: When upgrading otplib, use the top-level named exports, not the class-based `authenticator` API

---

## 8. Role/permission renames require migration + seed + route updates
- **Problem**: Renaming "Admin" → "Administrator" and permission keys like "admin:users" → "admin:manage-users" touches many layers: DB data, seed script, route middleware, client-side role checks, and documentation
- **Fix**: Created a standalone migration script (`src/db/migrations/rename-permissions.ts`) for existing DBs, updated seed for fresh installs, grep'd for all `requireRole("Admin")` call sites, and updated the sidebar admin check
- **Rule**: When renaming roles or permissions, always: (1) write a migration script, (2) update seed.ts, (3) grep all `requireRole`/`requirePermission` references, (4) update client-side role checks, (5) update documentation

---

## 9. Migration scripts: dotenv path is relative to cwd, not file location
- **Problem**: Migration script at `src/db/migrations/add-prompt-key.ts` used `config({ path: "../../../.env" })` thinking it was relative to the file. It failed with "DATABASE_URL is not set"
- **Fix**: Use `config({ path: "../../.env" })` — dotenv resolves relative to `process.cwd()`, which is `packages/server` when run via `npx tsx`
- **Rule**: In migration scripts, dotenv path is always relative to cwd (packages/server), not to the file's directory. Match existing migration scripts' pattern

---

## 10. Lucide React icons don't accept HTML attributes like `title`
- **Problem**: `<CheckCircle2 title="Email verified" />` caused a TS error — Lucide icon components only accept `LucideProps`, not arbitrary HTML attributes
- **Fix**: Wrap the icon in a `<span title="...">` element instead
- **Rule**: Never pass `title`, `aria-label`, or other HTML attributes directly to Lucide icons. Wrap in a native element for accessibility attributes

---

## 11. Collection routes must precede parameterized routes
- **Problem**: Adding `GET /api/prompts` (list all) after `GET /api/prompts/:name` meant the collection route was never reached — Express matched "name" as the parameter
- **Fix**: Placed collection-level routes (`GET /`, `POST /`) before `/:name` routes in the router
- **Rule**: In Express routers, always define collection routes (GET /, POST /) before parameterized routes (/:id, /:name) to avoid parameter capture conflicts

---

## 12. Resend SDK returns { data, error } instead of throwing
- **Problem**: `sendDirectEmail` returned `true` even when Resend API returned an error — the Resend SDK doesn't throw on API errors, it returns `{ data, error }`
- **Fix**: Check the `error` field from `client.emails.send()` and propagate it in the response
- **Rule**: Always check both `data` and `error` from SDK responses that use Result pattern instead of exceptions

---

## 13. PII encryption: use separate keys from credential encryption
- **Problem**: Reusing `CREDENTIALS_ENCRYPTION_KEY` for PII would mean a single key compromise exposes both API secrets and customer data
- **Fix**: Added `PII_ENCRYPTION_KEY` and `PII_HMAC_KEY` as separate env vars, auto-generated at startup
- **Rule**: Use separate encryption keys for different data categories. HMAC blind indexes need their own key for searchable encrypted fields

---

## 14. Zero-downtime PII encryption migration
- **Problem**: Can't encrypt all PII at once without downtime — need both old and new code to work during transition
- **Fix**: Dual-write (encrypt + keep plaintext), dual-read (decrypt first, fall back to plaintext), combine address fields into single JSON blob to reduce encryption columns
- **Rule**: For encryption migrations: (1) add encrypted columns, (2) dual-write, (3) migrate existing data, (4) verify, (5) drop plaintext in separate deploy

---

## 15. Guest mode: use token column on conversation table, not negative IDs
- **Problem**: Needed to track which conversations belong to guest users without a userId
- **Fix**: Added `guest_session_token` column on conversation table (nullable). Guest conversations have `userId = null` and the token set. On registration, update userId and clear the token
- **Rule**: Use explicit foreign-key-like columns for ownership tracking, never encode ownership in negative IDs or other hacks

---

## 16. User deletion requires correct FK cascade order
- **Problem**: Deleting a user requires removing all related data first, but the order matters due to FK constraints (messages reference conversations, etc.)
- **Fix**: Delete in order: messages (via user's conversations) → conversations → user_role → user_organisation → refresh_token → email_verification → oauth_account → user
- **Rule**: When implementing cascade deletes, map the FK dependency graph and delete leaf tables first. Always wrap in a transaction

## 17. Guest anti-abuse: IP + cookie hybrid, server-generated tokens
- **Problem**: Client-generated guest tokens in localStorage are trivially bypassed (clear storage, incognito, different browser) to get unlimited free sessions
- **Fix**: (1) Move token generation to server side (`crypto.randomUUID()`), (2) store `ip_address` on guest_session table, (3) limit to 3 sessions per IP, (4) add `trust proxy` for correct IP behind reverse proxy
- **Rule**: Never let clients generate their own session identifiers. Always have a server-side anti-abuse check (IP, fingerprint, or both) alongside client-side tokens. Set `trust proxy` when deploying behind a reverse proxy

## 18. Single owner for async initialization to prevent race conditions
- **Problem**: Both `autoInitGuest` (AuthContext mount effect) and `initGuest` (ProtectedRoute useEffect) created guest sessions simultaneously, doubling session count and hitting IP limits instantly
- **Fix**: Removed `autoInitGuest` from mount effect. AuthContext mount only restores existing tokens from localStorage. ProtectedRoute is the single owner of guest session initialization via `initGuest()`
- **Rule**: When async initialization can be triggered from multiple React components, designate ONE component as the single owner. Others should only read/restore state, not create it. Use refs to prevent duplicate calls

## 19. Instant refresh: call context refresh after every mutation
- **Problem**: Admin edits (free sessions, site settings, credentials) didn't reflect in the UI until a page refresh. Sidebar showed stale free sessions count; chat toggles didn't appear after enabling them in settings
- **Fix**: After every mutation, call `refresh()` on all affected contexts: `refreshUser()` for user data changes, `settings.refresh()` for settings/credentials changes. Added `refreshAll()` helper in UserDetailPanel that calls both `onRefresh()` and `refreshUser()` when editing self
- **Rule**: Every mutation that changes data visible elsewhere in the UI must call the appropriate context refresh function. Never assume the user will refresh the page

## 20. Register new credentials in CREDENTIAL_REGISTRY for admin UI visibility
- **Problem**: GEMINI_API_KEY was only in .env.example. User couldn't configure it through the admin Integrations panel because it wasn't in the credential registry
- **Fix**: Added `GEMINI_API_KEY` to `CREDENTIAL_REGISTRY` in `credentialService.ts`. Also added `resetClient()` in `imageService.ts` so the lazy-initialized Gemini client picks up new keys without server restart
- **Rule**: Every new API key or secret must be added to `CREDENTIAL_REGISTRY` so admins can manage it through the UI. Never rely on .env-only configuration for keys the user needs to set

## 21. Provide sensible defaults for feature-gating settings
- **Problem**: Chat search and image generation toggles were invisible because `web_search_enabled` and `image_generation_enabled` settings didn't exist in the DB (defaulted to "false")
- **Fix**: Added `SETTING_DEFAULTS` map in `settingsService.ts` that fills in defaults for missing keys when returning settings. Toggles now show by default; admin can still disable them
- **Rule**: New feature-gating settings should default to "true" (enabled) in `SETTING_DEFAULTS` so features are discoverable after implementation. Server-side validation still checks for required API keys

## 22. Always verify third-party API integration with a real call
- **Problem**: Image generation used `gemini-2.0-flash-exp` (a retired experimental model). The error was hidden behind a generic "AI provider error" message. Not caught during implementation because no actual API call was tested
- **Fix**: Updated to a current model (`gemini-2.0-flash-exp-image-generation`). Made model configurable via site settings. Added specific error logging in imageService so the actual Gemini error is visible in server logs
- **Rule**: When integrating any external API, make a real test call during implementation to verify the model/endpoint/key works. Never ship an integration without seeing a successful response. Hardcoded values that may change (like model names) must be admin-configurable

## 23. Always include credentials: "include" on authenticated fetch calls
- **Problem**: `usePrompt.ts` hook was missing `credentials: "include"` on all three fetch calls (GET, PUT, POST). Since the prompts API requires Admin role via httpOnly cookies, the browser never sent the cookies, resulting in 401 errors and "Failed to Load Prompts" in the UI
- **Fix**: Added `credentials: "include"` to all fetch calls in `usePrompt.ts`
- **Rule**: Every `fetch()` call to an authenticated API endpoint must include `credentials: "include"`. This is easy to miss because the request works in tools like Postman but fails in the browser without it

## 24. Token refresh interval must leave adequate buffer before expiry
- **Problem**: Access token expired in 15 minutes, but the client refreshed every 14 minutes — only a 1-minute margin. Any delay (slow network, inactive browser tab, JS event loop blocked) caused the token to expire before refresh, silently logging the user out
- **Fix**: Reduced refresh interval to 12 minutes (3-minute buffer). Added retry logic so transient network errors don't cause hard-logout. Only hard-logout on explicit 401 from the refresh endpoint
- **Rule**: Token refresh interval should be at most 80% of the token lifetime. Add retry logic for transient failures. Never hard-logout on network errors — only on confirmed auth failures (401)

## 25. Server-side reveal endpoint needed for masked credentials
- **Problem**: The eye icon toggle in IntegrationsTab was purely client-side state, but the server always returned masked values. Toggling the icon just showed/hid the already-masked string (e.g., `sk_****`), providing no useful functionality
- **Fix**: Added `GET /api/credentials/:key/reveal` endpoint with audit logging. Client fetches decrypted value on demand. Only Admin role can access
- **Rule**: If the UI has a "show/hide" toggle for sensitive data, there must be a corresponding server-side endpoint that returns the unmasked value on demand. The default API listing should always mask sensitive values

## 26. Always run migrations before declaring a feature complete
- **Problem**: Guest session and PII encryption features were coded but migrations weren't run. The running server crashed on every guest/login request because DB columns didn't exist
- **Fix**: Run all pending migrations as part of the implementation, not as a separate "Up Next" step
- **Rule**: A feature isn't done until its migrations are run and the endpoints are tested against the actual database. Always run migrations immediately after creating them, then verify with end-to-end API tests

## 27. Always kill stale dev ports before testing
- **Problem**: Orphaned Node processes from previous dev sessions held ports 5173/5174/3001. Vite silently hopped to a different port (5175), but the user was still on the old port — causing "Chat + Search not working" because the stale instance had no proxy to the server
- **Fix**: (1) Added `scripts/kill-dev-ports.mjs` (Node.js, not bash — user runs PowerShell without WSL) that kills any process on ports 5173 and 3001, (2) added `predev` npm hook to run it automatically before `pnpm dev`, (3) added `strictPort: true` in Vite config so it fails immediately instead of port-hopping, (4) added graceful shutdown (SIGINT/SIGTERM handlers) to Express server so it releases the port on Ctrl+C
- **Rule**: Before testing, always ensure dev ports are clean. The `predev` script handles this automatically, but if issues arise, run `node scripts/kill-dev-ports.mjs` manually. Vite's `strictPort: true` makes port conflicts immediately visible instead of silently using wrong ports

## 28. Cookie sameSite: "strict" breaks auth in proxy setups
- **Problem**: Users kept getting silently logged out. Root cause: `sameSite: "strict"` on auth cookies + `path: "/api/auth/refresh"` on the refresh token cookie. In Vite's dev proxy (`:5174` → `:3001`), browsers silently dropped the cookies, causing every refresh attempt to fail with 401
- **Fix**: Changed to `sameSite: "lax"` (the browser default, used by GitHub/Stripe/Vercel) and `path: "/"` on the refresh token cookie. Also exempted `/api/auth/` from the global rate limiter
- **Rule**: Use `sameSite: "lax"` for auth cookies (not `"strict"`). Set `path: "/"` for refresh token cookies — restrictive paths cause silent failures with proxies. `"lax"` provides sufficient CSRF protection since refresh endpoints are POST-only. Also exempt auth routes from global rate limiters to prevent refresh failures during heavy usage

## 29. @ai-sdk/anthropic doesn't support server tools (web search) — requires response stream transformer
- **Problem**: Enabling Anthropic's `web_search_20250305` server tool via custom `fetch` wrapper crashed with `TypeError: Cannot read properties of undefined (reading 'toolCallId')`. The `@ai-sdk/anthropic` SDK (any version, including v4.0.0-beta.2) only handles 4 content block types (`text`, `thinking`, `redacted_thinking`, `tool_use`). Server tools introduce `server_tool_use` and `web_search_tool_result` block types, plus `citations_delta` deltas — all fail Zod schema validation
- **Fix**: Built a response stream transformer in the custom `fetch` wrapper (`providerService.ts`) that intercepts the SSE stream between Anthropic's API and the SDK. The transformer: (1) filters out `server_tool_use` blocks entirely, (2) converts `web_search_tool_result` blocks to text blocks with formatted source links, (3) strips `citations_delta` events, (4) strips `citations` field from text block starts, (5) remaps content block indices to be sequential after filtering, (6) pairs `event:` lines with `data:` lines to skip/keep them together, (7) buffers incomplete lines split across SSE chunks to prevent partial events from leaking through
- **Rule**: When using Anthropic server tools with `@ai-sdk/anthropic`, ALWAYS transform the SSE response stream to filter unsupported event types. The SDK's Zod schema is strict — any unknown `content_block.type` or `delta.type` produces `3:"An error occurred."` error frames. SSE chunk boundaries can split data lines — buffer incomplete lines to ensure filtering is applied to complete JSON events

## 30. Session/usage billing must match user expectations
- **Problem**: Free session counter was decremented per-conversation (on creation), not per-message. Users expected every chat interaction to cost a session. The sidebar counter appeared stuck because it only updated when starting a new conversation
- **Fix**: Moved `decrementFreeSessions()` from `conversationController.handleCreateConversation` to the chat route handler (after successful stream completion). Added `refreshUser()`/`refreshGuestUsage()` after every stream completion in ChatContainer, not just after conversation creation
- **Rule**: Always bill usage at the smallest meaningful unit (per-message, not per-conversation). Refresh usage counters in the UI after every billable action, not just on entity creation

## 32. Zod `.min(1)` on AI message body rejects valid intermediate tool-call steps
- **Problem**: `messageBody: z.string().min(1)` in `handleSaveMessages` caused a 400 error when the AI used multi-step tool calls. Intermediate steps where the model called a tool (searchKnowledge, readKnowledgeDocument) produce messages with `content: ""`. The client's silent `catch` block ignored the 400 and still navigated — ChatPage loaded an empty conversation (blank page).
- **Fix**: Changed to `z.string()` (allow empty). Also added client-side filter to skip messages with empty content before saving, and added `response.ok` check before updating the persisted count.
- **Rule**: Never use `.min(1)` for AI-generated content fields. The model may produce empty-content messages during tool-call steps. Filter empty messages client-side before the save API call.

## 33. navigate() before message save causes blank page on first conversation
- **Problem**: `navigate('/chat/:id')` was called immediately after creating the conversation record, before messages were saved. React processed the navigation while the message save was in-flight. ChatPage loaded and fetched the conversation — which had 0 messages — showing the WelcomeScreen (blank page).
- **Fix**: Moved `navigate()` and `refresh()` to AFTER the message save fetch. Used an `isFirstPersist` flag (captured before async ops) to only navigate on the first persistence call for a new conversation.
- **Rule**: Always save data to the server BEFORE navigating to the URL that will fetch that data. Never trust that React's async rendering will wait for in-flight fetches.

## 34. maxSteps too low causes tool-call-only streams with no text output
- **Problem**: `maxSteps: 3` allowed the model to use all 3 steps as tool calls (e.g., searchKnowledge × 2 + readKnowledgeDocument). When the last step is a tool call, the Vercel AI SDK stops without generating a final text response — the stream ends with no assistant text.
- **Fix**: Increased to `maxSteps: 5` (8 with web search). Added `onStepFinish` logging to the server to track each step type and finish reason.
- **Rule**: Set maxSteps to at least (expected tool calls + 2) to leave headroom for retries and the final text generation step. Always add `onStepFinish` logging during development to observe the actual step flow.

## 31. Never redirect users away from the main experience on session expiry
- **Problem**: When auth tokens expired and guest limit was reached, `ProtectedRoute` redirected to `/login`, removing the user from the chat page entirely
- **Fix**: Removed `Navigate to="/login"` from `ProtectedRoute`. Added `guestLimitReached` check to the spinner condition so the page renders children even without active auth. Chat errors (403) now show inline banners with register/upgrade links instead of redirecting
- **Rule**: Always keep users on the main page. Handle auth/quota exhaustion with inline UI (banners, modals) rather than redirects. Redirecting away from the user's context is poor UX


## 35. vite.config.ts changes require a full Vite restart — batch them
- **Problem**: Changes to `vite.config.ts` (e.g., adding `selfHandleResponse: true` to the proxy) are NOT picked up by HMR. The dev server must be fully restarted. Deferring this across sessions causes repeated "why do I have to restart?" friction.
- **Fix**: Always restart the Vite dev server immediately after any `vite.config.ts` change, in the same session it was made. Never leave a `vite.config.ts` change pending.
- **Rule**: Batch all `vite.config.ts` changes into a single edit and restart once. Express server (`tsx watch`) restarts automatically — never requires manual intervention.

## 36. Always present deployment platform alternatives upfront
- **Problem**: Defaulted to Railway because a `railway.toml` existed. Spent hours debugging Railway-specific issues (interactive drizzle-kit prompts, build failures, port mismatches) before discovering Render was simpler for this use case.
- **Fix**: Migrated to Render — zero-config SSL, auto-deploy from GitHub, persistent disks, straightforward custom domains.
- **Rule**: When deploying for the first time, present 2-3 platform options with pros/cons. Don't assume the existing config file means the platform is chosen.

## 37. Local file storage is incompatible with cloud hosting
- **Problem**: Images saved to `/uploads/` on local disk. In production (Render), files are ephemeral — lost on redeploy. Local dev and prod share the same DB but different filesystems, so image URLs break across environments.
- **Fix**: Integrated Cloudinary for all image uploads. One URL works everywhere — local, staging, production.
- **Rule**: Never use local disk storage for user-facing assets in a cloud-deployed app. Use cloud storage (Cloudinary, S3) from day one. If local storage exists, migrate to cloud before first production deploy.

## 38. Helmet CSP blocks external assets by default
- **Problem**: After integrating Cloudinary, images didn't load. `app.use(helmet())` with no config sets a strict Content Security Policy that only allows `'self'` sources.
- **Fix**: Added explicit CSP directives to whitelist `https://res.cloudinary.com` for `img-src` and `connect-src`.
- **Rule**: When adding any external service that serves assets (images, fonts, scripts), update the Helmet CSP directives immediately. Test in production — CSP violations are silent in dev if Helmet isn't configured.

## 39. DB credentials vs env vars — know which services read from where
- **Problem**: Cloudinary credentials were saved in the DB via Settings → Integrations, but `imageService.ts` read from `process.env`. The `hydrateEnvFromCredentials()` runs at startup, but credentials saved after startup weren't picked up.
- **Fix**: Changed `getCloudinary()` to async, using `getCredentialValueWithFallback()` which reads DB first, falls back to env vars.
- **Rule**: When a service reads API credentials, always use `getCredentialValueWithFallback()` — never `process.env` directly. This ensures admin-panel changes take effect without server restart.

## 40. Railway is strict — interactive prompts break CI/CD
- **Problem**: `drizzle-kit push` prompts for confirmation when adding constraints. Railway (and most CI/CD) can't respond to interactive prompts. Build hung indefinitely.
- **Fix**: Used `--force` flag and piped input. Ultimately moved to Render which had different issues but was simpler overall.
- **Rule**: All build/deploy commands must be non-interactive. Test the full build command locally before deploying. Use `--force`, `--yes`, or equivalent flags for every tool in the pipeline.

## 41. pgvector index creation needs extra memory
- **Problem**: `pg_restore` into Render PostgreSQL failed with "memory required is 59 MB, maintenance_work_mem is 16 MB" when creating the vector index.
- **Fix**: `SET maintenance_work_mem = '256MB';` before running the import.
- **Rule**: When migrating databases with pgvector, always increase `maintenance_work_mem` before import. Default 16MB is insufficient for vector indexes.

## 42. Cloudinary cloud_name is the technical ID, not the display name
- **Problem**: User entered "Culinaire Kitchen PROD" as the cloud name. Cloudinary returned "Invalid cloud_name". The actual cloud name is a short alphanumeric string like `dxyz123abc`.
- **Fix**: Updated to the correct technical cloud name from the Cloudinary dashboard.
- **Rule**: When integrating external services, validate credentials with a test API call immediately after configuration. Don't wait until the feature is used in production to discover misconfiguration.

## 43. Render internal DB connections do NOT use SSL
- **Problem**: Added SSL to the main postgres connection when the URL contains `render.com`. The internal Render database URL also contains `render.com` but internal connections reject SSL — caused `ECONNRESET` and took the entire site down.
- **Fix**: Reverted SSL on the main DB connection (`db/index.ts`). Only apply SSL to ad-hoc connections using the external URL (like the admin query tool in `databaseController.ts`).
- **Rule**: Render internal connections = no SSL. Render external connections = SSL required. Never apply SSL blanket-style based on URL hostname. The main app connection uses the internal URL; only admin/debug tools use the external URL.

## 44. Render has TWO database URLs — always verify which one is used where
- **Problem**: Render PostgreSQL provides an internal URL (for services in the same region, no SSL) and an external URL (for outside access, SSL required). The web service was configured with the external URL, causing ECONNRESET because the main DB connection doesn't use SSL.
- **Fix**: Changed `DATABASE_URL` in Render web service env vars to the internal URL. Local `.env` keeps the external URL (with SSL in ad-hoc connections).
- **Rule**: ALWAYS explicitly verify the DATABASE_URL type during deployment setup. Internal URL for Render web services (same-region, no SSL, zero latency). External URL for local dev and admin tools (requires SSL). When debugging connection errors post-deploy, check the DATABASE_URL first — it's the most common misconfiguration.

## 45. Every push to production needs a deployment checklist
- **Problem**: New schema tables (recipe_version, prep_session, etc.) were added in code but not created in the production database. The app deployed but features broke silently because tables didn't exist.
- **Fix**: Run table creation SQL immediately after every push that includes schema changes.
- **Rule**: Before EVERY push to main, run through this checklist:
  1. `tsc --noEmit` passes for both server and client
  2. New schema tables? → Run CREATE TABLE SQL on production DB
  3. New columns on existing tables? → Run ALTER TABLE SQL on production DB
  4. New env vars needed? → Add to Render environment
  5. New npm packages? → Verify they're in package.json (auto-installed on deploy)
  6. CSP changes needed? → Update Helmet directives in index.ts
  7. Cloudinary credentials needed? → Verify in Settings → Integrations
  8. Frontend/backend API routes match? → Audit all fetch URLs
  9. Test locally before pushing
  The devil is in the details — every missed step is a production incident.

---

- **Problem**: `drizzle-kit push` fails on Neon PostgreSQL with `cannot drop view pg_stat_statements_info` and `column "user_organisation_id" is in a primary key`. Neon creates explicit NOT NULL constraints on PK columns that drizzle-kit tries to reconcile, and pg_stat_statements is a Neon-managed extension.
- **Fix**: Created an idempotent migration script (`src/db/migrate-purchasing.ts`) using raw SQL with `IF NOT EXISTS` checks. Bypasses drizzle-kit's full-schema diff entirely.
- **Rule**: Do NOT use `drizzle-kit push` for schema changes on Neon. Write idempotent migration scripts with `addColumnIfNotExists` and `CREATE TABLE IF NOT EXISTS`. This avoids interactive prompts, Neon extension conflicts, and PK constraint drift. Keep `drizzle-kit` for local dev only.

---

## 46. Return the created entity from `createX` hooks; never discard a POST response that contains an id
- **Problem**: `useMenuItems.createItem` discarded the POST `/api/menu/items` response (which includes the new `menuItemId`). Downstream, `MenuItemFormModal` needed that id to save ingredients via the follow-up endpoint. With no id available, the modal silently skipped the ingredient-save step (`if (itemId) { ... }`). Items created via "Import from Recipe" persisted with zero ingredients — the UI looked correct while the modal was open (ingredients lived in React state) but came back empty on reopen because they were never written.
- **Fix**: `createItem` now returns the parsed JSON as `MenuItem`; `handleSaveItem` returns `created.menuItemId` on the create branch so the modal can target the new row.
- **Rule**: Any client `createX` helper whose backend returns the new row MUST return that row to the caller. Silent `void` returns that throw away the id are a foot-gun whenever a follow-up call (ingredients, attachments, child rows) needs it. Also: never gate a critical save step behind a truthy id check without surfacing a fallback error — the silent skip masked the bug for an entire feature flow.

---

## 47. Per-call `fetchItems()` inside CRUD hooks causes UI thrashing on batched operations
- **Problem**: `useMenuItems.addIngredient` and `removeIngredient` each called `await fetchItems()` after their HTTP request. When `handleSaveIngredients` looped over 5 ingredients, the items list refetched 5 times mid-save — each refetch toggled `loading: true` and the page visibly blinked.
- **Fix**: Removed `fetchItems()` from inside `addIngredient`/`removeIngredient`. The single refresh in `handleCloseForm` covers it. `MenuItemDetail` already manages its own ingredient state, so it wasn't relying on the side-effect.
- **Rule**: CRUD hooks should not refetch list state as a side-effect of single-row mutations. Let the caller batch and refresh once at the end. If a caller genuinely needs immediate refresh (e.g. inline edit with no surrounding flow), it can call `refresh()` explicitly.

---

## 48. Generic `throw new Error("Failed to X")` in fetch helpers hides the actual reason
- **Problem**: Bug-hunting "Failed to add ingredient" took an extra round-trip because the hook discarded the server's `{ error: "Invalid quantity" }` body and threw a static string. The user couldn't see *which* ingredient failed or *why* until I instrumented the hook to surface the response body.
- **Fix**: All client fetch helpers in `useMenuItems` now read the JSON error body when `!res.ok`, fall back to status code, and (for ingredient ops) include the failing row's name in the message.
- **Rule**: Whenever a client helper calls a route that returns structured `{ error }` on failure, surface that body in the thrown message. Static error strings are debugging dead-weight. Pattern:
  ```ts
  if (!res.ok) {
    let msg = `Failed to X (${res.status})`;
    try { const body = await res.json(); if (body?.error) msg = body.error; } catch {}
    throw new Error(msg);
  }
  ```

---

## 49. Sanitize free-text quantities before sending to a numeric-regex endpoint
- **Problem**: Recipe ingredients can carry amounts like `"to taste"`, `"1/2"`, `"about 2 tbsp"`, or `""`. `MenuItemFormModal.handleSelectRecipe` passed these straight through. The server's Zod schema rejects anything that doesn't match `/^\d+(\.\d{1,3})?$/`, so the import flow blew up on the first non-numeric row (e.g. flaky sea salt).
- **Fix**: Added `sanitizeQuantity(raw)` in the import path — extracts the first `\d+(\.\d{1,3})?` token via regex, defaults to `"0"` when no number is present.
- **Rule**: When a free-text field from one bounded context (recipes — narrative) crosses into a stricter context (menu costing — numeric), translate at the boundary. Don't push the burden of validation onto the receiving endpoint and don't drop ingredients silently — surface them with a `0` and let the user correct.
