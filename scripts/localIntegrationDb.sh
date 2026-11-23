#!/usr/bin/env bash
# A throwaway local Postgres (with pgvector) for the real-DB integration tests, the same shape CI uses.
# Against the Render dev DB these suites crawl (roster.integration: 39 tests, 0.4 s here, 400+ s over the network).
#
#   scripts/localIntegrationDb.sh start     # creates ~/.cache/ck-it-pg, schema + seed, prints the env to export
#   eval "$(scripts/localIntegrationDb.sh env)"
#   pnpm --filter @culinaire/server exec vitest run src/services/roster.integration.test.ts
#   scripts/localIntegrationDb.sh stop      # stops it; `rm -rf ~/.cache/ck-it-pg` forgets the data
#
# Needs the PostgreSQL 16+ server binaries and the pgvector package (apt: postgresql-16 postgresql-16-pgvector).
set -euo pipefail

DIR="$HOME/.cache/ck-it-pg"
SOCK=/tmp/ck-it-pg-sock   # short path: a unix socket path is limited to 107 bytes
PORT=55432
# An existing data directory only starts under the server version that made it; a new one needs a version that has pgvector installed.
if [ -f "$DIR/PG_VERSION" ]; then
  BIN=/usr/lib/postgresql/$(cat "$DIR/PG_VERSION")/bin
else
  BIN=$(for v in $(ls /usr/lib/postgresql 2>/dev/null | sort -rV); do [ -f "/usr/share/postgresql/$v/extension/vector.control" ] && echo "/usr/lib/postgresql/$v/bin" && break; done)
fi
URL="postgresql://ci@127.0.0.1:$PORT/culinaire_it"
ROOT=$(cd "$(dirname "$0")/.." && pwd)

env_lines() {
  # Throwaway keys, the same values CI uses for its own ephemeral database.
  sed -n '/^  integration:/,/^    steps:/p' "$ROOT/.github/workflows/ci.yml" | grep -E '^      (PII_|CREDENTIALS_|CLOUDINARY_)' \
    | sed -E 's/^\s+//; s/: /=/; s/"//g; s/^/export /'
  echo "export APP_ENV=dev TENANT_IT=1 UOM_IT=1 DATABASE_URL=$URL DEV_DATABASE_URL=$URL"
}

case "${1:-}" in
  start)
    [ -n "$BIN" ] || { echo "no PostgreSQL server binaries under /usr/lib/postgresql" >&2; exit 1; }
    mkdir -p "$SOCK"
    [ -d "$DIR" ] || "$BIN/initdb" -D "$DIR" -U ci --auth=trust > /dev/null
    "$BIN/pg_ctl" -D "$DIR" -o "-p $PORT -k $SOCK -c listen_addresses=127.0.0.1" -l "$DIR/server.log" -w start > /dev/null
    psql -h 127.0.0.1 -p $PORT -U ci -d postgres -Atc "select 1 from pg_database where datname='culinaire_it'" | grep -q 1 \
      || psql -h 127.0.0.1 -p $PORT -U ci -d postgres -qc "create database culinaire_it"
    psql -h 127.0.0.1 -p $PORT -U ci -d culinaire_it -qc "create extension if not exists vector"
    eval "$(env_lines)"
    (cd "$ROOT" && pnpm --filter @culinaire/shared build > /dev/null && pnpm --filter @culinaire/server db:push && pnpm --filter @culinaire/server db:seed) | tail -2
    echo "ready: eval \"\$(scripts/localIntegrationDb.sh env)\""
    ;;
  env) env_lines ;;
  stop) "$BIN/pg_ctl" -D "$DIR" -m fast stop ;;
  *) echo "usage: $0 start|env|stop" >&2; exit 2 ;;
esac
