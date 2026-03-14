/**
 * @module services/stripeService
 *
 * Stripe integration for subscription billing: checkout sessions,
 * webhook handling, subscription management, and customer portal.
 */

import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { user, userRole, role } from "../db/schema.js";

// Lazy singleton so the Stripe key can be hydrated from DB before first use.
let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");
  return _stripe;
}

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

/** Create a Stripe checkout session for a subscription. */
export async function createCheckoutSession(
  userId: number,
  tier: "monthly" | "yearly"
) {
  // Get user
  const rows = await db
    .select({ email: user.userEmail, stripeCustomerId: user.stripeCustomerId })
    .from(user)
    .where(eq(user.userId, userId));

  if (rows.length === 0) throw new Error("User not found.");
  const { email, stripeCustomerId } = rows[0];

  // Get or create Stripe customer
  let customerId = stripeCustomerId;
  if (!customerId) {
    const customer = await getStripe().customers.create({
      email,
      metadata: { userId: String(userId) },
    });
    customerId = customer.id;
    await db
      .update(user)
      .set({ stripeCustomerId: customerId })
      .where(eq(user.userId, userId));
  }

  // Get price ID
  const priceId =
    tier === "monthly"
      ? process.env.STRIPE_PRICE_MONTHLY
      : process.env.STRIPE_PRICE_YEARLY;

  if (!priceId) throw new Error("Stripe price not configured.");

  const session = await getStripe().checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${CLIENT_URL}/profile?subscription=success`,
    cancel_url: `${CLIENT_URL}/profile?subscription=cancelled`,
    metadata: { userId: String(userId) },
  });

  return { url: session.url };
}

/** Handle Stripe webhook events. */
export async function handleWebhookEvent(
  body: Buffer,
  signature: string
) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error("Webhook secret not configured.");

  const event = getStripe().webhooks.constructEvent(body, signature, webhookSecret);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = parseInt(session.metadata?.userId ?? "0");
      if (!userId) break;

      const subscriptionId = session.subscription as string;
      const sub = await getStripe().subscriptions.retrieve(subscriptionId) as any;

      await db
        .update(user)
        .set({
          stripeSubscriptionId: subscriptionId,
          subscriptionStatus: "active",
          subscriptionTier: determineTierFromAny(sub),
          currentPeriodEndDttm: sub.current_period_end
            ? new Date(sub.current_period_end * 1000)
            : null,
          updatedDttm: new Date(),
        })
        .where(eq(user.userId, userId));

      // Assign Paid Subscriber role
      const paidRole = await db
        .select({ roleId: role.roleId })
        .from(role)
        .where(eq(role.roleName, "Paid Subscriber"));

      if (paidRole.length > 0) {
        const existing = await db
          .select()
          .from(userRole)
          .where(eq(userRole.userId, userId));

        const hasRole = existing.some((r) => r.roleId === paidRole[0].roleId);
        if (!hasRole) {
          await db.insert(userRole).values({
            userId,
            roleId: paidRole[0].roleId,
          });
        }
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as any;
      const customerId = subscription.customer as string;

      const rows = await db
        .select({ userId: user.userId })
        .from(user)
        .where(eq(user.stripeCustomerId, customerId));

      if (rows.length === 0) break;

      await db
        .update(user)
        .set({
          subscriptionStatus: mapStatus(subscription.status),
          subscriptionTier: determineTierFromAny(subscription),
          currentPeriodEndDttm: subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000)
            : null,
          updatedDttm: new Date(),
        })
        .where(eq(user.userId, rows[0].userId));
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as any;
      const customerId = subscription.customer as string;

      const rows = await db
        .select({ userId: user.userId })
        .from(user)
        .where(eq(user.stripeCustomerId, customerId));

      if (rows.length === 0) break;

      await db
        .update(user)
        .set({
          subscriptionStatus: "cancelled",
          subscriptionTier: "free",
          stripeSubscriptionId: null,
          currentPeriodEndDttm: null,
          updatedDttm: new Date(),
        })
        .where(eq(user.userId, rows[0].userId));
      break;
    }
  }
}

/** Get subscription status for a user. */
export async function getSubscriptionStatus(userId: number) {
  const rows = await db
    .select({
      subscriptionStatus: user.subscriptionStatus,
      subscriptionTier: user.subscriptionTier,
      currentPeriodEndDttm: user.currentPeriodEndDttm,
      stripeSubscriptionId: user.stripeSubscriptionId,
    })
    .from(user)
    .where(eq(user.userId, userId));

  if (rows.length === 0) throw new Error("User not found.");
  return rows[0];
}

/** Cancel a subscription. */
export async function cancelSubscription(userId: number) {
  const rows = await db
    .select({ stripeSubscriptionId: user.stripeSubscriptionId })
    .from(user)
    .where(eq(user.userId, userId));

  if (rows.length === 0 || !rows[0].stripeSubscriptionId) {
    throw new Error("No active subscription.");
  }

  await getStripe().subscriptions.update(rows[0].stripeSubscriptionId, {
    cancel_at_period_end: true,
  });

  await db
    .update(user)
    .set({ subscriptionStatus: "cancelled", updatedDttm: new Date() })
    .where(eq(user.userId, userId));
}

/** Create a Stripe customer portal session. */
export async function createCustomerPortalSession(userId: number) {
  const rows = await db
    .select({ stripeCustomerId: user.stripeCustomerId })
    .from(user)
    .where(eq(user.userId, userId));

  if (rows.length === 0 || !rows[0].stripeCustomerId) {
    throw new Error("No Stripe customer found.");
  }

  const session = await getStripe().billingPortal.sessions.create({
    customer: rows[0].stripeCustomerId,
    return_url: `${CLIENT_URL}/profile`,
  });

  return { url: session.url };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function determineTierFromAny(subscription: any): string {
  const interval = subscription?.items?.data?.[0]?.price?.recurring?.interval;
  if (interval === "month") return "monthly";
  if (interval === "year") return "yearly";
  return "free";
}

function mapStatus(status: string): string {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
      return "cancelled";
    default:
      return "free";
  }
}
