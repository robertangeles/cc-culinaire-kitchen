#!/usr/bin/env bash
# The store room walk: photographs the Transfers and Stock screens on the phone and at iPad width, then runs the store room
# end-to-end test (e2e/storeRoom.e2e.test.ts) against the same API. Run it through the lease, from the mobile folder:
#
#   bash device/lease.sh bash device/storeRoom.sh [out-dir]    # default out-dir: device/_shots/storeRoom
#
# Per form factor ("phone", then "tablet") it makes a fresh database (STOREROOM_DB, default `culinaire_storeroom`) on the local test cluster
# (scripts/localIntegrationDb.sh, port 55432; schema, roles and the E2E user with the CI's throwaway credentials), starts the API on a
# free port against it, and runs device/storeRoom.device.test.ts. Metro runs once, on a free port. Everything it started is stopped by
# process group; the phone's display size and density are reset. STOREROOM_FORMS ("phone tablet") and STOREROOM_TESTS (a test-name filter) narrow a rerun. Needs the development build installed (bash device/buildStamp.sh check).
set -euo pipefail
cd "$(dirname "$0")/.."
[ "${CULINAIRE_DEVICE_LEASE:-}" = 1 ] || { echo "run me through the lease: bash device/lease.sh bash device/storeRoom.sh" >&2; exit 2; }

OUT=$(realpath -m "${1:-device/_shots/storeRoom}")
free_port() { node -e 'const s=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})'; }
PORT=$(free_port)
METRO_PORT=$(free_port)
ROOT=$(cd .. && pwd)
LOGS=$(mktemp -d)
DB=${STOREROOM_DB:-culinaire_storeroom}
APP_HOST=${DEVICE_HOST_IP:-127.0.0.1} # 10.0.2.2 on the emulator (device/emulator.sh env sets it)
PSQL=(psql -h 127.0.0.1 -p 55432 -U ci -qAt)
ADB=${ADB:-${ANDROID_HOME:-$HOME/android-sdk}/platform-tools/adb}
# The moto g86 (device/README.md): an emulator another lane left running must not make every adb call ambiguous.
export ANDROID_SERIAL=${ANDROID_SERIAL:-ZY32MB62DD}

export E2E_USER_EMAIL=${E2E_USER_EMAIL:-e2e-ci@culinaire.test}
export E2E_USER_PASSWORD=${E2E_USER_PASSWORD:-E2e-Ci-Throwaway-Pass-1!}
export E2E_USER_TOTP_SECRET=${E2E_USER_TOTP_SECRET:-JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP}
export E2E_DELETE_USER_EMAIL=${E2E_DELETE_USER_EMAIL:-e2e-delete-ci@culinaire.test}
export E2E_DELETE_USER_PASSWORD=${E2E_DELETE_USER_PASSWORD:-E2e-Delete-Throwaway-Pass-1!}
export E2E_PHONE_USER_EMAIL=${E2E_PHONE_USER_EMAIL:-e2e-phone-ci@culinaire.test}
export E2E_PHONE_USER_PASSWORD=${E2E_PHONE_USER_PASSWORD:-E2e-Phone-Throwaway-Pass-1!}
export E2E_PHONE_USER_TOTP_SECRET=${E2E_PHONE_USER_TOTP_SECRET:-KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU}
export E2E_API_URL=http://127.0.0.1:$PORT METRO_URL=http://$APP_HOST:$METRO_PORT

set -m # each background job gets its own process group, so `kill -- -<pid>` stops npx/pnpm and what they started, nothing else
server=""
metro=""
stop() {
  for p in $server $metro; do kill -- "-$p" 2>/dev/null || true; done
  "$ADB" shell wm size reset >/dev/null 2>&1 || true
  "$ADB" shell wm density reset >/dev/null 2>&1 || true
  "$ADB" reverse --remove "tcp:$METRO_PORT" >/dev/null 2>&1 || true
  "$ADB" reverse --remove "tcp:$PORT" >/dev/null 2>&1 || true
  echo "logs: $LOGS"
}
trap stop EXIT

"${PSQL[@]}" -d postgres -c "select 1" >/dev/null 2>&1 || bash "$ROOT/scripts/localIntegrationDb.sh" start
eval "$(bash "$ROOT/scripts/localIntegrationDb.sh" env)"
export PORT DATABASE_URL=postgresql://ci@127.0.0.1:55432/$DB DEV_DATABASE_URL=postgresql://ci@127.0.0.1:55432/$DB CLIENT_URL=http://127.0.0.1:5179
(cd "$ROOT" && pnpm --filter @culinaire/shared build >/dev/null)

# The walks cannot unlock the app lock (the phone is the owner's); development builds only. The lock's own walk sets it to "on".
export EXPO_PUBLIC_APP_LOCK=${EXPO_PUBLIC_APP_LOCK:-off}
EXPO_PUBLIC_API_URL=http://$APP_HOST:$PORT npx expo start --dev-client --port "$METRO_PORT" >"$LOGS/metro.log" 2>&1 </dev/null &
metro=$!

fresh_server() {
  [ -z "$server" ] || { kill -- "-$server" 2>/dev/null || true; sleep 2; }
  "${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB"
  "${PSQL[@]}" -d $DB -c "create extension if not exists vector"
  (cd "$ROOT" && pnpm --filter @culinaire/server db:push >"$LOGS/push.log" 2>&1 && pnpm --filter @culinaire/server db:seed >"$LOGS/seed.log" 2>&1 \
    && pnpm --filter @culinaire/server exec tsx src/scripts/seedE2eCiData.ts)
  (cd "$ROOT" && exec pnpm --filter @culinaire/server exec tsx src/index.ts) >>"$LOGS/server.log" 2>&1 </dev/null &
  server=$!
  for _ in $(seq 1 90); do curl -sf -m 10 "$E2E_API_URL/api/health" >/dev/null && break; sleep 2; done
  { curl -sf -m 10 "$E2E_API_URL/api/health" >/dev/null && kill -0 "$server" 2>/dev/null; } || { echo "the API did not come up"; tail -20 "$LOGS/server.log"; exit 1; }
}

for _ in $(seq 1 90); do curl -sf -m 10 "http://127.0.0.1:$METRO_PORT/status" >/dev/null && break; sleep 2; done
{ curl -sf -m 10 "http://127.0.0.1:$METRO_PORT/status" >/dev/null && kill -0 "$metro" 2>/dev/null; } || { echo "Metro did not come up"; tail -20 "$LOGS/metro.log"; exit 1; }

mkdir -p "$OUT"
rc=0
for form in ${STOREROOM_FORMS:-phone tablet}; do
  fresh_server
  filter=(); [ -z "${STOREROOM_TESTS:-}" ] || filter=(-t "$STOREROOM_TESTS")
  STOREROOM_OUT=$OUT STOREROOM_FORM=$form npx vitest run --config vitest.device.config.ts device/storeRoom.device.test.ts "${filter[@]}" || rc=1
done
[ -n "$server" ] || fresh_server # STOREROOM_FORMS=" " runs the end-to-end test alone
npx vitest run --config vitest.e2e.config.ts e2e/storeRoom.e2e.test.ts || rc=1
exit $rc
