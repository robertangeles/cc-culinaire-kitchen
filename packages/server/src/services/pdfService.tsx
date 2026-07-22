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
import type { POPdfData } from "../templates/PurchaseOrderPdf.js";
import pino from "pino";

const logger = pino({ name: "pdfService" });

const PDF_TIMEOUT_MS = 10_000;

// Mirrors the supplier form's payment-term options (SupplierManager.tsx).
const PAY_LABELS: Record<string, string> = {
  cod: "Cash on Delivery",
  net_7: "Net 7 days",
  net_14: "Net 14 days",
  net_30: "Net 30 days",
  net_60: "Net 60 days",
  prepaid: "Prepaid",
};

/**
 * Generate a PDF buffer for a purchase order.
 * Returns the PDF as a Buffer suitable for email attachment or download.
 */
export async function generatePOPdf(
  poId: string,
  orgId: number,
): Promise<{ buffer: Buffer; poNumber: string }> {
  // Fetch all required data — AND org so callers cannot download another org's PO
  const [po] = await db
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.poId, poId), eq(purchaseOrder.organisationId, orgId)));

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
      purchaseUnit: ingredient.purchaseUnit,
      packQty: ingredient.packQty,
      baseUnit: ingredient.baseUnit,
    })
    .from(purchaseOrderLine)
    .leftJoin(ingredient, eq(purchaseOrderLine.ingredientId, ingredient.ingredientId))
    .where(eq(purchaseOrderLine.poId, poId));

  // The PO is placed by a kitchen (location): show its address; brand-level
  // email/website/phone come from the organisation.
  const addressParts = [
    loc?.addressLine1,
    loc?.addressLine2,
    [loc?.suburb, loc?.state, loc?.postcode].filter(Boolean).join(" ").trim(),
    loc?.country,
  ].filter((p) => p && p.length > 0);

  const supplierAddressParts = [
    sup?.addressLine1,
    sup?.addressLine2,
    [sup?.suburb, sup?.state, sup?.postcode].filter(Boolean).join(" ").trim(),
    sup?.country,
  ].filter((p) => p && p.length > 0);

  const pdfData: POPdfData = {
    poNumber: po.poNumber,
    organisationName: org?.organisationName ?? "Unknown Organisation",
    locationName: loc?.locationName ?? "Unknown Location",
    locationAddress: addressParts.length ? addressParts.join(", ") : null,
    organisationEmail: org?.organisationEmail ?? null,
    organisationWebsite: org?.organisationWebsite ?? null,
    organisationPhone: org?.organisationPhone ?? null,
    supplierName: sup?.supplierName ?? "Unknown Supplier",
    contactName: sup?.contactName ?? null,
    contactEmail: sup?.contactEmail ?? null,
    contactPhone: sup?.contactPhone ?? null,
    supplierWebsite: sup?.website ?? null,
    supplierAddress: supplierAddressParts.length ? supplierAddressParts.join(", ") : null,
    expectedDeliveryDate: po.expectedDeliveryDate
      ? po.expectedDeliveryDate.toLocaleDateString("en-AU", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : null,
    notes: po.notes,
    paymentTerms: sup?.paymentTerms ? (PAY_LABELS[sup.paymentTerms] ?? sup.paymentTerms) : null,
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
      purchaseUnit: l.purchaseUnit,
      packQty: l.packQty,
      baseUnit: l.baseUnit ?? "",
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

  return { buffer: pdfBuffer as Buffer, poNumber: po.poNumber };
}
