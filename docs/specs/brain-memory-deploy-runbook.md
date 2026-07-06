# The Brain — Phase 1 Prod Deploy Runbook

Run the prod-DB prerequisites **before** merging PR #41. Merging `main` triggers
a Render deploy; the `brain_memory` table + `brain:*` perms must exist first, or
`/api/brain/*` routes 500 when an admin opens "Your Brain".

All three scripts are **idempotent + additive** — safe to re-run, zero-downtime,
no data migration. The whole feature ships behind flags seeded **OFF**, so nothing
activates on deploy until you explicitly flip `brain_enabled`.

**Targeting prod:** every command below is prefixed with `APP_ENV=prod`. That one
switch (a) makes the env shim use `PROD_DATABASE_URL` and (b) satisfies the
`db/index.ts` "no remote DB from a dev process" guard. Without it these refuse to
touch prod. Run from the **repo root**.

---

## 0. Pre-flight (confirm, don't change)

```bash
cd "<repo root>"
# Confirm the prod URL is present (value stays hidden):
grep -q '^PROD_DATABASE_URL=' .env && echo "PROD_DATABASE_URL: set" || echo "MISSING — stop"
# Confirm prod has pgvector (knowledge base already uses it — should print 'vector'):
PROD_URL=$(grep '^PROD_DATABASE_URL' .env | cut -d= -f2-)
psql "$PROD_URL" -c "SELECT extname FROM pg_extension WHERE extname='vector';"
```
Expected: `PROD_DATABASE_URL: set` and one row `vector`. If pgvector is missing, **stop** and install it first (`CREATE EXTENSION vector;` as a superuser).

---

## 1. Create the `brain_memory` table (DDL)

```bash
APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/createBrainMemoryTable.ts
```
Expected: `brain_memory table + indexes ensured (additive, idempotent). NO ANN index by design (spec E3).`

## 2. Seed permissions + flags

```bash
APP_ENV=prod pnpm --filter @culinaire/server db:seed
```
Expected: a mix of `already exists, skipping` (prompts/roles/guides prod already has) plus new `Inserted permission: brain:read` / `brain:manage` and `Inserted setting: brain_*`. Idempotent — only adds what's missing.

## 3. Backfill Brain perms to every existing role

```bash
APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/backfillBrainPermissions.ts
```
Expected: `Brain backfill complete: N roles checked, M new role→permission links added.` Grants `brain:read`/`brain:manage` to ALL roles (incl. custom prod roles) so no captured-memory user is ever locked out of their own consent surface (spec D8).

---

## 4. Verify prod DB state

```bash
PROD_URL=$(grep '^PROD_DATABASE_URL' .env | cut -d= -f2-)
# Table + indexes (expect pkey + source_unique + user_scope + status, NO vector index):
psql "$PROD_URL" -c "\d brain_memory" | grep -E 'Table|Indexes|idx_brain' 
# Flags — ALL must read false:
psql "$PROD_URL" -c "SELECT setting_key,setting_value FROM site_setting WHERE setting_key LIKE 'brain_%' ORDER BY setting_key;"
# Perms present:
psql "$PROD_URL" -c "SELECT permission_key FROM permission WHERE permission_key LIKE 'brain:%';"
```
Gate: table exists with the 3 indexes (no ANN), `brain_enabled/capture/recall/nudges/distillation_enabled` all `false`, both perms present. If any flag is `true`, set it back: `UPDATE site_setting SET setting_value='false' WHERE setting_key='brain_<x>';`

---

## 5. Merge PR #41 → deploy

Once §4 passes, tell me "merge" (or run it yourself):
```bash
gh pr merge 41 --merge   # --no-ff style; CI already green
```
Render auto-deploys `main`. Because flags are OFF, the deploy is inert — capture/recall don't run, the worker is idle.

## 6. Post-deploy smoke (feature still OFF)

```bash
# As an admin token — must be 200 (empty), NOT 500. 500 = table/DDL problem.
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer <PROD_ADMIN_JWT>" https://<prod-host>/api/brain/memories
```
Expected `200` with `{"memories":[],"total":0}`. A `500` means the table didn't get created — re-run §1.

---

## 7. Activation (LATER — only when you're ready to turn it on)

Flip flags in this order via the admin Settings API (or Settings UI), verifying between each. Rollback at any point = set the flag back to `false` (instant, no deploy).

1. `brain_enabled = true` + `brain_capture_enabled = true` — corpus starts warming (chat turns captured + embedded). Watch logs for `brain.capture.recorded` / `brain.worker.tick`.
2. **Wire the capture-error alert** (Phase-1 exit criterion): confirm a log alert keys on `alert:"brain_capture_error"` before relying on capture — a 100%-broken capture must page, not look healthy.
3. `brain_distillation_enabled = true` — turns on the Balanced noise filter (drops retrieval questions). Optional but recommended for a clean "Your Brain".
4. `brain_recall_enabled = true` — answers start grounding; the "grounded in your Brain" chip appears.

Confirm before enabling recall: the active `systemPrompt` still contains `{{KITCHEN_CONTEXT}}` (lessons #55) — else the block is appended to the prompt end (still works, just verify).

---

## Rollback

- **Feature:** any `brain_*enabled` flag → `false` (instant, no deploy).
- **Code:** `git revert` the merge; the additive table can stay (harmless, empty).
- **Table:** only drop if you truly want it gone — `DROP TABLE brain_memory;` (loses all captured memories).
