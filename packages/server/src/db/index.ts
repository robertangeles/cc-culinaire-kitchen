/**
 * @module db/index
 *
 * Database connection module using Drizzle ORM over postgres.js.
 * Provides a lazily-initialized, singleton database instance so that
 * importing this module never triggers a connection until the first
 * actual query — allowing dotenv to load DATABASE_URL first.
 */

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

/** Singleton Drizzle instance; initialized on first call to {@link getDb}. */
let _db: PostgresJsDatabase<typeof schema> | null = null;

/** Hostnames considered "local" — always safe for a dev process. */
const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);

/** Parse a URL's hostname; "" if absent or unparseable. */
function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * Guards which database a non-production process may connect to.
 *
 * Dev and prod historically shared one Postgres, so a stray query or migration
 * from a laptop could hit live data. The invariants, in order:
 *   1. A prod process (`NODE_ENV=production`, or the explicit `APP_ENV=prod`
 *      opt-in) may connect anywhere.
 *   2. A non-prod process may NEVER reach the prod database host — even with the
 *      remote opt-in below. This is the hard rail.
 *   3. Local hosts are always allowed.
 *   4. A remote host (e.g. a shared cloud dev DB on Neon) is allowed only with an
 *      explicit `ALLOW_REMOTE_DEV_DB=1` opt-in, so it can never happen by accident.
 *
 * @param connectionString The resolved `DATABASE_URL`.
 * @throws {Error} If a dev process points at prod, or at a remote host without opt-in.
 */
export function assertSafeDbHost(connectionString: string): void {
  if (process.env.NODE_ENV === "production") return;
  if ((process.env.APP_ENV ?? "").toLowerCase() === "prod") return;

  const host = hostOf(connectionString);
  if (!host) return; // Unparseable URL — let postgres.js surface the real error.

  // (2) The hard rail: a non-prod process must never touch the prod host, even
  // if ALLOW_REMOTE_DEV_DB is set. Checked FIRST so the opt-in can't override it.
  const prodHost = hostOf(process.env.PROD_DATABASE_URL);
  if (prodHost && host === prodHost) {
    throw new Error(
      `Refusing: a non-production process is pointed at the PROD database host (${host}). ` +
        `Set APP_ENV=prod only to deliberately target production.`,
    );
  }

  // (3) Local is always fine.
  if (LOCAL_DB_HOSTS.has(host)) return;

  // (4) A remote dev DB (e.g. Neon) requires a deliberate opt-in.
  if (process.env.ALLOW_REMOTE_DEV_DB === "1") return;

  throw new Error(
    `Refusing to connect a non-production process to a remote database (host: ${host}). ` +
      `Set ALLOW_REMOTE_DEV_DB=1 to use a cloud dev DB, point DEV_DATABASE_URL at a local ` +
      `Postgres, or set APP_ENV=prod to deliberately target prod.`,
  );
}

/**
 * Returns the singleton Drizzle database instance, creating it on first call.
 *
 * @returns The Drizzle database instance bound to the project schema.
 * @throws {Error} If the `DATABASE_URL` environment variable is not set.
 */
export function getDb(): PostgresJsDatabase<typeof schema> {
  if (_db) return _db;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  assertSafeDbHost(connectionString);

  const client = postgres(connectionString);
  _db = drizzle(client, { schema });
  return _db;
}

/**
 * Lazy database proxy that defers connection until the first property access.
 *
 * This uses a {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy Proxy}
 * so that `import { db }` at the top of any file won't fail — the real
 * connection is only established when a method (e.g. `db.select()`) is called.
 * `dotenv/config` in the app entry point sets `DATABASE_URL` before any
 * DB call happens, making this safe.
 *
 * @example
 * ```ts
 * import { db } from "./db/index.js";
 * const rows = await db.select().from(prompts);
 * ```
 */
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real, prop, receiver);
    // Bind functions so `this` refers to the real Drizzle instance, not the proxy
    return typeof value === "function" ? value.bind(real) : value;
  },
});
