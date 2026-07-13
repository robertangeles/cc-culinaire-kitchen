---
title: Database Backup Location — one canonical folder on every machine
category: decision
created: 2026-07-14
updated: 2026-07-14
related: [[dev-prod-db-separation]], [[single-env-file]], [[lessons-index]], [[tenant-isolation-remediation]]
---

Every database backup (pg_dump) goes in **one** home-relative folder — `~/culinaire-prod-backups/` — on every machine, so backups are never scattered and are always findable by the next session.

## The rule (for any agent or human taking a DB backup)
**Canonical folder: `~/culinaire-prod-backups/`** — always. Do not invent a per-task or per-repo path; do not use `/tmp`, the session scratchpad, or a folder inside a git repo.

Why home-relative (`~`): `$HOME`-based paths resolve to the same location on every machine and user account we work from, so the convention is identical everywhere. A repo-relative or absolute path would drift per machine.

## Rules
1. **Location:** `~/culinaire-prod-backups/` and nowhere else. Create it if absent (`mkdir -p ~/culinaire-prod-backups`).
2. **Never inside a git repo, never committed.** Backups contain production PII and business data. The folder lives outside every repo by design.
3. **Naming:** `culinaire_<env>_<scope>_<YYYY-MM-DD_HHMMSS>.dump`
   - `<env>` = `prod` | `dev`
   - `<scope>` = `full` | a table name (for a targeted backup)
   - example: `culinaire_prod_full_2026-07-14_094717.dump`
4. **Format:** custom/compressed, portable —
   `pg_dump "$PROD_DATABASE_URL" -Fc --no-owner --no-privileges -f ~/culinaire-prod-backups/<name>.dump`
5. **Verify every backup** (a file existing is not proof it's complete):
   `pg_restore --list <file>` must succeed and list the tables. Record the size + object/table count.
6. **Retention:** these are point-in-time safety nets, not an archive. Keep a dump until the change it protects is verified good; prune old ones periodically so the folder doesn't grow forever.

## Restore
```
pg_restore --clean --if-exists --no-owner -d "<target DATABASE_URL>" <file>
```
Restore to a *scratch* database first when validating a dump; only `--clean` a live target deliberately.

## Why this exists
The mandatory "backup before any destructive/irreversible prod op" rule (lesson #63, auto-memory `feedback_backup-before-destructive-prod`) is only useful if the next session can *find* the backup. Without a fixed location, dumps land in `/tmp`, scratchpads, or random repo folders and are lost or committed by accident. One canonical home-relative folder makes backups consistent across machines and safe from version control. First dump under this rule: the full prod snapshot taken 2026-07-14 before the pending sample-catalog cleanup ([[tenant-isolation-remediation]] follow-up).
