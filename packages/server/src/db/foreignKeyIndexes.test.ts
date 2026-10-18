import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema.js";

/**
 * House rule: every foreign key gets an index. Postgres does not create one, and
 * without it every parent-row delete (a user, a location, an ingredient) scans the
 * whole child table to check the constraint. Asserted on the schema definition so a
 * new FK cannot ship unindexed. A primary key, unique constraint or index whose
 * FIRST column is the FK column counts as covering it.
 */
const tables = Object.values(schema)
  .filter((v): v is PgTable => v instanceof PgTable)
  .map((t) => getTableConfig(t));

function leadingColumns(cfg: ReturnType<typeof getTableConfig>): Set<string> {
  const lead = new Set<string>();
  for (const i of cfg.indexes) lead.add((i.config.columns[0] as { name: string }).name);
  for (const u of cfg.uniqueConstraints) lead.add(u.columns[0].name);
  for (const pk of cfg.primaryKeys) lead.add(pk.columns[0].name);
  for (const c of cfg.columns) if (c.primary || c.isUnique) lead.add(c.name);
  return lead;
}

describe("foreign-key indexes", () => {
  it("every foreign key has an index on its leading column", () => {
    const unindexed = tables.flatMap((cfg) => {
      const lead = leadingColumns(cfg);
      return cfg.foreignKeys
        .map((fk) => fk.reference().columns[0].name)
        .filter((column) => !lead.has(column))
        .map((column) => `${cfg.name}.${column}`);
    });
    expect(unindexed, "foreign keys with no index").toEqual([]);
  });

  it("addForeignKeyIndexes.ts lists only indexes that schema.ts declares, with the same column", () => {
    const script = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/addForeignKeyIndexes.ts"),
      "utf8",
    );
    const entries = [...script.matchAll(/^\s+\["(idx_\w+)", "(\w+)", "(\w+)"\],$/gm)].map((m) => ({
      name: m[1],
      table: m[2],
      column: m[3],
    }));
    expect(entries.length).toBeGreaterThan(0);

    // The script builds unquoted DDL from these, so each must be a plain lowercase
    // identifier that Postgres will not truncate (63 bytes) or case-fold.
    const safe = /^[a-z_][a-z0-9_]{0,62}$/;
    const unsafe = entries.flatMap((e) => [e.name, e.table, e.column]).filter((id) => !safe.test(id));
    expect(unsafe, "identifiers unsafe for unquoted DDL").toEqual([]);

    const declared = new Map<string, { table: string; column: string }>();
    for (const cfg of tables) {
      for (const i of cfg.indexes) {
        declared.set(i.config.name, { table: cfg.name, column: (i.config.columns[0] as { name: string }).name });
      }
    }
    const mismatches = entries.filter((e) => {
      const d = declared.get(e.name);
      return !d || d.table !== e.table || d.column !== e.column;
    });
    expect(mismatches, "script entries missing from or different in schema.ts").toEqual([]);
  });
});
