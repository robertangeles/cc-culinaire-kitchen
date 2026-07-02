/**
 * @module drizzle.config
 *
 * Drizzle Kit configuration for schema migrations and introspection.
 * Reads DATABASE_URL from the monorepo root `.env` file and points
 * drizzle-kit at the schema definitions in `src/db/schema.ts`.
 *
 * Usage:
 * ```sh
 * npx drizzle-kit generate   # generate migration SQL
 * npx drizzle-kit migrate     # apply pending migrations
 * npx drizzle-kit studio      # open Drizzle Studio GUI
 * ```
 */

import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load the monorepo-root .env, then resolve the DEV_/PROD_ prefix. drizzle-kit
// loads this config in its own module context and cannot import the app's
// envShim, so the resolution is inlined here — keep it in sync with
// src/utils/envShim.ts. Without it, drizzle-kit sees no connection URL when
// .env only defines DEV_DATABASE_URL / PROD_DATABASE_URL.
config({ path: "../../.env" });
const appEnv = (process.env.APP_ENV ?? "dev").toUpperCase();
const databaseUrl = process.env[`${appEnv}_DATABASE_URL`] ?? process.env.DATABASE_URL;

export default defineConfig({
  /** Directory where generated migration SQL files are written. */
  out: "./drizzle",
  /** Path to the Drizzle ORM schema definitions. */
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl!,
  },
  schemaFilter: ["public"],
});
