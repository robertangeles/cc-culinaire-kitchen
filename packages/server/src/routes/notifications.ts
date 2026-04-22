/**
 * @module routes/notifications
 *
 * Express router for push-notification endpoints used by the mobile client.
 */

import { Router } from "express";
import { handleRegisterDevice } from "../controllers/notificationsController.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.post("/register-device", authenticate, handleRegisterDevice);

export default router;
