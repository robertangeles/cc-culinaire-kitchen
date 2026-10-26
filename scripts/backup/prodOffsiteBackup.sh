#!/usr/bin/env bash
# Encrypted offsite backup of the prod database: dump, check it restores, encrypt, upload, prune.
# Install: install -m 755 scripts/backup/prodOffsiteBackup.sh ~/.local/bin/ck-prod-backup
# Cron:    17 * * * * $HOME/.local/bin/ck-prod-backup   (hourly; does the work once per day, so a laptop
#          that was off at the usual time still backs up when it wakes)
# Restore: docs/architecture/offsite-backup.md
set -euo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin

ENV_FILE="$HOME/Documents/My AI Projects/cc-culinaire-kitchen/.env"
PASSPHRASE_FILE="$HOME/.config/ck-backup/passphrase"
REMOTE="googledrive:culinaire-offsite-backups/prod/daily"
KEEP_DAYS=30
STATE="$HOME/.local/state/ck-backup"

mkdir -p "$STATE"
exec 9>"$STATE/lock"
flock -n 9 || exit 0

today=$(date +%F)
[ "$(cat "$STATE/last_success" 2>/dev/null || true)" = "$today" ] && exit 0

log() { echo "$(date -Is) $*" >> "$STATE/backup.log"; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
trap 'log "FAILED at line $LINENO"' ERR

url=$(grep -m1 '^PROD_DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)
[ -n "$url" ] || { log "FAILED: PROD_DATABASE_URL missing from $ENV_FILE"; exit 1; }

name="prod-$(date +%Y%m%d-%H%M).dump"
nice -n 10 pg_dump "$url" -Fc --no-owner --no-privileges -f "$work/$name"
pg_restore -l "$work/$name" > /dev/null

gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" \
  --symmetric --cipher-algo AES256 --compress-algo none -o "$work/$name.gpg" "$work/$name"

rclone copyto "$work/$name.gpg" "$REMOTE/$name.gpg" --checksum >> "$STATE/backup.log" 2>&1
# Runs only after a successful upload, so the newest backup always survives the prune.
rclone delete "$REMOTE" --min-age "${KEEP_DAYS}d" >> "$STATE/backup.log" 2>&1

echo "$today" > "$STATE/last_success"
log "OK $name.gpg ($(stat -c%s "$work/$name.gpg") bytes)"
