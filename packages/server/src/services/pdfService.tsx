/**
 * @module services/pdfService
 *
 * PDF generation for purchase orders using @react-pdf/renderer.
 * Synchronous rendering with a 10-second timeout.
 */

import { renderToBuffer } from "@react-pdf/renderer";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  purchaseOrder,
  purchaseOrderLine,
  ingredient,
  supplier,
  organisation,
  storeLocation,
  user,
} from "../db/schema.js";
import { PurchaseOrderPdf } from "../templates/PurchaseOrderPdf.js";
import type { POPdfData, POPdfLine } from "../templates/PurchaseOrderPdf.js";
import pino from "pino";

const logger = pino({ name: "pdfService" });

const PDF_TIMEOUT_MS = 10_000;

/**
 * Generate a PDF buffer for a purchase order.
 * Returns the PDF as a Buffer suitable for email attachment or download.
 */
export async function generatePOPdf(poId: string): Promise<Buffer> {
  // Fetch all required data
  const [po] = await db
    .select()
    .from(purchaseOrder)
    .where(eq(purchaseOrder.poId, poId));

  if (!po) throw new Error("Purchase order not found");

  const [sup] = await db
    .select()
    .from(supplier)
    .where(eq(supplier.supplierId, po.supplierId));

  const [org] = await db
    .select()
    .from(organisation)
    .where(eq(organisation.organisationId, po.organisationId));

  const [loc] = await db
    .select()
    .from(storeLocation)
    .where(eq(storeLocation.storeLocationId, po.storeLocationId));

  const [creator] = await db
    .select()
    .from(user)
    .where(eq(user.userId, po.createdByUserId));

  const lines = await db
    .select({
      ingredientName: ingredient.ingredientName,
      orderedQty: purchaseOrderLine.orderedQty,
      orderedUnit: purchaseOrderLine.orderedUnit,
      unitCost: purchaseOrderLine.unitCost,
    })
    .from(purchaseOrderLine)
    .leftJoin(ingredient, eq(purchaseOrderLine.ingredientId, ingredient.ingredientId))
    .where(eq(purchaseOrderLine.poId, poId));

  const pdfData: POPdfData = {
    poNumber: po.poNumber,
    organisationName: org?.organisationName ?? "Unknown Organisation",
    locationName: loc?.locationName ?? "Unknown Location",
    supplierName: sup?.supplierName ?? "Unknown Supplier",
    contactName: sup?.contactName ?? null,
    contactEmail: sup?.contactEmail ?? null,
    contactPhone: sup?.contactPhone ?? null,
    expectedDeliveryDate: po.expectedDeliveryDate
      ? po.expectedDeliveryDate.toLocaleDateString("en-AU", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : null,
    notes: po.notes,
    createdByName: creator?.userName ?? "Unknown",
    createdDate: po.createdDttm.toLocaleDateString("en-AU", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    lines: lines.map((l) => ({
      ingredientName: l.ingredientName ?? "Unknown Item",
      orderedQty: l.orderedQty,
      orderedUnit: l.orderedUnit,
      unitCost: l.unitCost,
    })),
    totalValue: po.totalValue,
    currency: sup?.currency ?? "AUD",
  };

  // Render with timeout
  const pdfBuffer = await Promise.race([
    renderToBuffer(<PurchaseOrderPdf data={pdfData} />),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("PDF generation timed out")), PDF_TIMEOUT_MS),
    ),
  ]);

  logger.info({ poId, poNumber: po.poNumber, sizeBytes: pdfBuffer.length }, "PO PDF generated");

  return pdfBuffer as Buffer;
}
