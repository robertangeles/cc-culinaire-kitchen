#!/usr/bin/env bash
# Encrypted offsite backup of the prod (default) or dev database: dump, check it restores, encrypt, upload, prune.
# Install: install -m 755 scripts/backup/prodOffsiteBackup.sh ~/.local/bin/ck-prod-backup
# Cron:    17 * * * * $HOME/.local/bin/ck-prod-backup       (hourly; does the work once per day, so a laptop
#          that was off at the usual time still backs up when it wakes)
#          47 * * * * $HOME/.local/bin/ck-prod-backup dev   (the dev database, same way)
# Restore: docs/architecture/offsite-backup.md
set -euo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin

ENV_FILE="$HOME/Documents/My AI Projects/cc-culinaire-kitchen/.env"
PASSPHRASE_FILE="$HOME/.config/ck-backup/passphrase"
KEEP_DAYS=30
STATE="$HOME/.local/state/ck-backup"

# prod keeps the original state file names (the stale-backup check reads last_success).
TARGET="${1:-prod}"
case "$TARGET" in
  prod) URL_VAR=PROD_DATABASE_URL; SUFFIX="" ;;
  dev)  URL_VAR=DEV_DATABASE_URL;  SUFFIX="_dev" ;;
  *)    echo "usage: ck-prod-backup [prod|dev]" >&2; exit 2 ;;
esac
REMOTE="googledrive:culinaire-offsite-backups/$TARGET/daily"

mkdir -p "$STATE"
exec 9>"$STATE/lock$SUFFIX"
flock -n 9 || exit 0

today=$(date +%F)
[ "$(cat "$STATE/last_success$SUFFIX" 2>/dev/null || true)" = "$today" ] && exit 0

log() { echo "$(date -Is) $*" >> "$STATE/backup.log"; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
trap 'log "FAILED ($TARGET) at line $LINENO"' ERR

url=$(grep -m1 "^$URL_VAR=" "$ENV_FILE" | cut -d= -f2-)
[ -n "$url" ] || { log "FAILED: $URL_VAR missing from $ENV_FILE"; exit 1; }

name="$TARGET-$(date +%Y%m%d-%H%M).dump"
nice -n 10 pg_dump "$url" -Fc --no-owner --no-privileges -f "$work/$name"
pg_restore -l "$work/$name" > /dev/null

gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" \
  --symmetric --cipher-algo AES256 --compress-algo none -o "$work/$name.gpg" "$work/$name"

rclone copyto "$work/$name.gpg" "$REMOTE/$name.gpg" --checksum >> "$STATE/backup.log" 2>&1
# Runs only after a successful upload, so the newest backup always survives the prune.
rclone delete "$REMOTE" --min-age "${KEEP_DAYS}d" >> "$STATE/backup.log" 2>&1

echo "$today" > "$STATE/last_success$SUFFIX"
log "OK $TARGET $name.gpg ($(stat -c%s "$work/$name.gpg") bytes)"
