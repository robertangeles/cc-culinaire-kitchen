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

/** Hostnames considered "local" — a dev process may only talk to these. */
const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);

/**
 * Refuses to let a non-production process connect to a remote database.
 *
 * Dev and prod historically shared one Postgres, so a stray query or migration
 * from a laptop could hit live data. This guard makes that impossible: unless
 * `NODE_ENV=production` (set by Render in prod), the connection host must be
 * local. Set `NODE_ENV=production` to intentionally target a remote DB.
 *
 * @param connectionString The resolved `DATABASE_URL`.
 * @throws {Error} If a dev process points at a non-local host.
 */
function assertNotRemoteInDev(connectionString: string): void {
  if (process.env.NODE_ENV === "production") return;

  let host = "";
  try {
    host = new URL(connectionString).hostname;
  } catch {
    // Unparseable URL — let postgres.js surface the real connection error.
    return;
  }

  if (!LOCAL_DB_HOSTS.has(host)) {
    throw new Error(
      `Refusing to connect a non-production process to a remote database (host: ${host}). ` +
        `Point DATABASE_URL at a local Postgres for development, or set NODE_ENV=production to override.`,
    );
  }
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

  assertNotRemoteInDev(connectionString);

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
