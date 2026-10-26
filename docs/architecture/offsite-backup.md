# Offsite database backup

A copy of the prod database that survives losing this laptop or the Render account. Render's own
point-in-time recovery covers about a week and lives in the same Render account, so it is not a
substitute.

## What runs

Once a day, `scripts/backup/prodOffsiteBackup.sh`:

1. `pg_dump` of prod (read-only), then `pg_restore --list` to prove the dump is readable.
2. Encrypts it with `gpg` (AES256, symmetric) using the passphrase file.
3. Uploads it to Google Drive: `culinaire-offsite-backups/prod/daily/`.
4. Deletes uploads older than 30 days. This runs only after a successful upload, so the newest one always stays.

Only the encrypted file leaves the machine.

| Piece | Where |
|---|---|
| Source of truth | `scripts/backup/prodOffsiteBackup.sh` |
| Installed copy (what cron runs) | `~/.local/bin/ck-prod-backup`. After editing the script, run `install -m 755 scripts/backup/prodOffsiteBackup.sh ~/.local/bin/ck-prod-backup` |
| Schedule | crontab: `17 * * * * $HOME/.local/bin/ck-prod-backup`. It fires hourly and does the work once a day, so a laptop that was off at the usual time backs up when it wakes |
| Passphrase | `~/.config/ck-backup/passphrase`. **Keep a copy in the password manager.** The file lives on the laptop being protected, and without the passphrase every backup is unreadable |
| Drive access | rclone remote `googledrive:` in `~/.config/rclone/rclone.conf` |
| Log and state | `~/.local/state/ck-backup/` (`backup.log`, `last_success`) |
| Older dumps | `culinaire-offsite-backups/prod/archive/`, uploaded once on 2026-10-26 from `~/culinaire-prod-backups` and `~/ck-prod-backups` |

## Is it working

```bash
cat ~/.local/state/ck-backup/last_success      # should be today's date, or yesterday's
tail -3 ~/.local/state/ck-backup/backup.log     # "OK prod-<stamp>.dump.gpg (<bytes>)" or "FAILED at line N"
rclone ls googledrive:culinaire-offsite-backups/prod/daily
```

A failed run does not retry until the next hour and tells nobody, so a stale `last_success` is the only
signal. Check it at the start of a session.

## Restore

Needs PostgreSQL 18 client tools and a target that has the `vector`, `citext`, `uuid-ossp` extensions.

```bash
rclone copy googledrive:culinaire-offsite-backups/prod/daily/<file>.dump.gpg .
gpg --batch --pinentry-mode loopback --passphrase-file ~/.config/ck-backup/passphrase \
    -o prod.dump -d <file>.dump.gpg            # on another machine: --passphrase '<from password manager>'
pg_restore --list prod.dump | head             # sanity check
createdb restore_check                         # restore to a scratch database first
pg_restore --no-owner --no-privileges -d restore_check prod.dump
```

Restoring over a live database is a deliberate act: add `--clean --if-exists`, and take a fresh dump first.

## Known limits

- The laptop must be on and online at some point each day.
- rclone's shared Google client ID is being retired during 2026. When uploads start failing with an auth
  error, create your own client ID (<https://rclone.org/drive/#making-your-own-client-id>), put it in the
  `googledrive` remote, and run `rclone config reconnect googledrive:`.
- Backups are only as private as the passphrase. Changing it makes older files unreadable with the new one,
  so keep the old one with them.
