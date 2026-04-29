---
title: Mobile API Contract
category: concept
created: 2026-04-29
updated: 2026-04-29
related: [[culinaire-kitchen-platform]], [[prompt-system]], [[technical-architecture]]
---

The contract between the web monorepo (this repo, API-only for mobile) and the separate CulinAIre mobile repo (React Native, on-device Gemma 3n E4B inference). Documents every cross-repo touchpoint so both sides can change in lockstep.

## Repo split (load-bearing context)
- **This repo** — Express API on port 3009. Provides routes; does not ship mobile UI.
- **Mobile repo** (separate) — React Native client. Runs Gemma 3n E4B on-device for inference; only fetches prompt bodies + auth + persistence from this API.
- **Two-Claude-session protocol** — one Claude works each repo. When the API contract changes here, flag it explicitly so the mobile session can adapt.

## Auth flow
Same JWT system as the web client, but **token transport differs**:

| Client | Access token transport | Refresh token transport |
|---|---|---|
| Web | `access_token` httpOnly cookie | `refresh_token` httpOnly cookie |
| Mobile | `Authorization: Bearer <token>` header | response body field, stored in mobile keychain |

The unified `authenticate` middleware ([packages/server/src/middleware/auth.ts:25-52](../../packages/server/src/middleware/auth.ts)) accepts either Bearer or cookie — every protected route works for both clients without route-level branching.

### Mobile-specific entry point
- `POST /api/auth/google/idtoken` ([routes/auth.ts:47](../../packages/server/src/routes/auth.ts), [authController.ts:473-476](../../packages/server/src/controllers/authController.ts)) — accepts a Google ID token from the React Native Google Sign-In library and returns `{ user, tokens: { accessToken, refreshToken } }`. Web clients hit the same shape but ignore `tokens` and read cookies instead.

## Mobile-prefixed routes
**Currently a single endpoint.** The `/api/mobile/*` namespace is reserved for routes that exist *because* the mobile client is on-device — not for routes mobile happens to use.

### `GET /api/mobile/prompts/:slug`
Fetch a prompt body for on-device inference. Introduced in commit `128a119`.

- **Auth** — required. JWT via Bearer or cookie.
- **Rate limit** — 30 req/min per authenticated user, falls back to IP when unauthenticated ([middleware/rateLimiter.ts:37-47](../../packages/server/src/middleware/rateLimiter.ts)). Generous because mobile clients fetch prompts ~once on launch + on version-bump invalidation.
- **Slug validation** — `/^[a-z0-9-]+$/`, 1-100 chars ([mobilePromptsController.ts:31-35](../../packages/server/src/controllers/mobilePromptsController.ts)). Blocks path traversal before the DB query.
- **Filter** — only prompts with `runtime = "device"` and `defaultInd = false` are returned ([promptService.ts:210](../../packages/server/src/services/promptService.ts)). Server-runtime prompts are off-limits to mobile.
- **Response (200):**
  ```json
  {
    "promptKey": "string",
    "promptBody": "string (markdown)",
    "runtime": "device",
    "modelId": "string | null",
    "version": "number",
    "updatedAtDttm": "ISO 8601"
  }
  ```
- **404 contract** — both "prompt not found" and "prompt is server-runtime, not device" return identical 404s. Intentional: prevents enumeration of server-runtime prompts via this endpoint ([mobilePromptsController.ts:74-85](../../packages/server/src/controllers/mobilePromptsController.ts)).
- **Caching invariant** — mobile caches by `version`. Refetch only when server `version` > cached `version`. Lock-tested in [mobilePromptsController.test.ts:172-175](../../packages/server/src/controllers/mobilePromptsController.test.ts).

## Device tokens (push notification readiness)
The schema and registration path are wired; **actual FCM/APNs dispatch is not yet implemented**.

### Table — `device_token` ([db/schema.ts:1941-1958](../../packages/server/src/db/schema.ts))
| Column | Type | Notes |
|---|---|---|
| `device_token_id` | UUID PK | |
| `user_id` | INT FK → user | |
| `token_value` | VARCHAR(500) UNIQUE | FCM token (Android) or APNs token (iOS) |
| `platform` | VARCHAR(10) | `"android"` or `"ios"` |
| `last_used_dttm` | TIMESTAMP TZ | refreshed on every re-register |
| `created_dttm`, `updated_dttm` | TIMESTAMP TZ | |

### `POST /api/notifications/register-device` ([routes/notifications.ts:13](../../packages/server/src/routes/notifications.ts))
- **Auth** — required.
- **Body** — `{ deviceToken: string, platform: "android" | "ios" }`.
- **Behaviour** — upserts on `token_value`. Re-registering the same token updates `last_used_dttm` rather than erroring ([notificationsController.ts:52-68](../../packages/server/src/controllers/notificationsController.ts)).
- **Response** — 200 `{ message: "Device registered." }`.

### Notification service current state
[services/notificationService.ts](../../packages/server/src/services/notificationService.ts) handles **IN_APP** (the bell) and **EMAIL** (Resend) channels only. The push-dispatch code is gated by a comment marker: *"Actual push dispatch (FCM for Android, APNs for iOS) is wired when the native app is ready"* ([notificationsController.ts:5-7](../../packages/server/src/controllers/notificationsController.ts)).

**Notification types defined** ([notificationService.ts:25-30](../../packages/server/src/services/notificationService.ts)): `APPROVAL_REQUIRED`, `PO_APPROVED`, `PO_REJECTED`, `DISCREPANCY_ALERT`, `DELIVERY_OVERDUE`. These are kitchen-ops events; when push dispatch lands, mobile listens on these.

## Rate limiting summary
| Limit | Endpoint(s) | Source |
|---|---|---|
| 30 req/min per user | `GET /api/mobile/prompts/:slug` | [rateLimiter.ts:37-47](../../packages/server/src/middleware/rateLimiter.ts) |
| 20 req/min per user | chat (web) | rateLimiter.ts |
| Default global | everything else | rateLimiter.ts |

All limiters use draft-8 RateLimit headers so mobile can introspect remaining quota.

## Test coverage
Locks the contract — change a number here, a test fails:
- [mobilePromptsController.test.ts](../../packages/server/src/controllers/mobilePromptsController.test.ts) — slug validation, 404 unification, response shape, version-as-number invariant.
- [rateLimiter.test.ts](../../packages/server/src/middleware/rateLimiter.test.ts) — 30/min config, per-user keying with IP fallback, draft-8 headers.
- [authController.test.ts](../../packages/server/src/controllers/authController.test.ts) — Google ID token flow, mobile receives `tokens` field in response body.

## Known gaps (for backlog)
1. **Push dispatch** — device tokens are persisted but no FCM/APNs send code. Add when mobile native app is ready.
2. **Token rotation** — no explicit refresh-token endpoint hardening for mobile yet (web has cookie rotation; mobile reads from response body and stores in keychain).
3. **`/api/mobile/*` namespace is sparse** — only one route. Future device-only contracts (e.g., on-device model bundle URL, sync diff endpoints) belong here.

## When something on this contract changes
1. Update this page first (date the `updated:` frontmatter).
2. Append a `wiki/log.md` entry describing the contract change.
3. Flag the change to whoever is running the mobile-repo Claude session — API contract changes are the highest-risk class of cross-repo coordination.

## Related
- [[culinaire-kitchen-platform]]
- [[prompt-system]] — server-side prompt registry that backs `/api/mobile/prompts/:slug`
- [[technical-architecture]] — broader stack context
