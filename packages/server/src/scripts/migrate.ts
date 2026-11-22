/**
 * @module scripts/migrate
 *
 * Applies pending schema migrations (src/migrations) to the database the environment points at,
 * in order, recording each in `schema_migrations`. Production is a manual, owner-run step, taken
 * BEFORE the server version that needs the change deploys:
 *
 *   list what is applied/pending:  pnpm --filter @culinaire/server exec tsx src/scripts/migrate.ts --list
 *   see the SQL that would run:    pnpm --filter @culinaire/server exec tsx src/scripts/migrate.ts --dry-run
 *   apply:                         pnpm --filter @culinaire/server exec tsx src/scripts/migrate.ts
 *   (production: prefix with APP_ENV=prod, as for scripts/checkSchemaDrift.ts)
 *
 * Run `checkSchemaDrift.ts` first on a database whose state is in doubt.
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

const { db } = await import("../db/index.js");
const { migrations } = await import("../migrations/index.js");
const { appliedMigrationIds, pendingMigrations, runMigrations } = await import("../migrations/runner.js");

async function main(): Promise<void> {
  const flags = new Set(process.argv.slice(2));
  if (flags.has("--list")) {
    const applied = new Set(await appliedMigrationIds(db));
    for (const m of migrations) console.log(`${applied.has(m.id) ? "applied" : "PENDING"}  ${m.id}  ${m.description}`);
    return;
  }
  if (flags.has("--dry-run")) {
    for (const m of await pendingMigrations(db, migrations)) {
      console.log(`-- ${m.id}: ${m.description}`);
      for (const s of m.statements) console.log(`${s};`);
    }
    return;
  }
  const applied = await runMigrations(db, migrations);
  console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Nothing to apply.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
