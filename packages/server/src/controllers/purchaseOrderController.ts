/**
 * @module controllers/purchaseOrderController
 *
 * Input validation and response formatting for Wave 3 Purchase Orders.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import pino from "pino";
import { getUserLocationContext, assertLocationAccess } from "../services/locationContextService.js";
import { hasPermission } from "../middleware/auth.js";
import {
  createPO,
  listPOs,
  getPODetail,
  submitPO,
  cancelPO,
  approvePO,
  rejectPO,
  clonePO,
  emailPOToSupplier,
  withApprovalRights,
} from "../services/purchaseOrderService.js";
import { PO_TRANSITIONS } from "../utils/stateTransition.js";
import * as thresholdService from "../services/thresholdService.js";
import * as pdfService from "../services/pdfService.js";
import { recordOpsEvent } from "../services/brainCaptureService.js";

const logger = pino({ name: "purchaseOrderController" });

// ─── Schemas ──────────────────────────────────────────────────────

const CreatePOLineSchema = z.object({
  ingredientId: z.string().uuid(),
  orderedQty: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) > 0, "Must be a positive number",
  ),
  orderedUnit: z.string().min(1).max(20),
  unitCost: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) >= 0, "Must be a non-negative number",
  ).optional(),
});

const CreatePOSchema = z.object({
  storeLocationId: z.string().uuid(),
  supplierId: z.string().uuid(),
  lines: z.array(CreatePOLineSchema).min(1, "At least one line item is required"),
  notes: z.string().max(2000).optional(),
  expectedDeliveryDate: z.string().optional(),
});

/** The only POs a user holding `purchasing:receive` but not `inventory:count` may see. */
const RECEIVING_QUEUE = ["SENT", "RECEIVING"];

// `status` is one status or a comma list; `limit` is a positive whole number, capped so one call
// cannot pull the whole table (a bad value used to reach SQL and answer 500).
const ListPOsQuerySchema = z.object({
  status: z
    .string()
    .transform((v) => v.split(",").map((x) => x.trim()))
    .pipe(z.array(z.enum(Object.keys(PO_TRANSITIONS) as [string, ...string[]])).min(1))
    .optional(),
  storeLocationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).transform((n) => Math.min(n, 100)).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  sort: z.enum(["created", "expected"]).optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────

/** A receiving-only user (no `inventory:count`) is confined to the receiving queue of the locations they can use. */
function isReceivingOnly(req: Request): boolean {
  return !hasPermission(req.user!, "inventory:count");
}

async function resolveOrgId(req: Request, res: Response): Promise<number | null> {
  const ctx = await getUserLocationContext(req.user!.sub);
  // Prefer a location's org; fall back to the admin's org membership so a
  // location-less org admin can still manage org-wide records (e.g. suppliers).
  const orgId = ctx.locations[0]?.organisationId ?? ctx.organisationId;
  if (orgId === null) {
    res.status(400).json({ error: "You are not a member of any organisation", code: "FORBIDDEN" });
    return null;
  }
  return orgId;
}

/** Spend thresholds decide which orders need approval, so only an organisation admin may change them. */
async function resolveOrgAdminOrgId(req: Request, res: Response): Promise<number | null> {
  const ctx = await getUserLocationContext(req.user!.sub);
  if (ctx.organisationId === null || !ctx.isOrgAdmin) {
    res.status(403).json({ error: "Only an organisation admin can change spend thresholds", code: "FORBIDDEN" });
    return null;
  }
  return ctx.organisationId;
}

/** A refused body: the first problem as the sentence, every field problem under `details`. */
function sendValidation(res: Response, error: z.ZodError): void {
  res.status(400).json({ error: error.issues[0]?.message ?? "Validation failed", code: "VALIDATION", details: error.flatten() });
}

/** An approver sees, on each order waiting for approval, whether they may approve it (not their own while someone else can). */
const canApproveOrders = (req: Request) => hasPermission(req.user!, "purchasing:approve");

// ─── Handlers ─────────────────────────────────────────────────────

export async function handleCreatePO(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const parsed = CreatePOSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    await assertLocationAccess(req.user!, parsed.data.storeLocationId);

    const userId = req.user!.sub;
    const result = await createPO({
      orgId,
      locationId: parsed.data.storeLocationId,
      supplierId: parsed.data.supplierId,
      userId,
      lines: parsed.data.lines,
      notes: parsed.data.notes,
      expectedDate: parsed.data.expectedDeliveryDate,
    });

    logger.info({ poId: result.poId, userId }, "Purchase order created");
    res.status(201).json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.endsWith("not found")) {
      res.status(400).json({ error: msg });
      return;
    }
    next(err);
  }
}

export async function handleListPOs(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const parsed = ListPOsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }
    const { status, ...rest } = parsed.data;

    if (rest.storeLocationId) await assertLocationAccess(req.user!, rest.storeLocationId);

    let statuses: string[] | undefined = status;
    let storeLocationIds: string[] | undefined;
    if (isReceivingOnly(req)) {
      statuses = (statuses ?? RECEIVING_QUEUE).filter((s) => RECEIVING_QUEUE.includes(s));
      if (!rest.storeLocationId) {
        storeLocationIds = (await getUserLocationContext(req.user!.sub)).locations.map((l) => l.storeLocationId);
      }
      if (statuses.length === 0 || storeLocationIds?.length === 0) {
        res.json([]);
        return;
      }
    }

    const result = await listPOs(orgId, { ...rest, statuses, storeLocationIds });
    res.json(canApproveOrders(req) ? await withApprovalRights(result, orgId, req.user!.sub) : result);
  } catch (err) {
    next(err);
  }
}

export async function handleGetPODetail(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const poId = req.params.id as string;
    const result = await getPODetail(poId, orgId);

    // 404, not 403: a receiving-only user cannot tell a draft from a PO that does not exist.
    if (!result || (isReceivingOnly(req) && !RECEIVING_QUEUE.includes(result.status))) {
      res.status(404).json({ error: "Purchase order not found" });
      return;
    }
    if (isReceivingOnly(req)) await assertLocationAccess(req.user!, result.storeLocationId);

    res.json(canApproveOrders(req) ? (await withApprovalRights([result], orgId, req.user!.sub))[0] : result);
  } catch (err) {
    next(err);
  }
}

export async function handleSubmitPO(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const poId = req.params.id as string;
    const userId = req.user!.sub;

    const result = await submitPO(poId, orgId, userId);
    logger.info({ poId, userId }, "Purchase order submitted");
    // Brain org memory (spec T12): remember this PO was submitted for the kitchen.
    void recordOpsEvent({
      userId,
      sourceType: "purchase_order",
      scope: "org",
      organisationId: orgId,
      stage: "submitted",
      sourceRef: `${poId}:submitted`,
      poNumber: result.poNumber,
      totalValue: result.totalValue != null ? String(result.totalValue) : null,
      title: `PO ${result.poNumber} submitted`,
    });
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Cannot submit") || msg.includes("not found")) {
      res.status(400).json({ error: msg });
      return;
    }
    next(err);
  }
}

export async function handleCancelPO(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const poId = req.params.id as string;
    const userId = req.user!.sub;

    const result = await cancelPO(poId, orgId, userId);
    logger.info({ poId, userId }, "Purchase order cancelled");
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Cannot cancel") || msg.includes("not found")) {
      res.status(400).json({ error: msg });
      return;
    }
    next(err);
  }
}

// ─── Approve PO (HQ) ────────────────────────────────────────────

export async function handleApprovePO(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const poId = req.params.id as string;
    const userId = req.user!.sub;

    const result = await approvePO(poId, orgId, userId);
    logger.info({ poId, userId }, "Purchase order approved");
    // Brain org memory (spec T12): remember this PO was approved for the kitchen.
    void recordOpsEvent({
      userId,
      sourceType: "purchase_order",
      scope: "org",
      organisationId: orgId,
      stage: "approved",
      sourceRef: `${poId}:approved`,
      poNumber: result.poNumber,
      totalValue: result.totalValue != null ? String(result.totalValue) : null,
      title: `PO ${result.poNumber} approved`,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ─── Email PO to supplier ───────────────────────────────────────

export async function handleEmailPOToSupplier(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const poId = req.params.id as string;
    const result = await emailPOToSupplier(poId, orgId);

    if (!result.emailed) {
      const messages: Record<string, string> = {
        no_supplier_email: "This supplier has no contact email on file. Add one in Suppliers to email the order.",
        email_not_configured: "Email isn't set up on this server yet, so the order wasn't sent. Download the PDF and send it manually.",
        not_email_supplier: "This supplier isn't set to order by email. Change their Order Via to Email, or send the PO another way.",
      };
      res.json({ emailed: false, reason: result.reason, message: messages[result.reason] });
      return;
    }

    logger.info({ poId, to: result.to }, "Purchase order emailed to supplier");
    res.json({ emailed: true, emailedAt: result.emailedAt, to: result.to });
  } catch (err) {
    next(err);
  }
}

// ─── Reject PO (HQ) ─────────────────────────────────────────────

const RejectPOSchema = z.object({
  reason: z.string({ required_error: "Rejection reason is required" }).trim().min(1, "Rejection reason is required").max(2000),
});

export async function handleRejectPO(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const poId = req.params.id as string;
    const userId = req.user!.sub;

    const parsed = RejectPOSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidation(res, parsed.error);
      return;
    }

    const result = await rejectPO(poId, orgId, userId, parsed.data.reason);
    logger.info({ poId, userId }, "Purchase order rejected");
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// ─── Clone PO ────────────────────────────────────────────────────

const ClonePOSchema = z.object({
  storeLocationId: z.string().uuid(),
});

export async function handleClonePO(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const sourcePOId = req.params.id as string;
    const userId = req.user!.sub;

    const parsed = ClonePOSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    await assertLocationAccess(req.user!, parsed.data.storeLocationId);

    const result = await clonePO(sourcePOId, orgId, parsed.data.storeLocationId, userId);
    logger.info({ sourcePOId, newPOId: result.poId, userId }, "Purchase order cloned");
    res.status(201).json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found") || msg.includes("inactive") || msg.includes("No items")) {
      res.status(400).json({ error: msg });
      return;
    }
    next(err);
  }
}

// ─── Threshold settings ──────────────────────────────────────────

export async function handleGetThresholds(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const result = await thresholdService.getOrgThresholds(orgId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

const ThresholdAmount = z
  .number({ required_error: "Enter a threshold amount", invalid_type_error: "Threshold must be a number" })
  .positive("Threshold must be a positive number")
  .max(thresholdService.MAX_SPEND_THRESHOLD, "Threshold cannot be more than 1,000,000");

const SetOrgThresholdSchema = z.object({ amount: ThresholdAmount });

export async function handleSetOrgThreshold(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgAdminOrgId(req, res);
    if (orgId === null) return;

    const parsed = SetOrgThresholdSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidation(res, parsed.error);
      return;
    }

    await thresholdService.setOrgDefault(orgId, parsed.data.amount, req.user!.sub);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

const SetLocationThresholdSchema = z.object({
  storeLocationId: z.string().uuid("Choose a location"),
  amount: ThresholdAmount,
});

export async function handleSetLocationThreshold(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgAdminOrgId(req, res);
    if (orgId === null) return;

    const parsed = SetLocationThresholdSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidation(res, parsed.error);
      return;
    }

    await thresholdService.setLocationOverride(orgId, parsed.data.storeLocationId, parsed.data.amount, req.user!.sub);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function handleRemoveLocationThreshold(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgAdminOrgId(req, res);
    if (orgId === null) return;

    const parsed = z.string().uuid("Choose a location").safeParse(req.params.locationId);
    if (!parsed.success) {
      sendValidation(res, parsed.error);
      return;
    }
    await thresholdService.removeLocationOverride(orgId, parsed.data, req.user!.sub);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// ─── PDF Download ────────────────────────────────────────────────

export async function handleDownloadPOPdf(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const orgId = await resolveOrgId(req, res);
    if (orgId === null) return;

    const poId = req.params.id as string;
    const { buffer, poNumber } = await pdfService.generatePOPdf(poId, orgId);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${poNumber}.pdf"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}
