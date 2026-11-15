#!/usr/bin/env bash
# Warns when the daily prod backup has not succeeded for 2+ days (laptop off, rclone login expired,
# disk full...). prodOffsiteBackup.sh cannot report its own absence, so this runs separately.
# Install: install -m 755 scripts/backup/checkBackupFresh.sh ~/.local/bin/ck-backup-check
# Cron:    37 * * * * $HOME/.local/bin/ck-backup-check   (desktop notification, at most once a day)
# Check by hand: STATE=/tmp/x ck-backup-check   (a STATE with no last_success counts as stale)
set -euo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin

STATE="${STATE:-$HOME/.local/state/ck-backup}"
STALE_DAYS=2

mkdir -p "$STATE"
last=$(cat "$STATE/last_success" 2>/dev/null || echo "never")
if [ "$last" != "never" ]; then
  age_days=$(( ( $(date +%s) - $(date -d "$last" +%s) ) / 86400 ))
  [ "$age_days" -lt "$STALE_DAYS" ] && exit 0
fi

today=$(date +%F)
[ "$(cat "$STATE/last_alert" 2>/dev/null || true)" = "$today" ] && exit 0

msg="Prod offsite backup last succeeded: $last. See $STATE/backup.log"
echo "$(date -Is) ALERT $msg" >> "$STATE/backup.log"
# Cron has no desktop session, so point notify-send at the user's bus.
DISPLAY="${DISPLAY:-:0}" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus" \
  notify-send -u critical "CulinAIre backup is stale" "$msg" || true
echo "$today" > "$STATE/last_alert"
echo "$msg"
