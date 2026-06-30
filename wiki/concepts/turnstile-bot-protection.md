---
title: Cloudflare Turnstile Bot Protection
category: concept
created: 2026-06-30
updated: 2026-06-30
related: [[technical-architecture]], [[data-flow-architecture]], [[mobile-api-contract]]
---

Cloudflare Turnstile guards the three unauthenticated auth endpoints (login, registration, password reset) for **web browsers only**, with DB-managed keys. The mobile app shares these endpoints and is intentionally exempt (it can't render the browser widget) — see [[mobile-api-contract]].

## What it protects

Web-only enforcement on:
- `POST /api/auth/login`
- `POST /api/auth/register`
- `POST /api/auth/forgot-password`

A **browser** request (one carrying an `Origin` header) must include a
`turnstileToken` that passes Cloudflare's siteverify check, or it is rejected
with `400` before any password check / user creation / reset email.

**Native (mobile) requests carry no browser `Origin` header**, so
`enforceTurnstileForWeb()` (`authController.ts`) skips the check and they
proceed normally. `turnstileToken` is therefore **optional** at the Zod schema
layer and required only in the handler for browser requests. The non-browser
path is covered by `authRateLimit` (20 req/min per IP, hashed IP) in
`rateLimiter.ts` as the abuse backstop. Mobile Google Sign-In
(`/api/auth/google/idtoken`) is not gated.

## Key storage (admin-controllable, encrypted)

The site key and secret key live in the encrypted `credential` table and are
managed from **Settings → Integrations → Cloudflare**:

- `CLOUDFLARE_TURNSTILE_SITE_KEY` — public, `sensitive: false`
- `CLOUDFLARE_TURNSTILE_SECRET_KEY` — server-only, `sensitive: true`

Registered in `CREDENTIAL_REGISTRY` (`packages/server/src/services/credentialService.ts`)
under a dedicated `cloudflare` category. No env edits or rebuilds needed to
rotate keys — `upsertCredential` updates `process.env` live, and the public
config endpoint reads the current value on every page load.

## Request flow

1. Browser loads an auth page → `TurnstileWidget`
   (`packages/client/src/components/auth/TurnstileWidget.tsx`) fetches the site
   key from `GET /api/auth/turnstile-config` (public; returns **only** the site
   key, never the secret).
2. Widget loads Cloudflare's `api.js` (explicit render, zero npm dep) and shows
   the challenge. Submit buttons stay disabled until a token is produced.
3. On submit the token rides in the request body (`turnstileToken`).
4. `turnstileService.verifyTurnstileToken` (`packages/server/src/services/turnstileService.ts`)
   POSTs secret + token to `https://challenges.cloudflare.com/turnstile/v0/siteverify`,
   with a 5s `AbortSignal.timeout` so a slow Cloudflare can't hang the auth path.
5. The controller's `enforceTurnstileForWeb()` rejects browser requests with
   `400` ("Security check is required." when the token is absent, "Security
   check failed. Please try again." when it fails to verify).

## Fail-closed posture

For browser requests, verification fails closed: if the secret key is missing,
the siteverify call errors, or it times out, `verifyTurnstileToken` returns
`success: false` and the web request is rejected — a missing/broken config can
never silently bypass the check for web. Tokens are single-use; the widget
auto-resets on a failed submit so the user can retry. (Native requests skip the
check entirely and rely on `authRateLimit`.)

## Bootstrap / lockout note

Web enforcement gates browser login, and the Integrations panel that holds the
keys is behind admin login — so for web admins the keys must be present from
first traffic (provisioned via DB/env before the server serves requests).
Cloudflare's always-pass test keys are the safe local-dev default. Native/admin
access via the mobile app or a non-browser client is unaffected by a missing
key (it skips Turnstile), which also limits the lockout blast radius.

## Testing

- `turnstileService.test.ts` — pass, fail, missing-secret (fail-closed, never
  calls Cloudflare), network error, no-remoteip branch, error-code passthrough.
- `authController.test.ts` — web (Origin) login/register/forgot-password reject
  with `400` and skip the underlying action when Turnstile fails or the token is
  missing; **native (no Origin) requests succeed without a token** (mobile
  regression); `handleTurnstileConfig` returns `{ siteKey }` / forwards errors.
- `rateLimiter.test.ts` — `authRateLimit` config (20/min, hashed IP).
- Verified live: web (Origin) rejects bogus/missing tokens via Cloudflare
  siteverify; native (no Origin) login/register/forgot-password flow through;
  widget renders the real challenge on all three pages with submit gated.
