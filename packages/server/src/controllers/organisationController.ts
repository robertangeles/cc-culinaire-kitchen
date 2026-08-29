/**
 * @module controllers/organisationController
 *
 * Express handlers for organisation management.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  generateTokens,
  getUserWithRolesAndPermissions,
} from "../services/authService.js";
import { setAuthCookies } from "./authController.js";
import {
  createOrganisation,
  updateOrganisation,
  updateOrganisationLogo,
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

/**
 * Org admin per the per-org userOrganisation.role flag ONLY — deliberately
 * does not fall back to the global org:manage-organisation permission.
 * user_role carries no organisationId (see the plan's disclosed limitation),
 * so an OR-fallback there let an Operations Admin of Org A — merely a
 * "member" of Org B — promote themselves to admin in Org B, or remove/
 * demote Org B's real members: privilege escalation across a tenant
 * boundary, not the "same global permission, same org" case the tenant-
 * isolation canary tests. Costs nothing: createOrganisation() grants local
 * admin and the global role together, and the backfill only targeted
 * existing per-org admins, so every legitimate Operations Admin already
 * holds local admin on every org they actually administer.
 */
function isOrgManager(membership: { role: string } | null): boolean {
  return !!membership && membership.role === "admin";
}

const CreateOrgSchema = z.object({
  name: z.string().min(1).max(200),
  website: z.string().max(500).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(50).optional(),
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
    // The creator now holds the Operations Admin system role. Re-mint the
    // access token so its permissions apply immediately without requiring
    // the user to log out and back in.
    const authUser = await getUserWithRolesAndPermissions(req.user!.sub);
    const tokens = await generateTokens(authUser);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    res.status(201).json({ organisation: org });
  } catch (err) {
    next(err);
  }
}

const UpdateOrgSchema = z.object({
  name: z.string().min(1).max(200),
  website: z.string().max(500).optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(50).optional(),
  ...socialMediaFields,
  // Organisation Settings (Operations Admin) — branding + operational
  // defaults. A field absent from the request preserves its current value
  // (this endpoint is shared with the org-details/social-media form, which
  // never sends these). logoPath/colorAccent/defaultJurisdiction are
  // nullable columns, so an explicit "" clears them; defaultTimezone/
  // defaultCurrency are NOT NULL with sane defaults, so they can be changed
  // but not cleared to empty.
  logoPath: z.string().max(500).or(z.literal("")).optional(),
  colorAccent: z.string().regex(/^#[0-9A-Fa-f]{6}$/).or(z.literal("")).optional(),
  defaultTimezone: z.string().min(1).max(50).optional(),
  defaultCurrency: z.string().length(3).optional(),
  defaultJurisdiction: z.string().max(3).or(z.literal("")).optional(),
});

/** PATCH /api/organisations/:id — update organisation details (org admin only). */
export async function handleUpdateOrganisation(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = parseInt(req.params.id as string);

    const membership = await getMembership(req.user!.sub, orgId);
    if (!isOrgManager(membership)) {
      res.status(403).json({ error: "Only organisation admins can update organisation details." });
      return;
    }

    const parsed = UpdateOrgSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const org = await updateOrganisation(orgId, parsed.data);
    res.json({ organisation: org });
  } catch (err: unknown) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

/** POST /api/organisations/:id/logo — upload the organisation's logo image. */
export async function handleOrganisationLogoUpload(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = parseInt(req.params.id as string);

    const membership = await getMembership(req.user!.sub, orgId);
    if (!isOrgManager(membership)) {
      res.status(403).json({ error: "Only organisation admins can update the logo." });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    const { uploadFileBuffer } = await import("../middleware/upload.js");
    const filePath = await uploadFileBuffer(req.file.buffer, req.file.originalname, "culinaire/organisations");

    const org = await updateOrganisationLogo(orgId, filePath);
    res.json({ logoPath: filePath, organisation: org });
  } catch (err) {
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
    const orgId = parseInt(req.params.id as string);
    // Security: this returns the org's join_key + decrypted PII. Gate on
    // membership so it can't be read by enumerating org ids. Non-members get
    // the SAME 404 as a missing org so the response is not an existence oracle.
    const membership = await getMembership(req.user!.sub, orgId);
    if (!membership) {
      res.status(404).json({ error: "Organisation not found." });
      return;
    }

    const org = await getOrganisation(orgId);
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

    // Security: verify requesting user is a member of this org. Non-members get
    // a 404 (not 403) so the endpoint is not an org-existence oracle.
    const membership = await getMembership(userId, orgId);
    if (!membership) {
      res.status(404).json({ error: "Organisation not found." });
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

    const membership = await getMembership(requestingUserId, orgId);
    if (!isOrgManager(membership)) {
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

    const membership = await getMembership(requestingUserId, orgId);
    if (!isOrgManager(membership)) {
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
