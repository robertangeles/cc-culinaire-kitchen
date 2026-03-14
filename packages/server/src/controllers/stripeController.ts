/**
 * @module controllers/stripeController
 *
 * Express handlers for Stripe subscription management.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  createCheckoutSession,
  handleWebhookEvent,
  getSubscriptionStatus,
  cancelSubscription,
  createCustomerPortalSession,
} from "../services/stripeService.js";

const CheckoutSchema = z.object({
  tier: z.enum(["monthly", "yearly"]),
});

/** POST /api/stripe/checkout — create a checkout session. */
export async function handleCheckout(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = CheckoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const result = await createCheckoutSession(req.user!.sub, parsed.data.tier);
    res.json(result);
  } catch (err: unknown) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

/** POST /api/stripe/webhook — handle Stripe webhook. */
export async function handleWebhook(req: Request, res: Response) {
  try {
    const signature = req.headers["stripe-signature"] as string;
    await handleWebhookEvent(req.body, signature);
    res.json({ received: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Webhook error";
    res.status(400).json({ error: message });
  }
}

/** GET /api/stripe/subscription — get current subscription status. */
export async function handleGetSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    const status = await getSubscriptionStatus(req.user!.sub);
    res.json({ subscription: status });
  } catch (err) {
    next(err);
  }
}

/** POST /api/stripe/cancel — cancel subscription. */
export async function handleCancelSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    await cancelSubscription(req.user!.sub);
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

/** POST /api/stripe/portal — create customer portal session. */
export async function handlePortal(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await createCustomerPortalSession(req.user!.sub);
    res.json(result);
  } catch (err: unknown) {
    if (err instanceof Error) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}
