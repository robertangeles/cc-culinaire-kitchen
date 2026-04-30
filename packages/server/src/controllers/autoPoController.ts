/**
 * @module controllers/autoPoController
 *
 * Catalog-spine Phase 4c: auto-PO suggestion endpoint.
 * Static reorder list — no PO is created here. The buyer reads the page
 * and decides which supplier to call.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { getAutoPoSuggestions } from "../services/autoPoSuggestService.js";

const querySchema = z.object({
  storeLocationId: z.string().uuid("storeLocationId must be a UUID"),
});

/** GET /api/inventory/auto-po-suggestions?storeLocationId=... */
export async function handleGetAutoPoSuggestions(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0].message });
      return;
    }
    const result = await getAutoPoSuggestions(parsed.data.storeLocationId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
