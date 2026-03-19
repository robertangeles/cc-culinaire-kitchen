/**
 * @module routes/organisations
 *
 * Express router for organisation management, mounted at `/api/organisations`.
 */

import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  handleCreateOrganisation,
  handleUpdateOrganisation,
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
router.delete("/:id/leave", handleLeaveOrganisation);
router.post("/:id/regenerate-key", handleRegenerateJoinKey);

export default router;
