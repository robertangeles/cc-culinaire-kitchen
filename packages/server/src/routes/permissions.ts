/**
 * @module routes/permissions
 *
 * Express router for permission listing (admin), mounted at `/api/permissions`.
 */

import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { handleListPermissions } from "../controllers/roleController.js";

const router = Router();

router.use(authenticate, requireRole("Administrator"));
router.get("/", handleListPermissions);

export default router;
