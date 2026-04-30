/**
 * @module services/ingredientAliasService
 *
 * Catalog-spine Phase 1: synonym matching for recipe import.
 *
 * Why this exists:
 *   Recipe import names ("chilli flakes", "Calabrian chilli flakes",
 *   "red pepper flakes") may all refer to the same canonical Catalog row.
 *   The chef shouldn't have to dedup by hand. The alias table holds those
 *   synonyms; the matcher resolves N input names against the Catalog in a
 *   single round-trip with deterministic priority + tiebreaker.
 *
 * Match strategy (priority order, lowest wins):
 *   1. EXACT          — `ingredient.ingredient_name = query` (case-sensitive)
 *   2. CASE_INSENS    — `lower(ingredient.ingredient_name) = lower(query)`
 *   3. ALIAS          — `ingredient_alias.alias_text = query`
 *                       (citext, case-insensitive locale-aware)
 *   4. SUBSTRING      — `ingredient.ingredient_name ILIKE '%query%'`
 *
 * Tiebreaker within a priority: shortest matched name first, then ingredient_id.
 * This makes identical recipes produce identical link decisions across imports.
 *
 * Soft-deleted ingredients are excluded from matching — chefs shouldn't
 * silently link a new dish to a hidden Catalog row.
 *
 * Returns three buckets per call:
 *   - matched:    one canonical row per input
 *   - ambiguous:  multiple candidates at the chosen priority — chef picks
 *   - unmatched:  no hit at any priority — chef can create new
 */

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import type { DbOrTx } from "./auditService.js";
import * as auditService from "./auditService.js";
import { ingredient, ingredientAlias } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

// ─── Types ──────────────────────────────────────────────────────────

export type MatchStrategy = "exact" | "case_insensitive" | "alias" | "substring";

export interface MatchCandidate {
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  preferredUnitCost: string | null;
  matchedVia: MatchStrategy;
}

export interface MatchResult {
  /** The query string from the caller. Echoed back so callers can keep position. */
  query: string;
  /** The position the query had in the input array. Stable per input. */
  inputIndex: number;
  /** Empty for unmatched, length 1 for resolved, length > 1 for ambiguous. */
  candidates: MatchCandidate[];
  /** "matched" | "ambiguous" | "unmatched" — derived from candidates.length. */
  status: "matched" | "ambiguous" | "unmatched";
}

// ─── Bulk match ─────────────────────────────────────────────────────

/**
 * Match N input names against the Catalog in a single SQL round-trip.
 *
 * Bulk-CTE design: a per-input row gets joined against four candidate
 * sources. `DISTINCT ON ((input_idx, priority))` keeps the top-priority
 * match per input; the surrounding query gathers all candidates at that
 * priority for ambiguity detection.
 */
export async function matchBulk(
  organisationId: number,
  queries: string[],
): Promise<MatchResult[]> {
  if (queries.length === 0) return [];

  // Build a VALUES table from the input queries — Postgres handles arrays
  // of (idx, query) cleanly via UNNEST.
  const indices = queries.map((_, i) => i);

  const rows = await db.execute<{
    input_idx: number;
    query: string;
    ingredient_id: string | null;
    ingredient_name: string | null;
    base_unit: string | null;
    preferred_unit_cost: string | null;
    matched_via: MatchStrategy | null;
    priority: number | null;
  }>(sql`
    WITH inputs AS (
      SELECT idx::int AS input_idx, q AS query
      FROM unnest(
        ${sql.raw(`ARRAY[${indices.join(",")}]::int[]`)},
        ${sql.raw(`ARRAY[${queries.map((q) => `'${q.replace(/'/g, "''")}'`).join(",")}]::text[]`)}
      ) AS t(idx, q)
    ),
    candidates AS (
      -- 1) EXACT
      SELECT i.input_idx, i.query, ing.ingredient_id, ing.ingredient_name,
             ing.base_unit, ing.preferred_unit_cost,
             'exact'::text AS matched_via, 1 AS priority,
             length(ing.ingredient_name) AS name_len
        FROM inputs i
        JOIN ingredient ing
          ON ing.ingredient_name = i.query
         AND ing.organisation_id = ${organisationId}
         AND ing.deleted_at IS NULL

      UNION ALL

      -- 2) CASE-INSENSITIVE EXACT
      SELECT i.input_idx, i.query, ing.ingredient_id, ing.ingredient_name,
             ing.base_unit, ing.preferred_unit_cost,
             'case_insensitive'::text AS matched_via, 2 AS priority,
             length(ing.ingredient_name) AS name_len
        FROM inputs i
        JOIN ingredient ing
          ON lower(ing.ingredient_name) = lower(i.query)
         AND ing.organisation_id = ${organisationId}
         AND ing.deleted_at IS NULL

      UNION ALL

      -- 3) ALIAS (citext = case-insensitive, locale-aware)
      SELECT i.input_idx, i.query, ing.ingredient_id, ing.ingredient_name,
             ing.base_unit, ing.preferred_unit_cost,
             'alias'::text AS matched_via, 3 AS priority,
             length(ing.ingredient_name) AS name_len
        FROM inputs i
        JOIN ingredient_alias a
          ON a.alias_text = i.query::citext
         AND a.organisation_id = ${organisationId}
        JOIN ingredient ing
          ON ing.ingredient_id = a.ingredient_id
         AND ing.deleted_at IS NULL

      UNION ALL

      -- 4) SUBSTRING (ILIKE — last resort, more likely to be ambiguous)
      SELECT i.input_idx, i.query, ing.ingredient_id, ing.ingredient_name,
             ing.base_unit, ing.preferred_unit_cost,
             'substring'::text AS matched_via, 4 AS priority,
             length(ing.ingredient_name) AS name_len
        FROM inputs i
        JOIN ingredient ing
          ON ing.ingredient_name ILIKE '%' || i.query || '%'
         AND ing.organisation_id = ${organisationId}
         AND ing.deleted_at IS NULL
    ),
    -- For each input, find the lowest priority that produced any hit.
    best_priority AS (
      SELECT input_idx, MIN(priority) AS pmin
        FROM candidates
       GROUP BY input_idx
    )
    SELECT c.input_idx, c.query, c.ingredient_id, c.ingredient_name,
           c.base_unit, c.preferred_unit_cost::text AS preferred_unit_cost,
           c.matched_via, c.priority
      FROM candidates c
      JOIN best_priority bp
        ON bp.input_idx = c.input_idx
       AND bp.pmin = c.priority
     ORDER BY c.input_idx, c.name_len ASC, c.ingredient_id ASC
  `);

  // Group rows by input_idx + materialise unmatched buckets.
  const byIdx = new Map<number, MatchCandidate[]>();
  for (const r of rows) {
    if (r.input_idx === null || r.ingredient_id === null) continue;
    const arr = byIdx.get(r.input_idx) ?? [];
    arr.push({
      ingredientId: r.ingredient_id,
      ingredientName: r.ingredient_name ?? "",
      baseUnit: r.base_unit ?? "",
      preferredUnitCost: r.preferred_unit_cost ?? null,
      matchedVia: (r.matched_via ?? "exact") as MatchStrategy,
    });
    byIdx.set(r.input_idx, arr);
  }

  return queries.map((q, i) => {
    const candidates = byIdx.get(i) ?? [];
    const status: MatchResult["status"] =
      candidates.length === 0 ? "unmatched" : candidates.length === 1 ? "matched" : "ambiguous";
    return { query: q, inputIndex: i, candidates, status };
  });
}

// ─── Alias CRUD ─────────────────────────────────────────────────────

export async function listAliasesForIngredient(ingredientId: string) {
  return db
    .select()
    .from(ingredientAlias)
    .where(eq(ingredientAlias.ingredientId, ingredientId));
}

export async function createAlias(
  organisationId: number,
  ingredientId: string,
  aliasText: string,
  createdByUserId: number,
): Promise<typeof ingredientAlias.$inferSelect> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(ingredientAlias)
      .values({
        organisationId,
        ingredientId,
        aliasText: aliasText.trim(),
        createdByUserId,
      })
      .returning();

    await auditService.log(
      {
        entityType: "ingredient_alias",
        entityId: row.aliasId,
        action: "create",
        actorUserId: createdByUserId,
        organisationId,
        afterValue: { ingredientId, aliasText: aliasText.trim() },
      },
      tx as DbOrTx,
    );

    return row;
  });
}

export async function deleteAlias(
  aliasId: string,
  organisationId: number,
  actorUserId: number,
): Promise<void> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(ingredientAlias)
      .where(
        and(
          eq(ingredientAlias.aliasId, aliasId),
          eq(ingredientAlias.organisationId, organisationId),
        ),
      );

    if (!existing) throw new Error("Alias not found in this organisation");

    await tx
      .delete(ingredientAlias)
      .where(eq(ingredientAlias.aliasId, aliasId));

    await auditService.log(
      {
        entityType: "ingredient_alias",
        entityId: aliasId,
        action: "soft_delete",
        actorUserId,
        organisationId,
        beforeValue: { ingredientId: existing.ingredientId, aliasText: existing.aliasText },
      },
      tx as DbOrTx,
    );
  });
}
