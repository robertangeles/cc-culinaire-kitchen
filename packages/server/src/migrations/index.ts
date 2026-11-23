/**
 * @module migrations
 *
 * THE ordered list of schema migrations. Add a file `NNNN_name.ts` and append it here, in order.
 * Apply with `src/scripts/migrate.ts` (see its header); never with `drizzle-kit push`.
 */
import type { Migration } from "./runner.js";
import { migration as m0001 } from "./0001_refresh_token_rotation.js";
import { migration as m0002 } from "./0002_prep_completed_by.js";
import { migration as m0003 } from "./0003_apple_sign_in.js";
import { migration as m0005 } from "./0005_staff_availability_unique.js";

// 0004 is reserved for the push work; ids only have to ascend.
export const migrations: Migration[] = [m0001, m0002, m0003, m0005];
