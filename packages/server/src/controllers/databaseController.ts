/**
 * @module controllers/databaseController
 *
 * Admin-only endpoint for database storage statistics.
 * Provides per-table row counts, sizes, and total database size.
 */

import type { Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

/**
 * GET /api/admin/database/stats
 *
 * Returns database storage statistics including total size and per-table breakdown.
 */
export async function handleDatabaseStats(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Total database size
    const [totalResult] = await db.execute(
      sql`SELECT pg_size_pretty(pg_database_size(current_database())) as total_size,
               pg_database_size(current_database()) as total_bytes`
    ) as unknown as [{ total_size: string; total_bytes: string }][];

    // Per-table breakdown
    const tables = await db.execute(
      sql`SELECT
            relname as table_name,
            n_live_tup as row_count,
            pg_size_pretty(pg_total_relation_size(relid)) as total_size,
            pg_total_relation_size(relid) as total_bytes,
            pg_size_pretty(pg_relation_size(relid)) as data_size,
            pg_size_pretty(pg_indexes_size(relid)) as index_size
          FROM pg_stat_user_tables
          ORDER BY pg_total_relation_size(relid) DESC`
    ) as unknown as {
      table_name: string;
      row_count: number;
      total_size: string;
      total_bytes: number;
      data_size: string;
      index_size: string;
    }[];

    // pgvector stats
    let embeddingCount = 0;
    try {
      const [result] = await db.execute(
        sql`SELECT COUNT(*) as count FROM knowledge_chunk WHERE embedding IS NOT NULL`
      ) as unknown as [{ count: string }][];
      embeddingCount = parseInt((result as any).count ?? "0", 10);
    } catch {
      // Table might not exist yet
    }

    res.json({
      totalSize: (totalResult as any)?.total_size ?? "Unknown",
      totalBytes: parseInt((totalResult as any)?.total_bytes ?? "0", 10),
      embeddingCount,
      tables: (tables as any[]).map((t) => ({
        tableName: t.table_name,
        rowCount: parseInt(t.row_count ?? "0", 10),
        totalSize: t.total_size,
        totalBytes: parseInt(t.total_bytes ?? "0", 10),
        dataSize: t.data_size,
        indexSize: t.index_size,
      })),
    });
  } catch (err) {
    next(err);
  }
}
