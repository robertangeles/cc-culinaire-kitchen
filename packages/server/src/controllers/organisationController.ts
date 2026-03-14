/**
 * @module controllers/organisationController
 *
 * Express handlers for organisation management.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  createOrganisation,
  updateOrganisation,
  joinOrganisation,
  leaveOrganisation,
  getOrganisation,
  getUserOrganisation,
  regenerateJoinKey,
} from "../services/organisationService.js";

const socialMediaFields = {
  facebook: z.string().max(500).optional(),
  instagram: z.string().max(500).optional(),
  tiktok: z.string().max(500).optional(),
  pinterest: z.string().max(500).optional(),
  linkedin: z.string().max(500).optional(),
};

const CreateOrgSchema = z.object({
  name: z.string().min(1).max(200),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  suburb: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  postcode: z.string().max(20).optional(),
  website: z.string().max(500).optional(),
  email: z.string().email().optional(),
  ...socialMediaFields,
});

/** POST /api/organisations — create an organisation. */
export async function handleCreateOrganisation(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = CreateOrgSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const org = await createOrganisation(req.user!.sub, parsed.data);
    res.status(201).json({ organisation: org });
  } catch (err) {
    next(err);
  }
}

const UpdateOrgSchema = z.object({
  name: z.string().min(1).max(200),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  suburb: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  postcode: z.string().max(20).optional(),
  website: z.string().max(500).optional(),
  email: z.string().email().optional().or(z.literal("")),
  ...socialMediaFields,
});

/** PATCH /api/organisations/:id — update organisation details (creator only). */
export async function handleUpdateOrganisation(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = UpdateOrgSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const org = await updateOrganisation(req.user!.sub, parseInt(req.params.id), parsed.data);
    res.json({ organisation: org });
  } catch (err: unknown) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

const JoinOrgSchema = z.object({ joinKey: z.string().min(1) });

/** POST /api/organisations/join — join via join key. */
export async function handleJoinOrganisation(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = JoinOrgSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const org = await joinOrganisation(req.user!.sub, parsed.data.joinKey);
    res.json({ organisation: org });
  } catch (err: unknown) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

/** DELETE /api/organisations/:id/leave — leave an organisation. */
export async function handleLeaveOrganisation(req: Request, res: Response, next: NextFunction) {
  try {
    await leaveOrganisation(req.user!.sub, parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/** GET /api/organisations/:id — get organisation details. */
export async function handleGetOrganisation(req: Request, res: Response, next: NextFunction) {
  try {
    const org = await getOrganisation(parseInt(req.params.id));
    if (!org) {
      res.status(404).json({ error: "Organisation not found." });
      return;
    }
    res.json({ organisation: org });
  } catch (err) {
    next(err);
  }
}

/** GET /api/organisations/mine — get current user's organisation. */
export async function handleGetMyOrganisation(req: Request, res: Response, next: NextFunction) {
  try {
    const org = await getUserOrganisation(req.user!.sub);
    res.json({ organisation: org });
  } catch (err) {
    next(err);
  }
}

/** POST /api/organisations/:id/regenerate-key — regenerate join key. */
export async function handleRegenerateJoinKey(req: Request, res: Response, next: NextFunction) {
  try {
    const newKey = await regenerateJoinKey(req.user!.sub, parseInt(req.params.id));
    res.json({ joinKey: newKey });
  } catch (err: unknown) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}
