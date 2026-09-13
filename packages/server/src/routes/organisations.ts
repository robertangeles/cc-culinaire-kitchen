/**
 * @module routes/organisations
 *
 * Express router for organisation management, mounted at `/api/organisations`.
 */

import { Router } from "express";
import multer from "multer";
import { authenticate } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import {
  handleCreateOrganisation,
  handleUpdateOrganisation,
  handleOrganisationLogoUpload,
  handleJoinOrganisation,
  handleLeaveOrganisation,
  handleGetOrganisation,
  handleGetMyOrganisation,
  handleRegenerateJoinKey,
  handleGetMembers,
  handleUpdateMemberRole,
  handleRemoveMember,
} from "../controllers/organisationController.js";

const router = Router();

// All organisation routes require authentication
router.use(authenticate);

router.get("/mine", handleGetMyOrganisation);
router.post("/", handleCreateOrganisation);
router.post("/join", handleJoinOrganisation);

// Member management (before /:id to avoid param collision)
router.get("/:id/members", handleGetMembers);
router.patch("/:id/members/:userId", handleUpdateMemberRole);
router.delete("/:id/members/:userId", handleRemoveMember);

router.get("/:id", handleGetOrganisation);
router.patch("/:id", handleUpdateOrganisation);
// Same multer error-handling wrapper as POST /api/users/profile/avatar.
router.post("/:id/logo", (req, res, next) => {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ error: "File too large. Maximum size is 10 MB." });
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
}, handleOrganisationLogoUpload);
router.delete("/:id/leave", handleLeaveOrganisation);
router.post("/:id/regenerate-key", handleRegenerateJoinKey);

export default router;
