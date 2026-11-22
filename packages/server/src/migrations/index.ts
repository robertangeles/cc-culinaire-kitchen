/**
 * @module migrations
 *
 * THE ordered list of schema migrations. Add a file `NNNN_name.ts` and append it here, in order.
 * Apply with `src/scripts/migrate.ts` (see its header); never with `drizzle-kit push`.
 */
import type { Migration } from "./runner.js";
import { migration as m0001 } from "./0001_refresh_token_rotation.js";

export const migrations: Migration[] = [m0001];
