/**
 * Local dev database bootstrap.
 *
 * Provisions a fresh machine's local Postgres to match this repo's `.env`, so
 * moving between dev machines (ARCHOS, HEPHAESTUS, ...) never means hand-creating
 * roles again. It reads the resolved dev connection string, then idempotently:
 *   1. creates (or re-syncs the password of) the login role,
 *   2. creates the database owned by that role,
 *   3. enables the `vector` extension and grants schema access.
 *
 * It only ever touches a LOCAL Postgres — it refuses to run against a remote
 * host, mirroring the guard in `packages/server/src/db/index.ts`.
 *
 * Usage:
 *   pnpm db:bootstrap            # provision using the current .env
 *   pnpm db:bootstrap --dry-run  # print the SQL (password masked), change nothing
 *
 * Superuser access: defaults to `sudo -u postgres psql` (Linux peer auth) and
 * will prompt for your sudo password. Override with the DB_BOOTSTRAP_PSQL env
 * var, e.g. DB_BOOTSTRAP_PSQL="psql -U postgres".
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const dryRun = process.argv.includes("--dry-run");

/** Parse a `.env` file into a plain object. Quotes are stripped; `#` lines skipped. */
function parseEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Resolve the connection string the app would use, honouring the DEV_/PROD_ prefix shim. */
function resolveDatabaseUrl(env) {
  const appEnv = (env.APP_ENV ?? "dev").toUpperCase();
  return env[`${appEnv}_DATABASE_URL`] || env.DATABASE_URL || "";
}

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

// --- Load and validate -------------------------------------------------------

let env;
try {
  env = parseEnv(join(REPO_ROOT, ".env"));
} catch {
  fail("Could not read .env at the repo root. Copy .env.example to .env first.");
}

const connectionString = resolveDatabaseUrl(env);
if (!connectionString) fail("No DEV_DATABASE_URL (or DATABASE_URL) found in .env.");

let url;
try {
  url = new URL(connectionString);
} catch {
  fail("DEV_DATABASE_URL is not a valid URL.");
}

const host = url.hostname;
if (!LOCAL_HOSTS.has(host)) {
  fail(
    `Refusing to bootstrap a non-local database (host: ${host}). ` +
      `This script only provisions local dev Postgres.`,
  );
}

const role = decodeURIComponent(url.username);
const database = url.pathname.replace(/^\//, "");
const password = decodeURIComponent(url.password);

if (!IDENTIFIER.test(role)) fail(`Unsafe role name in DEV_DATABASE_URL: "${role}"`);
if (!IDENTIFIER.test(database)) fail(`Unsafe database name in DEV_DATABASE_URL: "${database}"`);
if (!password) fail("DEV_DATABASE_URL has no password — set one so the role can log in.");

// --- Build SQL ---------------------------------------------------------------

const pwLiteral = `'${password.replace(/'/g, "''")}'`; // safe single-quoted SQL literal

const roleAndDbSql = `\\set ON_ERROR_STOP on
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
    ALTER ROLE ${role} WITH LOGIN PASSWORD ${pwLiteral};
    RAISE NOTICE 'role ${role}: password synced';
  ELSE
    CREATE ROLE ${role} WITH LOGIN PASSWORD ${pwLiteral};
    RAISE NOTICE 'role ${role}: created';
  END IF;
END
$$;

SELECT 'CREATE DATABASE ${database} OWNER ${role}'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${database}')\\gexec
`;

// Extensions prod uses (vector = pgvector for embeddings; citext + uuid-ossp are
// trusted contrib). pgvector may not be installed on a fresh box, so this step is
// best-effort. citext/uuid-ossp ship with the standard postgres contrib package.
const extSql = `CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
GRANT ALL ON SCHEMA public TO ${role};
`;

// --- Dry run -----------------------------------------------------------------

if (dryRun) {
  const masked = (s) => s.replaceAll(pwLiteral, "'********'");
  console.log(`Resolved from .env (APP_ENV=${env.APP_ENV ?? "dev"}):`);
  console.log(`  role=${role}  db=${database}  host=${host}:${url.port || "5432"}\n`);
  console.log("-- step 1: role + database (run against the default DB) --");
  console.log(masked(roleAndDbSql));
  console.log(`-- step 2: extension + grants (run against ${database}) --`);
  console.log(extSql);
  console.log("(dry run — nothing was changed)");
  process.exit(0);
}

// --- Execute -----------------------------------------------------------------

const psqlCmd = (process.env.DB_BOOTSTRAP_PSQL ?? "sudo -u postgres psql").split(/\s+/);
const [bin, ...baseArgs] = psqlCmd;

function runSql(sql, extraArgs) {
  // SQL is piped via stdin (not a temp file or -c) so the password never lands
  // on disk or in the process list. sudo still prompts on the terminal because
  // stdout/stderr are inherited.
  execFileSync(bin, [...baseArgs, ...extraArgs, "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    stdio: ["pipe", "inherit", "inherit"],
  });
}

console.log(`→ Provisioning role "${role}" and database "${database}" on local Postgres…`);
runSql(roleAndDbSql, []);

console.log(`→ Enabling extensions (pgvector, citext, uuid-ossp) + granting schema access on "${database}"…`);
try {
  runSql(extSql, ["-d", database]);
} catch {
  console.warn(
    `⚠ Could not enable the "vector" extension. If knowledge/RAG features need it, install pgvector:\n` +
      `    sudo apt install postgresql-$(psql -V | grep -oP '\\d+' | head -1)-pgvector\n` +
      `  then re-run: pnpm db:bootstrap`,
  );
}

console.log(
  `\n✓ Local database ready — role, database, and extensions provisioned.` +
    `\n  To load data, restore a prod snapshot. Do NOT run 'drizzle-kit push' / 'db:deploy'` +
    `\n  against this DB — it carries managed schema drift from prod (see tasks/lessons.md #50, #52).`,
);
