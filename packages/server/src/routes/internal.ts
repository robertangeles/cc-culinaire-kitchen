/**
 * @module routes/internal
 *
 * Internal API endpoints secured with X-Internal-Key header.
 * Called by Render cron jobs, not by the frontend.
 */

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { eq, and, lt, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { purchaseOrder, supplier, storeLocation } from "../db/schema.js";
import * as notificationService from "../services/notificationService.js";
import pino from "pino";

const logger = pino({ name: "internalRoutes" });
const router = Router();

/**
 * Middleware: validate X-Internal-Key header.
 */
function requireInternalKey(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers["x-internal-key"] as string;
  const expected = process.env.INTERNAL_CRON_KEY;

  if (!expected) {
    logger.warn("INTERNAL_CRON_KEY not configured — rejecting internal request");
    res.status(503).json({ error: "Internal endpoints not configured" });
    return;
  }

  if (key !== expected) {
    res.status(401).json({ error: "Invalid internal key" });
    return;
  }

  next();
}

router.use(requireInternalKey);

/**
 * POST /api/internal/check-overdue-deliveries
 *
 * Called every 30 minutes by Render cron.
 * Finds POs in SENT status past their expected delivery date.
 * Sends notifications throttled to 1 per 24h per PO.
 */
router.post("/check-overdue-deliveries", async (req: Request, res: Response) => {
  try {
    const now = new Date();

    // Find SENT POs with expected delivery date in the past
    const overduePOs = await db
      .select({
        poId: purchaseOrder.poId,
        poNumber: purchaseOrder.poNumber,
        organisationId: purchaseOrder.organisationId,
        storeLocationId: purchaseOrder.storeLocationId,
        supplierId: purchaseOrder.supplierId,
        expectedDeliveryDate: purchaseOrder.expectedDeliveryDate,
        createdByUserId: purchaseOrder.createdByUserId,
        supplierName: supplier.supplierName,
        locationName: storeLocation.locationName,
      })
      .from(purchaseOrder)
      .leftJoin(supplier, eq(purchaseOrder.supplierId, supplier.supplierId))
      .leftJoin(storeLocation, eq(purchaseOrder.storeLocationId, storeLocation.storeLocationId))
      .where(
        and(
          eq(purchaseOrder.status, "SENT"),
          lt(purchaseOrder.expectedDeliveryDate, now),
        ),
      );

    let notificationsSent = 0;

    for (const po of overduePOs) {
      if (!po.expectedDeliveryDate) continue;

      // Check if we already notified about this PO in the last 24h
      const alreadyNotified = await notificationService.hasRecentNotification(
        "purchase_order",
        po.poId,
        "DELIVERY_OVERDUE",
        24,
      );

      if (alreadyNotified) continue;

      const hoursOverdue = Math.round(
        (now.getTime() - po.expectedDeliveryDate.getTime()) / (1000 * 60 * 60),
      );

      // Notify location creator
      await notificationService.createInApp({
        organisationId: po.organisationId,
        recipientUserId: po.createdByUserId,
        type: "DELIVERY_OVERDUE",
        payload: {
          poId: po.poId,
          poNumber: po.poNumber,
          supplierName: po.supplierName,
          hoursOverdue,
        },
        relatedEntityType: "purchase_order",
        relatedEntityId: po.poId,
      });

      // If >48h overdue, also notify HQ
      if (hoursOverdue > 48) {
        await notificationService.notifyHQAdmins(
          po.organisationId,
          "DELIVERY_OVERDUE",
          {
            poId: po.poId,
            poNumber: po.poNumber,
            supplierName: po.supplierName,
            locationName: po.locationName,
            hoursOverdue,
          },
          "purchase_order",
          po.poId,
          `Delivery overdue: PO ${po.poNumber} (${hoursOverdue}h)`,
          `
            <h2 style="color: #dc2626; margin-bottom: 16px;">Delivery Overdue</h2>
            <p><strong>PO Number:</strong> ${po.poNumber}</p>
            <p><strong>Supplier:</strong> ${po.supplierName}</p>
            <p><strong>Location:</strong> ${po.locationName}</p>
            <p><strong>Overdue by:</strong> ${hoursOverdue} hours</p>
          `,
        );
      }

      notificationsSent++;
    }

    logger.info(
      { checked: overduePOs.length, notified: notificationsSent },
      "Overdue delivery check completed",
    );

    res.json({
      checked: overduePOs.length,
      overdue: overduePOs.length,
      notificationsSent,
    });
  } catch (err) {
    logger.error({ err }, "Overdue delivery check failed");
    res.status(500).json({ error: "Check failed" });
  }
});

export default router;
