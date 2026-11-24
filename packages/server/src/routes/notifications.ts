/**
 * @module routes/notifications
 *
 * Express router for push-notification endpoints used by the mobile client: this device's token, and the person's push settings.
 */

import { Router } from "express";
import {
  handleRegisterDevice,
  handleUnregisterDevice,
  handleGetPushPreferences,
  handleUpdatePushPreferences,
} from "../controllers/notificationsController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.post("/register-device", authenticate, handleRegisterDevice);
router.post("/unregister-device", authenticate, handleUnregisterDevice);
router.get("/push-preferences", authenticate, handleGetPushPreferences);
router.put("/push-preferences", authenticate, handleUpdatePushPreferences);

export default router;
