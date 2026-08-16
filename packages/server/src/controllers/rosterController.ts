/**
 * @module controllers/rosterController
 *
 * Input validation + response formatting for Roster Core (Phase 2, Slice 3).
 * `orgId` is always derived from the authenticated user via
 * `getUserLocationContext` — never from the client (CLAUDE.md).
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { getUserLocationContext } from "../services/locationContextService.js";
import {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  listRoleDocuments,
  setRoleDocuments,
  listShifts,
  listMyShifts,
  createShift,
  updateShift,
  cancelShift,
  listAvailabilityForUser,
  listAvailabilityForOrg,
  createAvailability,
  updateAvailability,
  deleteAvailability,
  assignStaff,
  listShiftAssignments,
  respondToAssignment,
  removeAssignment,
  publishRoster,
  RosterError,
  AssignmentBlockedError,
} from "../services/rosterService.js";

const RoleSchema = z.object({
  roleName: z.string().min(1).max(100),
  storeLocationId: z.string().uuid().nullable().optional(),
});

const RoleDocumentsSchema = z.object({
  documentTypes: z.array(z.string().min(1).max(40)).max(50),
});

const ShiftSchema = z.object({
  storeLocationId: z.string().uuid(),
  rosterRoleId: z.string().uuid(),
  startDatetime: z.string().min(1),
  endDatetime: z.string().min(1),
  isPublicHoliday: z.boolean().optional(),
});

const ShiftUpdateSchema = z.object({
  startDatetime: z.string().min(1).optional(),
  endDatetime: z.string().min(1).optional(),
});

const AvailabilitySchema = z.object({
  storeLocationId: z.string().uuid().nullable().optional(),
  dayOfWeek: z.number().int().min(0).max(6),
  availableFrom: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "availableFrom must be HH:MM"),
  availableUntil: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "availableUntil must be HH:MM"),
  effectiveFrom: z.string().min(1),
  effectiveUntil: z.string().min(1).nullable().optional(),
});

const AssignSchema = z.object({ userId: z.number().int().positive() });
const RespondSchema = z.object({ response: z.enum(["Confirmed", "Declined"]) });
const PublishSchema = z.object({
  storeLocationId: z.string().uuid(),
  from: z.string().min(1),
  to: z.string().min(1),
});

function handleServiceError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof AssignmentBlockedError) {
    res.status(err.statusCode).json({ error: err.message, blocked: err.info });
  } else if (err instanceof RosterError) {
    res.status(err.statusCode).json({ error: err.message });
  } else {
    next(err);
  }
}

async function resolveContext(req: Request, res: Response): Promise<{ orgId: number } | null> {
  const ctx = await getUserLocationContext(req.user!.sub);
  if (ctx.organisationId === null) {
    res.status(400).json({ error: "You are not a member of any organisation" });
    return null;
  }
  return { orgId: ctx.organisationId };
}

// ── Roles ──────────────────────────────────────────────────────────────

export async function handleListRoles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    res.json(await listRoles(ctx.orgId));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleCreateRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    const parsed = RoleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }
    res.status(201).json(await createRole(ctx.orgId, parsed.data));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleUpdateRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    const parsed = RoleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }
    res.json(await updateRole(ctx.orgId, req.params.id as string, parsed.data));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleDeleteRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    await deleteRole(ctx.orgId, req.params.id as string);
    res.status(204).end();
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleListRoleDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    res.json(await listRoleDocuments(ctx.orgId, req.params.id as string));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleSetRoleDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    const parsed = RoleDocumentsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }
    res.json(await setRoleDocuments(ctx.orgId, req.params.id as string, parsed.data.documentTypes));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

// ── Shifts ─────────────────────────────────────────────────────────────

export async function handleListShifts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    const { storeLocationId, from, to } = req.query;
    res.json(
      await listShifts(ctx.orgId, {
        storeLocationId: typeof storeLocationId === "string" ? storeLocationId : undefined,
        from: typeof from === "string" ? from : undefined,
        to: typeof to === "string" ? to : undefined,
      }),
    );
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleListMyShifts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    res.json(await listMyShifts(ctx.orgId, req.user!.sub));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleCreateShift(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    const parsed = ShiftSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }
    res.status(201).json(await createShift(ctx.orgId, parsed.data, req.user!.sub));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleUpdateShift(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    const parsed = ShiftUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }
    res.json(await updateShift(ctx.orgId, req.params.id as string, parsed.data));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleCancelShift(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    res.json(await cancelShift(ctx.orgId, req.params.id as string));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

// ── Assignments ────────────────────────────────────────────────────────

export async function handleAssignStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    const parsed = AssignSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }
    res
      .status(201)
      .json(await assignStaff(ctx.orgId, req.params.id as string, parsed.data.userId, req.user!.sub));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleListShiftAssignments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    res.json(await listShiftAssignments(ctx.orgId, req.params.id as string));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleRespondToAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    const parsed = RespondSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }
    res.json(
      await respondToAssignment(ctx.orgId, req.params.id as string, req.user!.sub, parsed.data.response),
    );
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleRemoveAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    await removeAssignment(ctx.orgId, req.params.id as string, req.user!.sub);
    res.status(204).end();
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

// ── Availability ───────────────────────────────────────────────────────

export async function handleListMyAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    res.json(await listAvailabilityForUser(ctx.orgId, req.user!.sub));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleListOrgAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    res.json(await listAvailabilityForOrg(ctx.orgId));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleCreateAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    const parsed = AvailabilitySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }
    res.status(201).json(await createAvailability(ctx.orgId, req.user!.sub, parsed.data));
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleUpdateAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    const parsed = AvailabilitySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }
    res.json(
      await updateAvailability(ctx.orgId, req.params.id as string, req.user!.sub, parsed.data),
    );
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

export async function handleDeleteAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    await deleteAvailability(ctx.orgId, req.params.id as string, req.user!.sub);
    res.status(204).end();
  } catch (err) {
    handleServiceError(err, res, next);
  }
}

// ── Publish ────────────────────────────────────────────────────────────

export async function handlePublishRoster(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    const parsed = PublishSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid input" });
      return;
    }
    res.json(
      await publishRoster(ctx.orgId, parsed.data.storeLocationId, parsed.data.from, parsed.data.to, req.user!.sub),
    );
  } catch (err) {
    handleServiceError(err, res, next);
  }
}
