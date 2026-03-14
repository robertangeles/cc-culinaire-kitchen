/**
 * @module routes/users
 *
 * Express router for user profile and admin user management, mounted at `/api/users`.
 */

import { Router } from "express";
import multer from "multer";
import { authenticate, requireRole, requirePermission } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import {
  handleGetProfile,
  handleUpdateProfile,
  handleChangePassword,
  handleAvatarUpload,
  handleListUsers,
  handleGetUserById,
  handleSuspendUser,
  handleReactivateUser,
  handleCancelUser,
  handleUpdateFreeSessions,
  handleAssignRole,
  handleRemoveRole,
  handleDeleteUser,
  handleSendEmail,
  handleAdminUpdateUser,
  handleUpdateSubscription,
  handleRemoveUserOrganisation,
} from "../controllers/userController.js";
import { handleGetKitchenProfile, handleUpsertKitchenProfile } from "../controllers/kitchenProfileController.js";

const router = Router();

// All user routes require authentication
router.use(authenticate);

// Profile (self)
router.get("/profile", handleGetProfile);

// Kitchen profile (personalisation)
router.get("/kitchen-profile", handleGetKitchenProfile);
router.put("/kitchen-profile", handleUpsertKitchenProfile);
router.patch("/profile", handleUpdateProfile);
router.post("/change-password", handleChangePassword);
router.post("/profile/avatar", (req, res, next) => {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ error: "File too large. Maximum size is 2 MB." });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next();
  });
}, handleAvatarUpload);

// Admin user management
router.get("/", requireRole("Administrator"), handleListUsers);
router.get("/:id", requireRole("Administrator"), handleGetUserById);
router.patch("/:id", requirePermission("admin:manage-users"), handleAdminUpdateUser);
router.patch("/:id/suspend", requireRole("Administrator"), handleSuspendUser);
router.patch("/:id/reactivate", requireRole("Administrator"), handleReactivateUser);
router.patch("/:id/cancel", requireRole("Administrator"), handleCancelUser);
router.patch("/:id/free-sessions", requireRole("Administrator"), handleUpdateFreeSessions);
router.patch("/:id/subscription", requireRole("Administrator"), handleUpdateSubscription);
router.delete("/:id/organisation", requireRole("Administrator"), handleRemoveUserOrganisation);
router.post("/:id/roles", requireRole("Administrator"), handleAssignRole);
router.delete("/:id/roles/:roleId", requireRole("Administrator"), handleRemoveRole);
router.delete("/:id", requireRole("Administrator"), handleDeleteUser);
router.post("/:id/email", requireRole("Administrator"), handleSendEmail);

export default router;
