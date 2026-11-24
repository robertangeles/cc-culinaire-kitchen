#!/usr/bin/env bash
# Device lease: runs "$@" while holding an exclusive lock, so only one worker at a time drives the phone.
# Usage: bash device/lease.sh <command...>   (use `pnpm --filter @culinaire/mobile run check:device`)
#
# The lease covers the adb device (the real phone, serial ZY32MB62DD) AND the fixed ports the scripts use (Metro 8088,
# API 3009, local DB 55432). Everything else runs in a worktree and needs no lease. The tablet emulator has its own lease,
# adb server, serial and ports: `eval "$(bash device/emulator.sh env)"` points this script and adb at it.
# Linux only: it needs util-linux `flock`. The lock is per machine, at a fixed path.
#
# DEVICE_LEASE_FILE   lock path (default ${XDG_RUNTIME_DIR:-/tmp}/culinaire-device.lease); tests override it
# DEVICE_LEASE_WAIT_S seconds to wait for the lock (default 900); exits 75 when it runs out
# The holder (worktree, pid, command, start time) is written to <lock>.holder and shown to anyone waiting.
# The command gets CULINAIRE_DEVICE_LEASE=1 (device/adb.ts refuses to run without it) and its exit code is kept.
set -u

LOCK=${DEVICE_LEASE_FILE:-${XDG_RUNTIME_DIR:-/tmp}/culinaire-device.lease}
WAIT=${DEVICE_LEASE_WAIT_S:-900}
HOLDER=$LOCK.holder

[ $# -gt 0 ] || { echo "usage: lease.sh <command...>" >&2; exit 2; }
command -v flock >/dev/null || { echo "device lease needs util-linux flock (Linux only)" >&2; exit 2; }

exec 9>"$LOCK"
# Signals are forwarded to whatever we are waiting on, then the script ends normally so the trap below releases the lease.
pid=0
trap 'kill "$pid" 2>/dev/null' INT TERM

if ! flock -n 9; then
  echo "device lease busy, held by: $(cat "$HOLDER" 2>/dev/null || echo unknown); waiting up to ${WAIT}s" >&2
  flock -E 75 -w "$WAIT" 9 & pid=$!
  wait "$pid"; rc=$?
  if [ "$rc" -ne 0 ]; then
    [ "$rc" -eq 75 ] && echo "device lease: gave up after ${WAIT}s" >&2
    exit "$rc"
  fi
fi

trap 'rm -f "$HOLDER"' EXIT
echo "worktree=$PWD pid=$$ cmd=$* since=$(date -Iseconds)" >"$HOLDER"

# fd 9 is closed for the command so a stray background process it leaves behind cannot keep the lease.
CULINAIRE_DEVICE_LEASE=1 "$@" 9>&- <&0 & pid=$!
wait "$pid"; rc=$?
# A forwarded signal ends the first wait early: wait again for the real exit status.
while kill -0 "$pid" 2>/dev/null; do wait "$pid"; rc=$?; done
exit "$rc"
