---
title: Single .env file with DEV_/PROD_ prefixes
category: decision
created: 2026-06-17
updated: 2026-06-19
related: [[dev-prod-db-separation]], [[technical-architecture]]
---

One `.env` at the repo root holds every secret for every environment, with `DEV_` / `PROD_` prefixes on keys that differ between environments. A bootstrap shim copies the active set into the unprefixed slot the application code already reads. Render's prod environment supplies unprefixed vars from its dashboard, so the shim is a no-op there.

## Problem

The repo accumulated multiple env files:
- `.env` (server runtime, gitignored)
- `.env.production.local` (gitignored, holding the prod `DATABASE_URL` for ad-hoc scripts)
- `.env.example` (committed template)
- `packages/client/.env.test` + `.env.test.example` (E2E credentials)

Five files for ~10 vars, all serving a single operator. Cognitive overhead with no payoff: forgetting which file held which value is what caused the prod-data-on-laptop debugging spiral on 2026-06-17.

## Decision

- **One `.env` at repo root.** Every key, every environment, one file.
- **Prefix convention.** Keys that differ per environment are duplicated as `DEV_<KEY>` and `PROD_<KEY>` (e.g. `DEV_DATABASE_URL`, `PROD_DATABASE_URL`, `DEV_JWT_ACCESS_SECRET`, `PROD_JWT_ACCESS_SECRET`). Keys that don't differ (`PORT`, `BCRYPT_ROUNDS`) stay unprefixed.
- **`APP_ENV` switch.** Top of the file declares `APP_ENV=dev` (or `prod`). The shim in [`packages/server/src/utils/envShim.ts`](../../packages/server/src/utils/envShim.ts) reads `APP_ENV` immediately after `dotenv.config()` and copies every `<APP_ENV>_<KEY>` into `<KEY>`.
- **Consumer code unchanged.** Services keep reading `process.env.DATABASE_URL`, etc. The shim is the only place the prefix exists.
- **Render is unaffected.** Render's dashboard injects unprefixed env vars; the shim only writes if the prefixed variant is non-empty, so it's a no-op in prod.
- **Boot guard updated.** `db/index.ts` `assertNotRemoteInDev` now treats `APP_ENV=prod` as the local opt-in to talk to the prod DB (in addition to the existing `NODE_ENV=production` Render path).
- **Scripts and seeds call the shim.** Every standalone tsx script that calls `dotenv.config()` (`db/seed.ts`, `scripts/inspectSitePages.ts`, `scripts/addSitePageSurface.ts`, `scripts/removeAntoineMobilePrompts.ts`) also calls `applyEnvPrefix()` immediately after.
- **Playwright reads root `.env`.** `packages/client/playwright.config.ts` loads `../../.env` for `E2E_USER_EMAIL` / `E2E_USER_PASSWORD`. The client-side `.env.test` files are deleted.
- **No `.env.example`.** This is a solo-operator codebase; a template that drifts from the real file is worse than no template.

## Limits

- **JWT secrets are captured at module-load time** in `authService.ts` (`ACCESS_SECRET` :35, `REFRESH_SECRET` :36, `MFA_SESSION_SECRET` :39 — e.g. `const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "dev-access-secret"`). ESM evaluates imported modules depth-first before the importing module's body, so this read happens before `dotenv.config()` + `applyEnvPrefix()` run in `index.ts` — meaning the `DEV_*` JWT values are NOT actually used in local dev; the fallback `"dev-access-secret"` is. Login works because sign and verify both use the same fallback. **Empirically confirmed 2026-06-19** (during the supplier read-gating fix): a JWT hand-signed with the literal `"dev-access-secret"` was accepted by the running dev server (HTTP 200), while one signed with the real `DEV_JWT_ACCESS_SECRET` was rejected (`401 invalid signature`). The eager `CLIENT_URL` export in `utils/env.ts:9` is the same class but cosmetic (its default equals the dev value). **Prod is unaffected** — Render injects unprefixed `JWT_ACCESS_SECRET` into the environment before node starts, so the module-load read captures the real prod value there. This was a pre-existing latent bug, not introduced by this change. **FIXED 2026-06-19** (branch `fix/ck-web/jwt-secret-module-load`): `ACCESS_SECRET` / `MFA_SESSION_SECRET` are now call-time getters (`accessSecret()` / `mfaSessionSecret()`), and the dead `REFRESH_SECRET` const was removed. Post-fix the dev server uses the real `DEV_JWT_ACCESS_SECRET` (verified: real-secret token → 200, old fallback → 401); regression locked by `authService.test.ts`. Applying it invalidated dev tokens signed with the old fallback once (re-login). The eager `CLIENT_URL` export in `utils/env.ts:9` remains (same class, cosmetic — its default equals the dev value); left as-is. See lessons.md #53 (reaffirms lesson #3).
- **`DATABASE_URL`, PII keys, credentials key** are read at call-time (or via `ensurePiiKeys` / `ensureEncryptionKey` at startup, which run AFTER `dotenv.config()` in the body of `index.ts`). These pick up the shim's writes correctly.

## Alternative considered

**Two files: dev + prod.** Rejected — same drift risk as today, just renamed. The shim approach gives the same separation with one file and zero new abstractions.

**`env-cmd` or similar wrapper to swap files.** Rejected — adds a dependency and a build-time concern for a runtime decision. The shim is 20 lines of code with no deps.
