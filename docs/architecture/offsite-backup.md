# Offsite database backup

A copy of the prod database that survives losing this laptop or the Render account. Render's own
point-in-time recovery covers about a week and lives in the same Render account, so it is not a
substitute.

## What runs

Once a day, `scripts/backup/prodOffsiteBackup.sh`:

1. `pg_dump` of prod (read-only), then `pg_restore --list` to prove the dump is readable.
2. Encrypts it with `gpg` (AES256, symmetric) using the passphrase file.
3. Uploads it as a release (tag `prod-<stamp>`) in the private GitHub repo `robertangeles/culinaire-offsite-backups`, then checks GitHub stored every byte.
4. Deletes releases older than 30 days. This runs only after a verified upload, so the newest one always stays.

GitHub is a temporary home, chosen on 2026-11-15 over fixing the Google Drive login. A proper backup store is to replace it.

Only the encrypted file leaves the machine.

The dev database is backed up the same way with `ck-prod-backup dev` (cron `47 * * * *`): same script, same
passphrase, tag `dev-<stamp>` in the same repo, state in `last_success_dev` and `lock_dev`. The stale-backup
alert watches prod only. A dev run takes about 30 minutes from this laptop (the dump runs over the network to Render,
then 65 MB uploads); `flock` stops overlapping runs.

The dev brain (the gbrain database `culinaire_dev_brain` on the HERMES home server) is backed up with
`ck-prod-backup brain` (cron `57 * * * *`): same script, passphrase and repo, tag `brain-<stamp>`, state in
`last_success_brain`. It reads `DEV_BRAIN_DATABASE_URL` from `.env` (host `localhost:5433`, the SSH tunnel to HERMES)
and opens that tunnel itself for the length of the run, so `ssh hermes` must work without a password. The dump
skips the empty `age` extension that HERMES needs as a workaround. A run takes about 10 seconds (2 MB). The
stale-backup alert does not watch it: check `last_success_brain` yourself. Restore to a scratch database that has
`vector`, `pg_trgm` and `pgcrypto`, as a superuser (the dump carries an event trigger); tested 2026-11-16: 78 pages,
477 chunks, 82 links back.

| Piece | Where |
|---|---|
| Source of truth | `scripts/backup/prodOffsiteBackup.sh` |
| Installed copy (what cron runs) | `~/.local/bin/ck-prod-backup`. After editing the script, run `install -m 755 scripts/backup/prodOffsiteBackup.sh ~/.local/bin/ck-prod-backup` |
| Schedule | crontab: `17 * * * * $HOME/.local/bin/ck-prod-backup`. It fires hourly and does the work once a day, so a laptop that was off at the usual time backs up when it wakes |
| Passphrase | `~/.config/ck-backup/passphrase`. **Keep a copy in the password manager.** The file lives on the laptop being protected, and without the passphrase every backup is unreadable |
| GitHub access | the `gh` login on this laptop (scope `repo`). Upload and prune fail if it is signed out |
| Log and state | `~/.local/state/ck-backup/` (`backup.log`, `last_success`) |
| Older dumps | Google Drive, `culinaire-offsite-backups/prod/archive/` and the `prod/daily/` and `dev/daily/` files up to 2026-11-15. Nothing prunes those any more; delete them by hand once the new store is trusted. Uploaded once on 2026-10-26 from `~/culinaire-prod-backups` and `~/ck-prod-backups` (since merged into the first) |

## Is it working

```bash
cat ~/.local/state/ck-backup/last_success      # should be today's date, or yesterday's
tail -3 ~/.local/state/ck-backup/backup.log     # "OK prod-<stamp>.dump.gpg (<bytes>)" or "FAILED at line N"
gh release list --repo robertangeles/culinaire-offsite-backups --limit 5
```

A failed run retries at the next hourly cron tick. If `last_success` is 2 or more days old, a second job
(`scripts/backup/checkBackupFresh.sh`, installed as `~/.local/bin/ck-backup-check`, cron `37 * * * *`) shows a
critical desktop notification and writes an `ALERT` line to `backup.log`, at most once a day. It cannot fire
while the laptop is off, so also check `last_success` at the start of a session.

## Restore

Needs PostgreSQL 18 client tools and a target that has the `vector`, `citext`, `uuid-ossp` extensions.

```bash
gh release download <tag> --repo robertangeles/culinaire-offsite-backups -p '*.gpg'   # for pre-2026-11-15 dumps: rclone copy from Drive
gpg --batch --pinentry-mode loopback --passphrase-file ~/.config/ck-backup/passphrase \
    -o prod.dump -d <file>.dump.gpg            # on another machine: --passphrase '<from password manager>'
pg_restore --list prod.dump | head             # sanity check
createdb restore_check                         # restore to a scratch database first
pg_restore --no-owner --no-privileges -d restore_check prod.dump
```

Restoring over a live database is a deliberate act: add `--clean --if-exists`, and take a fresh dump first.

## Known limits

- The laptop must be on and online at some point each day.
- The backups share one GitHub account with the code. They are encrypted, so a stolen login does not expose
  them, but it could delete them. GitHub Releases are meant for software, not data backups, which is why this is
  temporary.
- Backups are only as private as the passphrase. Changing it makes older files unreadable with the new one,
  so keep the old one with them.
