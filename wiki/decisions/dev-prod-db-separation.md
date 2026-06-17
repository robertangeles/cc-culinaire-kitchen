---
title: Dev/prod database separation
category: decision
created: 2026-06-16
updated: 2026-06-17
related: [[schema-drift-may-2026]], [[technical-architecture]], [[ci-pipeline]], [[single-env-file]]
---

Local development runs against a local Postgres (`culinaire_kitchen_dev`); production stays on Render. A boot guard makes "dev accidentally connects to prod" impossible. Env vars for both environments live in a single `.env` with `DEV_*` / `PROD_*` prefixes, switched at runtime by `APP_ENV`.

## Problem

The repo had a single `DATABASE_URL` that pointed at the **production** Render Postgres (`dpg-…singapore-postgres.render.com`). The local dev server and prod read/write the same live database, so a stray `db:seed`, `db:push`, test write, or destructive query from a laptop hit real customer data.

## Decision (current)

- **Single `.env` at repo root.** Holds `DEV_*` and `PROD_*` prefixed variants of every env-specific key (`DATABASE_URL`, `CLIENT_URL`, JWT secrets, encryption keys). The shim in [`packages/server/src/utils/envShim.ts`](../../packages/server/src/utils/envShim.ts) runs immediately after `dotenv.config()` and copies the active set (per `APP_ENV`) into the unprefixed slot the rest of the code reads. Render's prod environment supplies unprefixed vars from its dashboard, so the shim is a no-op there. See [[single-env-file]] for full rationale.
- **`APP_ENV` switch.** Defaults to `dev`. Set `APP_ENV=prod` locally to deliberately target prod (DB, encryption keys, JWT secrets, client URL all flip together).
- **Local dev → local Postgres.** `DEV_DATABASE_URL=postgresql://archos_dev@127.0.0.1:5432/culinaire_kitchen_dev`. Prod reads `DATABASE_URL` from the Render dashboard (this repo's `.env` is gitignored and never deployed).
- **Local data = full prod restore (current state).** `pg_dump` prod → `pg_restore` into local, **without** running `sanitize-local.sql`. Real emails, real password hashes, real PII. This trades privacy posture for fidelity and exists because the operator chose to override the sanitize step. To return to the sanitized model, re-dump and re-run the script.
- **Encryption keys mirror prod (current state).** `DEV_CREDENTIALS_ENCRYPTION_KEY`, `DEV_PII_ENCRYPTION_KEY`, `DEV_PII_HMAC_KEY` hold the prod values so the restored ciphertext decrypts locally. If the local DB is ever re-sanitized, regenerate these.
- **Boot guard.** `getDb()` in [db/index.ts](../../packages/server/src/db/index.ts) throws if `APP_ENV !== "prod"` and `NODE_ENV !== "production"` and the resolved `DATABASE_URL` host is not local (`localhost`/`127.0.0.1`/`::1`). Render sets `NODE_ENV=production`; local opts in with `APP_ENV=prod`.

## What changed (2026-06-17)

- **`.env.production.local` deleted.** Its single value (prod `DATABASE_URL`) is now `PROD_DATABASE_URL` in the single root `.env`.
- **`.env.example` deleted.** One file, no template needed for a solo operator.
- **`packages/client/.env.test` deleted.** E2E vars moved to root `.env`; Playwright config now loads from `../../.env`.
- **Sanitization skipped.** The local DB now mirrors prod data + prod encryption keys, contradicting the original "no prod PII on dev laptop" stance. This was an explicit operator override, not a policy change — re-sanitize whenever you want the original posture back.

## Rejected: drizzle-kit versioned migrations (for now)

The original intent included adopting `drizzle-kit generate`/`migrate` with a baseline of the existing schema. A drift check (baseline `0000` from `schema.ts` vs a fresh prod snapshot) confirmed the catalog in [[schema-drift-may-2026]] and surfaced more (DB functions/triggers, `citext`/`uuid-ossp`, code-only indexes, `_fkey` vs verbose constraint names). A drizzle baseline cannot faithfully represent the live DB until that drift is reconciled to zero, and `drizzle-kit push`/diff still aborts on `pg_stat_statements_info`. **Decision: keep the existing targeted-tsx-script workflow; do not introduce drizzle-kit migrations until the drift is reconciled.** That reconciliation is a separate, deliberate project.

## Follow-ups

- **Render deploy command** still runs `drizzle-kit push` via `db:deploy` (dashboard-configured, not in repo). Given the documented `push` foot-guns, this should be revisited — but separately, with knowledge of the exact Render build command.
- **CI** runs no DB. A future uplift could run schema setup against a throwaway Postgres service container per-PR.
- The drift reconciliation project (prerequisite for real migrations) is tracked in [[schema-drift-may-2026]].
