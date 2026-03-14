/**
 * @module routes/stripe
 *
 * Express router for Stripe subscription management, mounted at `/api/stripe`.
 *
 * NOTE: The webhook route uses `express.raw()` and must be registered
 * BEFORE the global `express.json()` middleware in index.ts.
 */

import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  handleCheckout,
  handleGetSubscription,
  handleCancelSubscription,
  handlePortal,
} from "../controllers/stripeController.js";

const router = Router();

// Protected routes
router.post("/checkout", authenticate, handleCheckout);
router.get("/subscription", authenticate, handleGetSubscription);
router.post("/cancel", authenticate, handleCancelSubscription);
router.post("/portal", authenticate, handlePortal);

export default router;
