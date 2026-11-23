#!/usr/bin/env bash
# The screenshot walk: photographs every phone screen and its main states on the phone, then again at iPad widths, and writes
# a gallery (index.html) next to the images. Run it through the lease, from the mobile folder:
#
#   bash device/lease.sh bash device/screens.sh [out-dir] [before-dir]    # default out-dir: device/_shots/screens
#
# It makes everything it needs and stops everything it started, by process group:
#   - per form factor, a fresh database `culinaire_screens` on the local test cluster (scripts/localIntegrationDb.sh, port 55432):
#     schema, roles, the E2E user (MFA) and a plain user with no organisation (first run). The CI throwaway credentials are the defaults;
#   - the API on SCREENS_API_PORT (default: a free port picked at start, so a server another worktree runs on 3009 is never in the way) against that database,
#     and Metro on SCREENS_METRO_PORT (default: a free port too; other worktrees leave Metro on 8088) with EXPO_PUBLIC_API_URL pointing at the API;
#   - `vitest run device/screens.device.test.ts` once per form factor (SCREENS_FORMS, default "phone tablet tablet-landscape"),
#     (SCREENS_TESTS="forgot|waste" runs only the tests whose names match), then `node device/gallery.mjs <out-dir> [before-dir]` (with a before-dir, changed images are shown next to their earlier version).
# Needs the development build installed (bash device/buildStamp.sh check) and the cluster's binaries (see localIntegrationDb.sh).
set -euo pipefail
cd "$(dirname "$0")/.."
[ "${CULINAIRE_DEVICE_LEASE:-}" = 1 ] || { echo "run me through the lease: bash device/lease.sh bash device/screens.sh" >&2; exit 2; }

OUT=$(realpath -m "${1:-device/_shots/screens}")
BEFORE=${2:-}
FORMS=${SCREENS_FORMS:-phone tablet tablet-landscape}
free_port() { node -e 'const s=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})'; }
PORT=${SCREENS_API_PORT:-$(free_port)}
METRO_PORT=${SCREENS_METRO_PORT:-$(free_port)}
ROOT=$(cd .. && pwd)
LOGS=$(mktemp -d)
DB=culinaire_screens
PSQL=(psql -h 127.0.0.1 -p 55432 -U ci -qAt)
ADB=${ADB:-${ANDROID_HOME:-$HOME/Android/Sdk}/platform-tools/adb}

export E2E_USER_EMAIL=${E2E_USER_EMAIL:-e2e-ci@culinaire.test}
export E2E_USER_PASSWORD=${E2E_USER_PASSWORD:-E2e-Ci-Throwaway-Pass-1!}
export E2E_USER_TOTP_SECRET=${E2E_USER_TOTP_SECRET:-JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP}
export E2E_DELETE_USER_EMAIL=${E2E_DELETE_USER_EMAIL:-e2e-delete-ci@culinaire.test}
export E2E_DELETE_USER_PASSWORD=${E2E_DELETE_USER_PASSWORD:-E2e-Delete-Throwaway-Pass-1!}
export E2E_API_URL=http://localhost:$PORT METRO_URL=http://localhost:$METRO_PORT

set -m # each background job gets its own process group, so `kill -- -<pid>` stops npx/pnpm and what they started, nothing else
server=""
metro=""
stop() {
  for p in $server $metro; do kill -- "-$p" 2>/dev/null || true; done
  # A walk that died halfway must not leave the shared phone at a tablet size or offline.
  "$ADB" shell wm size reset >/dev/null 2>&1 || true
  "$ADB" shell wm density reset >/dev/null 2>&1 || true
  "$ADB" shell cmd connectivity airplane-mode disable >/dev/null 2>&1 || true
  "$ADB" reverse --remove "tcp:$METRO_PORT" >/dev/null 2>&1 || true
  "$ADB" reverse --remove "tcp:$PORT" >/dev/null 2>&1 || true
  echo "logs: $LOGS"
}
trap stop EXIT

for p in "$PORT" "$METRO_PORT"; do
  if ss -ltn "sport = :$p" | grep -q LISTEN; then echo "port $p is in use; stop what holds it first (or set SCREENS_API_PORT / SCREENS_METRO_PORT)" >&2; exit 1; fi
done

"${PSQL[@]}" -d postgres -c "select 1" >/dev/null 2>&1 || bash "$ROOT/scripts/localIntegrationDb.sh" start
eval "$(bash "$ROOT/scripts/localIntegrationDb.sh" env)"
export PORT DATABASE_URL=postgresql://ci@127.0.0.1:55432/$DB DEV_DATABASE_URL=postgresql://ci@127.0.0.1:55432/$DB CLIENT_URL=http://localhost:5179
(cd "$ROOT" && pnpm --filter @culinaire/shared build >/dev/null)

EXPO_PUBLIC_API_URL=$E2E_API_URL npx expo start --dev-client --port "$METRO_PORT" >"$LOGS/metro.log" 2>&1 </dev/null &
metro=$!

fresh_server() {
  [ -z "$server" ] || { kill -- "-$server" 2>/dev/null || true; sleep 2; }
  "${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB"
  "${PSQL[@]}" -d $DB -c "create extension if not exists vector"
  (cd "$ROOT" && pnpm --filter @culinaire/server db:push >"$LOGS/push.log" 2>&1 && pnpm --filter @culinaire/server db:seed >"$LOGS/seed.log" 2>&1 \
    && pnpm --filter @culinaire/server exec tsx src/scripts/seedE2eCiData.ts)
  (cd "$ROOT" && exec pnpm --filter @culinaire/server exec tsx src/index.ts) >>"$LOGS/server.log" 2>&1 </dev/null &
  server=$!
  for _ in $(seq 1 90); do curl -sf "$E2E_API_URL/api/health" >/dev/null && break; sleep 2; done
  # A health answer from someone else's server on the same port is not ours: ours must still be running.
  { curl -sf "$E2E_API_URL/api/health" >/dev/null && kill -0 "$server" 2>/dev/null; } || { echo "the API did not come up"; tail -20 "$LOGS/server.log"; exit 1; }
}

for _ in $(seq 1 90); do curl -sf "$METRO_URL/status" >/dev/null && break; sleep 2; done
{ curl -sf "$METRO_URL/status" >/dev/null && kill -0 "$metro" 2>/dev/null; } || { echo "Metro did not come up"; tail -20 "$LOGS/metro.log"; exit 1; }

mkdir -p "$OUT"
rc=0
for form in $FORMS; do
  fresh_server
  filter=(); [ -z "${SCREENS_TESTS:-}" ] || filter=(-t "$SCREENS_TESTS")
  SCREENS_OUT=$OUT SCREENS_FORM=$form npx vitest run --config vitest.device.config.ts device/screens.device.test.ts "${filter[@]}" || rc=1
done
node device/gallery.mjs "$OUT" $BEFORE
exit $rc
