/**
 * @module controllers/userController
 *
 * Express handlers for user profile and admin user management.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { user } from "../db/schema.js";
import {
  getUserProfile,
  updateUserProfile,
  changePassword,
  listAllUsers,
  suspendUser,
  reactivateUser,
  cancelUser,
  updateFreeSessions,
  assignRole,
  removeRole,
  deleteUser,
  adminUpdateUser,
  updateSubscription,
  removeUserOrganisation,
} from "../services/userService.js";
import { getUserOrganisation } from "../services/organisationService.js";
import { sendDirectEmail } from "../services/emailService.js";

/** GET /api/users/profile — get current user's profile. */
export async function handleGetProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const profile = await getUserProfile(req.user!.sub);
    if (!profile) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    res.json({ profile });
  } catch (err) {
    next(err);
  }
}

const UpdateProfileSchema = z.object({
  userName: z.string().min(1).max(100).optional(),
  userPhotoPath: z.string().max(500).optional(),
  userBio: z.string().max(300).optional(),
  userAddressLine1: z.string().max(200).optional(),
  userAddressLine2: z.string().max(200).optional(),
  userSuburb: z.string().max(100).optional(),
  userState: z.string().max(100).optional(),
  userCountry: z.string().max(100).optional(),
  userPostcode: z.string().max(20).optional(),
  userFacebook: z.string().max(500).optional(),
  userInstagram: z.string().max(500).optional(),
  userTiktok: z.string().max(500).optional(),
  userPinterest: z.string().max(500).optional(),
  userLinkedin: z.string().max(500).optional(),
});

/** PATCH /api/users/profile — update current user's profile. */
export async function handleUpdateProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = UpdateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    await updateUserProfile(req.user!.sub, parsed.data);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

/** POST /api/users/change-password — change password. */
export async function handleChangePassword(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = ChangePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    await changePassword(req.user!.sub, parsed.data.currentPassword, parsed.data.newPassword);
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

/** POST /api/users/profile/avatar — upload avatar image. */
export async function handleAvatarUpload(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    const userId = req.user!.sub;
    const filePath = `/uploads/${req.file.filename}`;

    await db
      .update(user)
      .set({ userPhotoPath: filePath, updatedDttm: new Date() })
      .where(eq(user.userId, userId));

    res.json({ photoPath: filePath });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------

/** GET /api/users — list all users (admin). */
export async function handleListUsers(req: Request, res: Response, next: NextFunction) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = (req.query.search as string) || undefined;
    const result = await listAllUsers(page, limit, search);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/** GET /api/users/:id — full user profile for admin (decrypted PII + org). */
export async function handleGetUserById(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = parseInt(req.params.id as string);
    const profile = await getUserProfile(userId);
    if (!profile) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    const organisation = await getUserOrganisation(userId);
    res.json({ profile, organisation });
  } catch (err) {
    next(err);
  }
}

const AdminUpdateUserSchema = z.object({
  userName: z.string().min(1).max(100).optional(),
  userEmail: z.string().email().optional(),
  userStatus: z.enum(["active", "suspended", "cancelled"]).optional(),
});

/** PATCH /api/users/:id — admin update user fields. */
export async function handleAdminUpdateUser(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = parseInt(req.params.id as string);
    const parsed = AdminUpdateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    await adminUpdateUser(userId, parsed.data);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/users/:id/suspend */
export async function handleSuspendUser(req: Request, res: Response, next: NextFunction) {
  try {
    await suspendUser(parseInt(req.params.id as string));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/users/:id/reactivate */
export async function handleReactivateUser(req: Request, res: Response, next: NextFunction) {
  try {
    await reactivateUser(parseInt(req.params.id as string));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/users/:id/cancel */
export async function handleCancelUser(req: Request, res: Response, next: NextFunction) {
  try {
    await cancelUser(parseInt(req.params.id as string));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

const FreeSessionsSchema = z.object({ freeSessions: z.number().int().min(0) });

/** PATCH /api/users/:id/free-sessions */
export async function handleUpdateFreeSessions(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = FreeSessionsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    await updateFreeSessions(parseInt(req.params.id as string), parsed.data.freeSessions);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

const AssignRoleSchema = z.object({ roleId: z.number().int() });

/** POST /api/users/:id/roles — assign a role. */
export async function handleAssignRole(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = AssignRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    await assignRole(parseInt(req.params.id as string), parsed.data.roleId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/users/:id/roles/:roleId — remove a role. */
export async function handleRemoveRole(req: Request, res: Response, next: NextFunction) {
  try {
    await removeRole(parseInt(req.params.id as string), parseInt(req.params.roleId as string));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/users/:id — permanently delete a user and all associated data.
 *
 * Cascade-deletes messages, conversations, roles, org memberships,
 * refresh tokens, email verifications, OAuth accounts, then the user.
 */
export async function handleDeleteUser(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = parseInt(req.params.id as string);
    if (userId === req.user?.sub) {
      res.status(400).json({ error: "Cannot delete your own account" });
      return;
    }
    await deleteUser(userId);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "User not found") {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  }
}

const SendEmailSchema = z.object({
  subject: z.string().min(1, "Subject is required").max(200),
  body: z.string().min(1, "Body is required"),
});

/**
 * POST /api/users/:id/email — send a direct email to a user.
 *
 * Looks up the user's email address, then delegates to the email service.
 * Returns 503 if Resend is not configured.
 */
export async function handleSendEmail(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = parseInt(req.params.id as string);
    const parsed = SendEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }

    const rows = await db
      .select({ userEmail: user.userEmail, userName: user.userName })
      .from(user)
      .where(eq(user.userId, userId));

    if (rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const result = await sendDirectEmail(rows[0].userEmail, parsed.data.subject, parsed.data.body);
    if (!result.sent) {
      const status = result.error?.includes("not configured") ? 503 : 502;
      res.status(status).json({ error: result.error ?? "Failed to send email" });
      return;
    }

    res.json({ success: true, to: rows[0].userEmail });
  } catch (err) {
    next(err);
  }
}

const SubscriptionSchema = z.object({
  subscriptionTier: z.string().min(1).max(50).optional(),
  subscriptionStatus: z.string().min(1).max(50).optional(),
});

/** PATCH /api/users/:id/subscription — admin update subscription fields. */
export async function handleUpdateSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = parseInt(req.params.id as string);
    const parsed = SubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    await updateSubscription(userId, parsed.data);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/users/:id/organisation — admin remove user from organisation. */
export async function handleRemoveUserOrganisation(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = parseInt(req.params.id as string);
    await removeUserOrganisation(userId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
