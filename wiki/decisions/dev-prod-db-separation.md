---
title: Dev/prod database separation
category: decision
created: 2026-06-16
updated: 2026-06-16
related: [[schema-drift-may-2026]], [[technical-architecture]], [[ci-pipeline]]
---

Local development now runs against a local Postgres (`culinaire_kitchen_dev`), seeded from a sanitized prod snapshot; production stays on Render. A boot guard makes "dev accidentally connects to prod" impossible.

## Problem

The repo had a single `DATABASE_URL` that pointed at the **production** Render Postgres (`dpg-…singapore-postgres.render.com`). The local dev server and prod read/write the same live database, so a stray `db:seed`, `db:push`, test write, or destructive query from a laptop hit real customer data.

## Decision

- **Local dev → local Postgres.** Root `.env` `DATABASE_URL` points at `postgresql://archos_dev@127.0.0.1:5432/culinaire_kitchen_dev`. Prod reads `DATABASE_URL` from the Render dashboard (the repo `.env` is gitignored and never deployed), so repointing local does not touch prod.
- **Local data = sanitized prod snapshot.** `pg_dump` prod (read-only) → `pg_restore` into local → run [sanitize-local.sql](../../packages/server/scripts/sanitize-local.sql). The script nulls/fakes all PII (emails → `dev<id>@local.test`, addresses, socials, phone), clears encrypted PII triplets, and deletes secret/token tables (`credential`, `refresh_token`, `password_reset`, `email_verification`, `device_token`, `guest_session`). Every user gets the same dev password (`DevPassword123!`); the lowest `user_id` becomes `admin@local.test`.
- **Fresh local encryption keys.** `CREDENTIALS_ENCRYPTION_KEY`, `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY` are regenerated locally — prod keys never land on a dev laptop. Login still works because `authService.login()` matches on plaintext `user_email` (fallback) and bcrypt `user_password_hash`, neither of which depends on the keys.
- **Boot guard.** `getDb()` in [db/index.ts](../../packages/server/src/db/index.ts) throws if `NODE_ENV !== "production"` and the `DATABASE_URL` host is not local (`localhost`/`127.0.0.1`/`::1`). Render sets `NODE_ENV=production`; local dev does not. Set `NODE_ENV=production` to intentionally target a remote DB.
- **Prod URL for deliberate prod work.** The prod connection string lives in `.env.production.local` (gitignored). Targeted tsx migration/fix scripts read `DATABASE_URL` from root `.env` (now local), so they hit local by default; load `.env.production.local` explicitly to target prod.

## Rejected: drizzle-kit versioned migrations (for now)

The original intent included adopting `drizzle-kit generate`/`migrate` with a baseline of the existing schema. A drift check (baseline `0000` from `schema.ts` vs a fresh prod snapshot) confirmed the catalog in [[schema-drift-may-2026]] and surfaced more (DB functions/triggers, `citext`/`uuid-ossp`, code-only indexes, `_fkey` vs verbose constraint names). A drizzle baseline cannot faithfully represent the live DB until that drift is reconciled to zero, and `drizzle-kit push`/diff still aborts on `pg_stat_statements_info`. **Decision: keep the existing targeted-tsx-script workflow; do not introduce drizzle-kit migrations until the drift is reconciled.** That reconciliation is a separate, deliberate project.

## Follow-ups

- **Render deploy command** still runs `drizzle-kit push` via `db:deploy` (dashboard-configured, not in repo). Given the documented `push` foot-guns, this should be revisited — but separately, with knowledge of the exact Render build command.
- **CI** runs no DB. A future uplift could run schema setup against a throwaway Postgres service container per-PR.
- The drift reconciliation project (prerequisite for real migrations) is tracked in [[schema-drift-may-2026]].
