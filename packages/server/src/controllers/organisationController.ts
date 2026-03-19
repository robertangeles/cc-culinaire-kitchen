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
  getOrganisationMembers,
  getMembership,
  updateMemberRole,
  removeMember,
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
    const org = await updateOrganisation(req.user!.sub, parseInt(req.params.id as string), parsed.data);
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
    await leaveOrganisation(req.user!.sub, parseInt(req.params.id as string));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/** GET /api/organisations/:id — get organisation details. */
export async function handleGetOrganisation(req: Request, res: Response, next: NextFunction) {
  try {
    const org = await getOrganisation(parseInt(req.params.id as string));
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
    const newKey = await regenerateJoinKey(req.user!.sub, parseInt(req.params.id as string));
    res.json({ joinKey: newKey });
  } catch (err: unknown) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Members endpoints
// ---------------------------------------------------------------------------

/** GET /api/organisations/:id/members — list all members. */
export async function handleGetMembers(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = parseInt(req.params.id as string);
    const userId = req.user!.sub;

    // Security: verify requesting user is a member of this org
    const membership = await getMembership(userId, orgId);
    if (!membership) {
      res.status(403).json({ error: "You are not a member of this organisation." });
      return;
    }

    const members = await getOrganisationMembers(orgId);
    res.json({ members });
  } catch (err) {
    next(err);
  }
}

const UpdateMemberRoleSchema = z.object({
  role: z.enum(["admin", "member"]),
});

/** PATCH /api/organisations/:id/members/:userId — update a member's role. */
export async function handleUpdateMemberRole(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = parseInt(req.params.id as string);
    const targetUserId = parseInt(req.params.userId as string);
    const requestingUserId = req.user!.sub;

    // Verify requesting user is org admin
    const membership = await getMembership(requestingUserId, orgId);
    if (!membership || membership.role !== "admin") {
      res.status(403).json({ error: "Only admins can update member roles." });
      return;
    }

    const parsed = UpdateMemberRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const updated = await updateMemberRole(orgId, targetUserId, parsed.data.role);
    res.json({ member: updated });
  } catch (err: unknown) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

/** DELETE /api/organisations/:id/members/:userId — remove a member. */
export async function handleRemoveMember(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = parseInt(req.params.id as string);
    const targetUserId = parseInt(req.params.userId as string);
    const requestingUserId = req.user!.sub;

    // Cannot remove yourself — use "Leave Organisation" instead
    if (targetUserId === requestingUserId) {
      res.status(400).json({ error: "You cannot remove yourself. Use 'Leave Organisation' instead." });
      return;
    }

    // Verify requesting user is org admin
    const membership = await getMembership(requestingUserId, orgId);
    if (!membership || membership.role !== "admin") {
      res.status(403).json({ error: "Only admins can remove members." });
      return;
    }

    await removeMember(orgId, targetUserId);
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}
