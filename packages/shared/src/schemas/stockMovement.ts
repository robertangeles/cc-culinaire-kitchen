import { z } from "zod";
import { numeric } from "./lenient.js";

/** An active storage area at a location (`GET /api/inventory/locations/:locId/storage-areas`); the phone needs only these. */
export const StorageAreaSchema = z.object({
  storageAreaId: z.string(),
  areaName: z.string().min(1),
});
export type StorageArea = z.infer<typeof StorageAreaSchema>;
export const StorageAreaListSchema = z.array(z.unknown()).transform((rows) => rows.flatMap((r) => { const p = StorageAreaSchema.safeParse(r); return p.success ? [p.data] : []; }));

/** A move as `GET /api/inventory/locations/:locId/stock-movements` sends it (names, not ids; it has no user id). */
export const StockMovementSchema = z.object({
  stockMovementId: z.string(),
  ingredientId: z.string().catch(""),
  ingredientName: z.string(),
  quantity: numeric,
  unit: z.string().catch(""),
  fromAreaName: z.string().catch(""),
  toAreaName: z.string().catch(""),
  userName: z.string().nullable().catch(null),
  notes: z.string().nullable().catch(null),
  movedAt: z.string(),
});
export type StockMovement = z.infer<typeof StockMovementSchema>;
export const StockMovementListSchema = z.array(z.unknown()).transform((rows) => rows.flatMap((r) => { const p = StockMovementSchema.safeParse(r); return p.success ? [p.data] : []; }));
