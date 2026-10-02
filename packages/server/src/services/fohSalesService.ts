/**
 * @module services/fohSalesService
 *
 * Front-of-house sale ingestion. This is the pluggable boundary a POS (or CSV
 * import / manual entry) writes to — the app contains no POS itself.
 *
 * recordFohSales:  per sold line, in its own transaction, insert a foh_sale
 *   row and deduct FOH stock. The sale already happened at the counter, so an
 *   oversell (FOH going negative) is FLAGGED, never rejected. Invalid lines
 *   (unknown item / not a FOH consumable / bad qty) are skipped and returned
 *   in `rejected` — valid lines still post (no silent drops).
 * getFohSalesReport:  revenue / COGS / margin per item, COGS via location WAC.
 */

import { and, eq, gte, lte, desc, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { fohSale, stockLevel, ingredient } from "../db/schema.js";

export interface SaleLineInput {
  ingredientId: string;
  quantity: number;
  unitPrice?: number | null;
  soldAt?: Date;
}

export interface RecordedSale {
  fohSaleId: string;
  ingredientId: string;
  quantity: number;
  fohQty: number;
  oversold: boolean;
}

export interface RejectedSale {
  ingredientId: string;
  quantity: number;
  reason: string;
}

/** Return the set of FOH-consumable ingredient IDs for an org (active only). */
async function getFohConsumableIds(orgId: number): Promise<Set<string>> {
  const rows = await db
    .select({ id: ingredient.ingredientId })
    .from(ingredient)
    .where(
      and(
        eq(ingredient.organisationId, orgId),
        eq(ingredient.itemType, "FOH_CONSUMABLE"),
        sql`${ingredient.deletedAt} IS NULL`,
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/**
 * Record FOH sales and deduct FOH stock. Each valid line is atomic (sale row +
 * deduction in one transaction, with the FOH row locked FOR UPDATE so
 * concurrent sales of the same item serialise). Oversell is allowed + flagged.
 */
export async function recordFohSales(
  orgId: number,
  storeLocationId: string,
  lines: SaleLineInput[],
  source: string,
  userId: number,
): Promise<{ recorded: RecordedSale[]; rejected: RejectedSale[]; oversoldCount: number }> {
  const fohIds = await getFohConsumableIds(orgId);
  const recorded: RecordedSale[] = [];
  const rejected: RejectedSale[] = [];
  let oversoldCount = 0;

  for (const line of lines) {
    if (!line.ingredientId || !fohIds.has(line.ingredientId)) {
      rejected.push({
        ingredientId: line.ingredientId,
        quantity: line.quantity,
        reason: "Not a FOH consumable in this organisation",
      });
      continue;
    }
    if (!(line.quantity > 0)) {
      rejected.push({
        ingredientId: line.ingredientId,
        quantity: line.quantity,
        reason: "Quantity must be greater than 0",
      });
      continue;
    }

    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(stockLevel)
        .where(
          and(
            eq(stockLevel.storeLocationId, storeLocationId),
            eq(stockLevel.ingredientId, line.ingredientId),
            eq(stockLevel.zone, "FOH"),
          ),
        )
        .for("update");

      let newQty: number;
      if (!row) {
        // Never restocked to FOH — record the sale as a negative (oversold) row
        // rather than 500-ing. The oversold flag surfaces it for reconciliation.
        newQty = -line.quantity;
        await tx.insert(stockLevel).values({
          storeLocationId,
          ingredientId: line.ingredientId,
          zone: "FOH",
          currentQty: String(newQty),
          version: 0,
        });
      } else {
        newQty = Number(row.currentQty) - line.quantity;
        await tx
          .update(stockLevel)
          .set({
            currentQty: String(newQty),
            version: row.version + 1,
            updatedDttm: new Date(),
          })
          .where(eq(stockLevel.stockLevelId, row.stockLevelId));
      }

      const oversold = newQty < 0;
      const unitPrice = line.unitPrice ?? null;
      const lineTotal = unitPrice !== null ? unitPrice * line.quantity : null;

      const [sale] = await tx
        .insert(fohSale)
        .values({
          organisationId: orgId,
          storeLocationId,
          ingredientId: line.ingredientId,
          quantity: String(line.quantity),
          unitPrice: unitPrice !== null ? String(unitPrice) : null,
          lineTotal: lineTotal !== null ? String(lineTotal) : null,
          source,
          oversoldInd: oversold,
          soldAt: line.soldAt ?? new Date(),
          createdBy: userId,
        })
        .returning();

      return { sale, newQty, oversold };
    });

    if (result.oversold) oversoldCount++;
    recorded.push({
      fohSaleId: result.sale.fohSaleId,
      ingredientId: line.ingredientId,
      quantity: line.quantity,
      fohQty: result.newQty,
      oversold: result.oversold,
    });
  }

  return { recorded, rejected, oversoldCount };
}

/** List recent FOH sales at a location (audit / FOH tab). */
export async function listFohSales(
  storeLocationId: string,
  orgId: number,
  opts?: { startDate?: Date; endDate?: Date; limit?: number },
) {
  const conditions = [
    eq(fohSale.storeLocationId, storeLocationId),
    eq(fohSale.organisationId, orgId),
  ];
  if (opts?.startDate) conditions.push(gte(fohSale.soldAt, opts.startDate));
  if (opts?.endDate) conditions.push(lte(fohSale.soldAt, opts.endDate));

  return db
    .select({
      fohSaleId: fohSale.fohSaleId,
      ingredientId: fohSale.ingredientId,
      ingredientName: ingredient.ingredientName,
      quantity: fohSale.quantity,
      unitPrice: fohSale.unitPrice,
      lineTotal: fohSale.lineTotal,
      source: fohSale.source,
      oversoldInd: fohSale.oversoldInd,
      soldAt: fohSale.soldAt,
    })
    .from(fohSale)
    .innerJoin(ingredient, eq(fohSale.ingredientId, ingredient.ingredientId))
    .where(and(...conditions))
    .orderBy(desc(fohSale.soldAt))
    .limit(opts?.limit ?? 100);
}

/**
 * Revenue / COGS / margin per FOH item over a period. COGS uses the location's
 * weighted average cost (falls back to the item's preferred unit cost). Raw
 * SQL — this is an OLAP-style rollup, kept out of the ORM per project rules.
 */
export async function getFohSalesReport(
  orgId: number,
  opts?: { storeLocationId?: string; startDate?: Date; endDate?: Date },
) {
  const now = new Date();
  const startDate = opts?.startDate ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const endDate = opts?.endDate ?? now;
  const locFilter = opts?.storeLocationId
    ? sql`AND fs.store_location_id = ${opts.storeLocationId}::uuid`
    : sql``;

  const rows = await db.execute<{
    ingredient_id: string;
    ingredient_name: string;
    units_sold: string;
    revenue: string;
    cogs: string;
    oversold_lines: string;
  }>(sql`
    SELECT
      fs.ingredient_id,
      i.ingredient_name,
      SUM(fs.quantity::numeric)                                        AS units_sold,
      COALESCE(SUM(fs.line_total::numeric), 0)                         AS revenue,
      COALESCE(SUM(
        fs.quantity::numeric *
        COALESCE(li.weighted_average_cost::numeric, i.preferred_unit_cost::numeric, 0)
      ), 0)                                                            AS cogs,
      COUNT(*) FILTER (WHERE fs.oversold_ind)                          AS oversold_lines
    FROM foh_sale fs
    JOIN ingredient i ON i.ingredient_id = fs.ingredient_id
    LEFT JOIN location_ingredient li
      ON li.ingredient_id = fs.ingredient_id
      AND li.store_location_id = fs.store_location_id
    WHERE fs.organisation_id = ${orgId}
      AND fs.sold_at >= ${startDate.toISOString()}::timestamptz
      AND fs.sold_at <= ${endDate.toISOString()}::timestamptz
      ${locFilter}
    GROUP BY fs.ingredient_id, i.ingredient_name
    ORDER BY revenue DESC
  `);

  const items = rows.map((r) => {
    const revenue = Number(r.revenue);
    const cogs = Number(r.cogs);
    return {
      ingredientId: r.ingredient_id,
      ingredientName: r.ingredient_name,
      unitsSold: Number(r.units_sold),
      revenue,
      cogs,
      margin: revenue - cogs,
      marginPct: revenue > 0 ? ((revenue - cogs) / revenue) * 100 : null,
      oversoldLines: Number(r.oversold_lines),
    };
  });

  return {
    startDate,
    endDate,
    items,
    totals: {
      revenue: items.reduce((s, i) => s + i.revenue, 0),
      cogs: items.reduce((s, i) => s + i.cogs, 0),
      margin: items.reduce((s, i) => s + i.margin, 0),
    },
  };
}
