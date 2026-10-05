# End-to-end tests (Playwright)

Browser tests in `packages/client/tests/e2e/`. They drive a real Chromium against the local Vite dev server (5179) and Express API (3009), logged in as the E2E account.

## Run

```bash
# terminal 1
ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server dev
# terminal 2
pnpm --filter @culinaire/client dev
# terminal 3
pnpm --filter @culinaire/client test:e2e        # all specs
pnpm --filter @culinaire/client test:e2e:ci     # all specs, then the skip gate
```

Credentials come from `.env.test` (`E2E_USER_EMAIL`, `E2E_USER_PASSWORD`, `E2E_USER_TOTP_SECRET`). Only ONE Playwright process may run at a time: TOTP codes are single-use per 30 s, and concurrent runs share `_auth/storageState.json`. That is why the suite uses one worker.

## Rules every spec follows

1. **Import `test`/`expect` from `./_helpers/test`**, never `@playwright/test` (ESLint enforces this). The shared `test` fails any test where the page throws an uncaught error or an `/api/*` call returns 5xx, even if the test's own assertions pass. 401/403 are allowed. Tolerating a 5xx needs an entry in `ALLOWED_5XX` with a comment.
2. **Local only.** `playwright.config.ts` refuses any `E2E_BASE_URL` that is not localhost/127.0.0.1, because the suite writes real rows.
3. **Self-seeding, self-cleaning.** A spec creates what it needs through the API (`api` fixture + `apiCall`), names every row with `currentPrefix()` (`e2e-<runId>-...`), and registers undo with `defer(label, undo)` or a `try/finally`. Missing data is a failure, never a `test.skip`.
4. **No `waitForLoadState("networkidle")`** (socket.io never idles) and no fixed sleeps. Wait on an element or `expect.poll`.
5. **No skips** except the one deliberate one in `scripts/checkE2eSkips.mjs`: the public-holidays permission skip (the E2E account lacks `roster:manage`). `test:e2e:ci` fails if any other test is skipped.

## Rate limit

The server allows 300 `/api` requests a minute per signed-in user (60 per IP for anonymous traffic), and a page load costs about 15. The shared `test` has an auto fixture (`rateBudget`) that waits until 30 requests of budget are free before each test, and `apiCall` retries a 429. With the per-user limit the wait rarely triggers; do not add sleeps or retries of your own.

## Rows the API cannot delete

Purchase orders and shifts can only be cancelled, and a role with shifts cannot be deleted. Those rows pile up in the dev DB. Sweep them with:

```bash
ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/cleanupE2eData.ts
```

It deletes only `e2e-*` rows older than 60 minutes, and refuses to run in a production process.

## Route table

`_helpers/routes.ts` lists every page route in `App.tsx`, classed `gated`, `guest-open` or `public`. `route-smoke.spec.ts` renders each as the E2E user. When you add a route to `App.tsx`, add it there.

`auth-boundary.spec.ts` runs with an empty session: every `gated` route must redirect to `/chat/new` or show the "This tool isn't on your plan" card, and a table of protected API endpoints must return 401. Add new protected endpoints to its `PROTECTED_API` list. Anonymous traffic is limited to 60 requests a minute per IP, so that spec waits out a 429 rather than failing on it.

## CI

The `Browser E2E (Playwright)` job in `.github/workflows/ci.yml` runs this suite on every PR against a throwaway pgvector Postgres: `db:push`, `db:seed`, then `src/scripts/seedE2eCiData.ts` (the MFA-enabled E2E user with the Administrator, Subscriber and Operations Admin roles, one organisation, one HQ location), then the API (tsx) and the Vite dev server (it proxies `/api`), then `test:e2e:ci`. The credentials are throwaway literals in the workflow env, because fork PRs get no secrets. The seed refuses any non-localhost database. On failure the traces, screenshots and server log are uploaded. Whether the job blocks merging is a branch-protection setting (required status checks), not part of the workflow.
