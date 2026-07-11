/**
 * @module scripts/addBrainAnalytics
 *
 * Targeted, idempotent DDL for the Brain analytics layer (Phase 3 prep) — the
 * OLAP star schema that captures the signal Phase 3's design is gated on:
 *   - `dim_date`, `dim_scope`         — conformed dimensions (seeded here)
 *   - `fact_brain_recall`             — one row per recall (T18 hit-rate/latency)
 *   - `fact_brain_corpus`             — nightly per-tenant/scope snapshot (T16/T17)
 *   - `brain_memory.last_recalled_dttm` — recency signal (T16 compaction)
 *
 * DEVIATION FROM THE SPEC, deliberate (same as the other Brain DDL scripts):
 * this DB has managed drift and the standing rule (tasks/lessons.md #52/#54/#56)
 * is **never run whole-schema `drizzle-kit push`**. This is the targeted,
 * additive, re-runnable replacement — CREATE ... IF NOT EXISTS, ADD COLUMN
 * IF NOT EXISTS, and ON CONFLICT DO NOTHING seeds. Constraint / index names
 * mirror the drizzle conventions in `schema.ts` so the file and live DB agree.
 *
 * Run once per environment (local dev, then prod before the code deploys):
 *   pnpm --filter @culinaire/server exec tsx src/scripts/addBrainAnalytics.ts
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

async function main(): Promise<void> {
  // ── Dimensions ─────────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "dim_date" (
      "date_key"       integer PRIMARY KEY,
      "full_date"      date NOT NULL,
      "year"           smallint NOT NULL,
      "quarter"        smallint NOT NULL,
      "month"          smallint NOT NULL,
      "day"            smallint NOT NULL,
      "day_of_week"    smallint NOT NULL,
      "week_of_year"   smallint NOT NULL,
      "is_weekend_ind" boolean NOT NULL DEFAULT false
    )
  `);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "idx_dim_date_full_date" ON "dim_date" ("full_date")`,
  );

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "dim_scope" (
      "scope_key"   smallint PRIMARY KEY,
      "scope_code"  varchar(10) NOT NULL,
      "scope_label" varchar(20) NOT NULL
    )
  `);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "idx_dim_scope_code" ON "dim_scope" ("scope_code")`,
  );

  // ── Facts ──────────────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "fact_brain_recall" (
      "recall_id"       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id"         integer NOT NULL,
      "organisation_id" integer,
      "date_key"        integer NOT NULL,
      "hit_count"       integer NOT NULL,
      "latency_ms"      integer NOT NULL,
      "recalled_dttm"   timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "fact_brain_recall_user_id_user_user_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE CASCADE,
      CONSTRAINT "fact_brain_recall_organisation_id_organisation_organisation_id_fk"
        FOREIGN KEY ("organisation_id") REFERENCES "organisation"("organisation_id") ON DELETE CASCADE,
      CONSTRAINT "fact_brain_recall_date_key_dim_date_date_key_fk"
        FOREIGN KEY ("date_key") REFERENCES "dim_date"("date_key")
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_fact_brain_recall_user" ON "fact_brain_recall" ("user_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_fact_brain_recall_org" ON "fact_brain_recall" ("organisation_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_fact_brain_recall_date" ON "fact_brain_recall" ("date_key")`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "fact_brain_corpus" (
      "snapshot_id"     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "date_key"        integer NOT NULL,
      "scope_key"       smallint NOT NULL,
      "user_id"         integer,
      "organisation_id" integer,
      "memory_count"    integer NOT NULL,
      "ready_count"     integer NOT NULL,
      "pending_count"   integer NOT NULL,
      "failed_count"    integer NOT NULL,
      CONSTRAINT "fact_brain_corpus_date_key_dim_date_date_key_fk"
        FOREIGN KEY ("date_key") REFERENCES "dim_date"("date_key"),
      CONSTRAINT "fact_brain_corpus_scope_key_dim_scope_scope_key_fk"
        FOREIGN KEY ("scope_key") REFERENCES "dim_scope"("scope_key"),
      CONSTRAINT "fact_brain_corpus_user_id_user_user_id_fk"
        FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE CASCADE,
      CONSTRAINT "fact_brain_corpus_organisation_id_organisation_organisation_id_fk"
        FOREIGN KEY ("organisation_id") REFERENCES "organisation"("organisation_id") ON DELETE CASCADE
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_fact_brain_corpus_grain" ON "fact_brain_corpus" ("date_key","scope_key","user_id","organisation_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_fact_brain_corpus_date" ON "fact_brain_corpus" ("date_key")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_fact_brain_corpus_scope" ON "fact_brain_corpus" ("scope_key")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_fact_brain_corpus_user" ON "fact_brain_corpus" ("user_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_fact_brain_corpus_org" ON "fact_brain_corpus" ("organisation_id")`);

  // ── Recency signal on the OLTP table ───────────────────────────────────
  await db.execute(sql`
    ALTER TABLE "brain_memory" ADD COLUMN IF NOT EXISTS "last_recalled_dttm" timestamptz
  `);

  // ── Seed the conformed dimensions ──────────────────────────────────────
  await db.execute(sql`
    INSERT INTO "dim_scope" ("scope_key","scope_code","scope_label") VALUES
      (1,'user','Private'),
      (2,'org','Shared')
    ON CONFLICT ("scope_key") DO NOTHING
  `);
  // Seed the date dimension 2025-2075 — a deliberate ~50-YEAR runway.
  //
  // Why 50 years, not the usual few: `fact_brain_recall.date_key` and
  // `fact_brain_corpus.date_key` FK into `dim_date`, so a recall/snapshot on a
  // day with no `dim_date` row throws (recordRecall swallows it → analytics
  // silently stop; snapshotCorpus errors to the log). A short seed turns that
  // into a "silent failure in N years." The product owner asked for a runway
  // that outlives them (turning 50 in Sept 2026) — the Brain should keep
  // learning for the whole life of the product. ~18.6k rows is trivial.
  //
  // Still self-healing: re-run this script with a later end date to extend
  // (ON CONFLICT DO NOTHING only adds the new days).
  await db.execute(sql`
    INSERT INTO "dim_date"
      ("date_key","full_date","year","quarter","month","day","day_of_week","week_of_year","is_weekend_ind")
    SELECT
      to_char(d,'YYYYMMDD')::int,
      d::date,
      extract(year from d)::smallint,
      extract(quarter from d)::smallint,
      extract(month from d)::smallint,
      extract(day from d)::smallint,
      extract(dow from d)::smallint,
      extract(week from d)::smallint,
      (extract(dow from d) IN (0,6))
    FROM generate_series('2025-01-01'::date,'2075-12-31'::date,'1 day') AS d
    ON CONFLICT ("date_key") DO NOTHING
  `);

  console.log(
    "Brain analytics ensured: dim_date + dim_scope (seeded), fact_brain_recall, fact_brain_corpus, brain_memory.last_recalled_dttm (additive, idempotent).",
  );
}

if (process.argv[1]?.endsWith("addBrainAnalytics.ts")) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Brain analytics DDL failed:", err);
      process.exit(1);
    });
}
