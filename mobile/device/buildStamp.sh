#!/usr/bin/env bash
# Tells a worker whether the development build on the phone is older than the native side of this checkout.
#   bash device/buildStamp.sh check   exit 0 = current; exit 1 = rebuild (README, "Rebuild and install")
#   bash device/buildStamp.sh stamp   record this checkout's fingerprint; run right after a successful install
# The fingerprint (@expo/fingerprint) hashes what ends up in the native app: native dependencies, app.json/app.config.ts,
# icons, plugins. JavaScript-only changes do not move it, because Metro serves those to the installed build.
# The stamp is per machine (one shared phone), outside the worktree: ${CULINAIRE_BUILD_STAMP:-~/.cache/culinaire-dev-build/android.fingerprint}
set -eu
cd "$(dirname "$0")/.."
STAMP=${CULINAIRE_BUILD_STAMP:-$HOME/.cache/culinaire-dev-build/android.fingerprint}
now=$(node ../node_modules/@expo/fingerprint/bin/cli.js . | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).hash))')

case "${1:-check}" in
  stamp) mkdir -p "$(dirname "$STAMP")"; echo "$now $(git rev-parse --short HEAD) $(date -Iseconds)" >"$STAMP"; echo "stamped $now" ;;
  check)
    built=$(cut -d' ' -f1 "$STAMP" 2>/dev/null || true)
    if [ -z "$built" ]; then echo "STALE: no build recorded on this machine ($STAMP). Rebuild and install: see device/README.md" >&2; exit 1; fi
    if [ "$built" != "$now" ]; then echo "STALE: the phone's build ($(cut -d' ' -f2- "$STAMP")) predates this checkout's native dependencies or config. Rebuild and install: see device/README.md" >&2; exit 1; fi
    echo "current: the installed build matches this checkout's native side" ;;
  *) echo "usage: buildStamp.sh [check|stamp]" >&2; exit 2 ;;
esac
