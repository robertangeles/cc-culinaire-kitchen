/**
 * Read-only: compare every table in schema.ts with the live database and list the
 * differences in column type, NOT NULL, primary key and unique constraints/indexes.
 * (Missing tables/columns, foreign keys and FK indexes have their own scripts/tests.)
 * Changes nothing. Exit code 1 when anything differs.
 *
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/checkSchemaDrift.ts
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/checkSchemaDrift.ts
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

const { sql, is } = await import("drizzle-orm");
const { PgTable, getTableConfig } = await import("drizzle-orm/pg-core");
const { db } = await import("../db/index.js");
const schema = await import("../db/schema.js");

const ALIASES: Record<string, string> = {
  varchar: "charactervarying", char: "character", int: "integer", int4: "integer", serial: "integer",
  bigserial: "bigint", int8: "bigint", smallserial: "smallint", int2: "smallint", decimal: "numeric",
  timestamp: "timestampwithouttimezone", timestamptz: "timestampwithtimezone", bool: "boolean",
  "doubleprecision": "doubleprecision", float8: "doubleprecision",
};
const norm = (t: string) => {
  const s = t.toLowerCase().replace(/\s+/g, "").replace(/\[\]$/, "[]");
  const m = s.match(/^([a-z0-9]+)(\(.*\))?(\[\])?$/);
  if (!m) return s;
  const base = ALIASES[m[1]] ?? m[1];
  return base + (m[2] ?? "") + (m[3] ?? "");
};
// "character varying" and "timestamp with time zone" arrive with spaces already removed by norm.
const normLive = (t: string) => norm(t);

const liveCols = await db.execute(sql`
  SELECT c.relname AS tbl, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS typ, a.attnotnull AS notnull
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped`);
const liveUniq = await db.execute(sql`
  SELECT c.relname AS tbl, i.indisprimary AS pk,
         array_agg(a.attname ORDER BY k.ord) AS cols
  FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
  JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
  WHERE c.relnamespace = 'public'::regnamespace AND (i.indisunique OR i.indisprimary) AND i.indpred IS NULL
  GROUP BY c.relname, i.indexrelid, i.indisprimary`);

const colMap = new Map(liveCols.map((r) => [`${r.tbl}.${r.col}`, r]));
const uniqSets = new Map<string, Set<string>>();
for (const r of liveUniq) {
  const set = uniqSets.get(r.tbl as string) ?? new Set<string>();
  set.add((r.cols as string[]).join(","));
  uniqSets.set(r.tbl as string, set);
}

// Known differences that are not defects: the live side is deliberate or stronger.
const KNOWN: Record<string, string> = {
  "spend_threshold: missing unique/primary key on (organisation_id, store_location_id)":
    "live index wraps store_location_id in COALESCE so org-wide (NULL) rows are unique too; stronger than schema.ts",
  "ingredient_alias.alias_text: type schema=text live=citext":
    "live column is citext (case-insensitive) on purpose; schema.ts has no citext type",
};

const diffs: string[] = [];
for (const value of Object.values(schema)) {
  if (!is(value, PgTable)) continue;
  const cfg = getTableConfig(value);
  const t = cfg.name;
  const pkCols = cfg.columns.filter((c) => c.primary).map((c) => c.name);
  for (const col of cfg.columns) {
    const live = colMap.get(`${t}.${col.name}`);
    if (!live) continue; // missing columns are reported by the other scripts
    if (norm(col.getSQLType()) !== normLive(live.typ as string))
      diffs.push(`${t}.${col.name}: type schema=${col.getSQLType()} live=${live.typ}`);
    const schemaNotNull = col.notNull || col.primary;
    if (schemaNotNull !== (live.notnull as boolean))
      diffs.push(`${t}.${col.name}: NOT NULL schema=${schemaNotNull} live=${live.notnull}`);
  }
  const live = uniqSets.get(t) ?? new Set<string>();
  const expected: string[][] = [];
  if (cfg.primaryKeys.length) for (const pk of cfg.primaryKeys) expected.push(pk.columns.map((c) => c.name));
  else if (pkCols.length) expected.push(pkCols);
  for (const c of cfg.columns) if (c.isUnique && !c.primary) expected.push([c.name]);
  for (const u of cfg.uniqueConstraints) expected.push(u.columns.map((c) => c.name));
  for (const ix of cfg.indexes) if (ix.config.unique && !ix.config.where) expected.push(ix.config.columns.map((c) => (c as { name: string }).name));
  for (const cols of expected) {
    if (!live.has(cols.join(","))) diffs.push(`${t}: missing unique/primary key on (${cols.join(", ")})`);
  }
}

const known = diffs.filter((d) => d in KNOWN);
const real = diffs.filter((d) => !(d in KNOWN));
if (real.length === 0) console.log(`checkSchemaDrift: no differences (${known.length} known and accepted)`);
else console.log(`checkSchemaDrift: ${real.length} difference(s)\n` + real.map((d) => "  " + d).join("\n"));
process.exit(real.length ? 1 : 0);
