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

config({ path: "../../.env" });

export default defineConfig({
  /** Directory where generated migration SQL files are written. */
  out: "./drizzle",
  /** Path to the Drizzle ORM schema definitions. */
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  schemaFilter: ["public"],
});
