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

The `Browser E2E (Playwright)` job in `.github/workflows/ci.yml` runs this suite on every PR against a throwaway pgvector Postgres: `db:push`, `db:seed`, then `src/scripts/seedE2eCiData.ts` (the MFA-enabled E2E user with the Administrator, Subscriber and Operations Admin roles and onboarding marked done, one organisation, one HQ location, and the `roster_enabled` and `workforce_enabled` flags switched on, because `db:seed` ships them off and their routes 404), then the API (tsx) and the Vite dev server (it proxies `/api`), then `test:e2e:ci`. The credentials are throwaway literals in the workflow env, because fork PRs get no secrets. The seed refuses any non-localhost database. The run stops after 10 failures and does not retry, so a broken run reports fast. On failure the traces, screenshots and server log are uploaded. Whether the job blocks merging is a branch-protection setting (required status checks), not part of the workflow.

## Visual snapshots

`components.visual.spec.ts` compares screenshots of the five components split in the 2026 refactor (ProfilePage, StoreLocationsSection, UserDetailPanel, MenuItemFormModal, IngredientCatalog) against baselines in `tests/e2e/visual-baselines/`, with a 1% pixel tolerance. It is its own Playwright project (`visual`), declared before `chromium` so it runs first on the seeded database. It runs only in CI, or locally with `E2E_VISUAL=1`: the baselines are drawn by the CI runner, and another machine renders text slightly differently, so a local run will show diffs that are not real.

To create or refresh a baseline:

1. Push the change. The CI `Browser E2E` job fails on the missing or changed screenshot and uploads `playwright-artifacts`.
2. `gh run download <run-id> -n playwright-artifacts`, then copy each `<name>-actual.png` from the failing test's folder under `tests/e2e/_artifacts/` to `tests/e2e/visual-baselines/components.visual.spec.ts/<name>.png`.
3. Open the images and check they show the right screen, not a spinner or an error, then commit them.

Dynamic content (dates, random keys) must be masked in the spec with `mask: [...]`, or the baseline will fail on the next run. The old `purchase-orders.screenshots.spec.ts` is a separate helper that writes reference PNGs to the gitignored `__snapshots__/`; it asserts nothing.

