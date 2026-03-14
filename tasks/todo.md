# CulinAIre Kitchen — TODO

## Completed

### Phase 1 — Core Chat
- [x] Project scaffolding and initial setup (pnpm monorepo, Turborepo)
- [x] Implement Culinary Knowledge Chatbot UI (React 19 + Vite)
- [x] Wire up AI service with Vercel AI SDK (streamText, useChat)
- [x] Create knowledge base content (techniques, pastry, spirits, ingredients)
- [x] Write system and technique prompt templates
- [x] Set up database with Drizzle ORM (PostgreSQL on Railway)

### Phase 2 — Settings, History, Appearance
- [x] Sidebar: Settings at bottom, version footer
- [x] Prompt versioning (7 max, rollback, version history UI)
- [x] Chat/Conversation history (persist, sidebar list, continue where left off)
- [x] Site Settings tab (page title, meta, favicon/logo upload, footer text)
- [x] Appearance tab (chat window width + height)
- [x] Push all schemas to DB
- [x] Dynamic sidebar branding (page_title + logo_path, clickable to home)
- [x] Footer text from settings (center-justified)
- [x] Upload image preview fix (Vite proxy for /uploads)

### Phase 3 — Auth, Roles, Profile
- [x] Add authentication with Better Auth (JWT + httpOnly cookies)
- [x] RBAC: Roles (Administrator, User, Chef) + granular permissions
- [x] Profile page with tabs (Account, Password, Organisation)
- [x] Avatar upload (POST /api/users/profile/avatar)
- [x] Organisation create/join with CULINAIRE-prefixed keys
- [x] Rename "Admin" → "Administrator" + permission key renames
- [x] Encrypted credentials management (Integrations tab)
- [x] Stripe integration (subscription tiers, webhooks)
- [x] MFA with TOTP (otplib)
- [x] OAuth (Google) login

### Phase 4 — Multi-Prompt, User Management, Polish
- [x] Multi-prompt management (dynamic prompts, auto-generated keys)
- [x] Integrations tab reorganization (sub-tabs by category)
- [x] User management table with search, pagination, role assignment
- [x] User detail slide-over panel (account info, email, delete)
- [x] User deletion with cascade (messages, conversations, roles, tokens)
- [x] Direct email to users via Resend
- [x] Email verification badges in UsersTab
- [x] ARIA attributes on all tabbed interfaces (Settings, Profile, Integrations, Prompts)
- [x] Keyboard navigation (arrow keys) for tab bars
- [x] Focus trapping + Escape close on slide-over panels (UserDetailPanel, VersionHistory)
- [x] JSDoc standardization across all controllers and services

### Phase 5A — Bug Fixes + Rate Limiting
- [x] Fix sidebar not extending to bottom edge of viewport
- [x] Profile photo upload error feedback (inline error near avatar)
- [x] Compose email error handling (Resend SDK `{ data, error }` checking)
- [x] Chat-specific rate limiting (20 req/min per user, `express-rate-limit`)

### Phase 5B — Schema Changes + Forgot Password
- [x] Migration: address fields + bio + password_reset table
- [x] Forgot password flow (request + reset endpoints, 1hr token, one-time use)
- [x] Profile address fields + bio UI (6-field address form, 300-char bio)
- [x] Organisation address fields UI (structured address)

### Phase 5C — PII Encryption
- [x] Crypto utility extension (encryptPii, decryptPii, hashForLookup with separate keys)
- [x] Schema: encryption columns (_enc, _iv, _tag, _hash for email)
- [x] PII service layer (encryptUserPii, decryptUserPii, encryptOrgPii, decryptOrgPii)
- [x] Dual-write/dual-read in auth, user, and org services
- [x] Login via email hash lookup (transition-safe with OR clause)

### Phase 5D — User Management + UX
- [x] Editable UserDetailPanel (PATCH /api/users/:id for name, email, status)
- [x] Auto-save on tab change (dirty tracking via ref comparison)
- [x] Chat sidebar auto-refresh (ConversationContext with shared refresh)
- [x] OAuth provider separation in Integrations tab

### Phase 5E — Profile Enhancements
- [x] Profile photo crop/resize (react-easy-crop modal, canvas blob upload)

### Phase 5F — SEO + Sitemap
- [x] Sitemap.xml generation (dynamic route at /sitemap.xml)
- [x] robots.txt (allow /, block protected routes)
- [x] Open Graph + Twitter Card meta tags
- [x] JSON-LD structured data (Organization schema)
- [x] Canonical URLs + per-route meta via usePageMeta

### Phase 5G — Guest Mode
- [x] Guest session backend (guest_session table, guestService, guestAuth middleware)
- [x] Guest usage limit (10 conversations, 403 with registrationRequired)
- [x] Guest conversation persistence (guestSessionToken on conversation table)
- [x] Guest-to-user conversion (link conversations on registration)
- [x] Guest frontend (AuthContext, ChatContainer, Sidebar, LoginPage)

### Phase 5H — Web Search for AI
- [x] Web search toggle in admin Site Settings (web_search_enabled)
- [x] Conditional Anthropic web_search_20250305 tool in aiService
- [x] MaxSteps increases from 3 to 5 when web search is enabled

### Phase 5I — Default Landing + Anti-Abuse
- [x] Auto-initialize guest session on first visit (ProtectedRoute + AuthContext)
- [x] Remove "Continue as Guest" button from LoginPage
- [x] IP-based anti-abuse tracking (ip_address column, 3 sessions/IP limit)
- [x] Server-side guest token generation (moved from client to server)
- [x] Trust proxy configuration for Railway deployment
- [x] Guest limit reached → redirect to login page

## Up Next
- [x] Run database migrations (add-address-bio-reset, add-pii-encryption-columns, add-guest-session, add-guest-ip-tracking)
- [x] Run PII data migration (encrypt-existing-pii)
- [ ] Clean up debug console.log statements
- [ ] Rotate exposed Anthropic API key
- [ ] Deploy to Railway
- [ ] Commit to GitHub

## Future Modules
- [ ] Recipe Development Lab
- [ ] Culinary Ratio Engine
- [ ] Menu Intelligence
- [ ] Kitchen Operations Copilot
