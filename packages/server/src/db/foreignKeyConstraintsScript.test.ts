import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "./schema.js";

/**
 * addMissingForeignKeys.ts hand-lists the constraints production is missing. This keeps
 * that list honest against schema.ts: every entry must be a foreign key schema.ts really
 * declares, with the same referenced table, column and ON DELETE rule, so the script can
 * never add a constraint the schema does not have or one that differs from it.
 */
const script = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/addMissingForeignKeys.ts"),
  "utf8",
);
const entries = [
  ...script.matchAll(/^\s+\["(\w+)", "(\w+)", "(\w+)", "(\w+)", "(NO ACTION|SET NULL)"\],$/gm),
].map((m) => ({ table: m[1], column: m[2], refTable: m[3], refColumn: m[4], onDelete: m[5] }));

const declared = new Map<string, { refTable: string; refColumn: string; onDelete: string }>();
for (const t of Object.values(schema).filter((v): v is PgTable => v instanceof PgTable)) {
  const cfg = getTableConfig(t);
  for (const fk of cfg.foreignKeys) {
    const ref = fk.reference();
    declared.set(`${cfg.name}.${ref.columns[0].name}`, {
      refTable: getTableConfig(ref.foreignTable as PgTable).name,
      refColumn: ref.foreignColumns[0].name,
      onDelete: (fk.onDelete ?? "no action").toUpperCase(),
    });
  }
}

describe("addMissingForeignKeys.ts", () => {
  it("lists entries", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it("lists only foreign keys that schema.ts declares, with the same target and delete rule", () => {
    const mismatches = entries.filter((e) => {
      const d = declared.get(`${e.table}.${e.column}`);
      return !d || d.refTable !== e.refTable || d.refColumn !== e.refColumn || d.onDelete !== e.onDelete;
    });
    expect(mismatches, "entries missing from or different in schema.ts").toEqual([]);
  });

  it("lists each column once", () => {
    const keys = entries.map((e) => `${e.table}.${e.column}`);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it("uses only plain lowercase identifiers and constraint names Postgres will not truncate", () => {
    const safe = /^[a-z_][a-z0-9_]{0,62}$/;
    const unsafe = entries
      .flatMap((e) => [e.table, e.column, e.refTable, e.refColumn, `${e.table}_${e.column}_fkey`])
      .filter((id) => !safe.test(id));
    expect(unsafe).toEqual([]);
  });
});
