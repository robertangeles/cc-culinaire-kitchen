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
import { migration as m0004 } from "./0004_push_dispatch.js";
import { migration as m0005 } from "./0005_staff_availability_unique.js";
import { migration as m0006 } from "./0006_menu_item_organisation.js";
import { migration as m0007 } from "./0007_foh_restocks.js";
import { migration as m0008 } from "./0008_credit_note_one_per_discrepancy.js";
import { migration as m0009 } from "./0009_bench_safety.js";

export const migrations: Migration[] = [m0001, m0002, m0003, m0004, m0005, m0006, m0007, m0008, m0009];
