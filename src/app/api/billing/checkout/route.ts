import { requireUser } from "@/lib/server/auth";
import {
  createPendingSubscription,
  getCurrentSubscription,
  setCheckoutSessionId,
  setStripeCustomerId,
} from "@/lib/server/billing";
import { createStripeCustomer, createSubscriptionCheckoutSession } from "@/lib/server/stripe";

export const runtime = "nodejs";

/**
 * Start the $9.99/month plan (PRD #54, issue #56). Creates the user's Stripe
 * Customer if needed, records a pending subscription, and returns the hosted
 * Checkout url. Fulfillment never happens here — credits are granted only by
 * the verified webhook after the subscription invoice is paid.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const existing = await getCurrentSubscription(user.id);
  if (existing && (existing.status === "active" || existing.status === "past_due")) {
    return Response.json(
      { error: "already_subscribed", status: existing.status },
      { status: 409 },
    );
  }

  let customerId = user.stripe_customer_id;
  if (!customerId) {
    customerId = await createStripeCustomer({
      userId: user.id,
      email: user.email,
      name: user.display_name,
    });
    await setStripeCustomerId(user.id, customerId);
  }

  const pending = await createPendingSubscription(user.id);
  const origin = new URL(request.url).origin;
  const session = await createSubscriptionCheckoutSession({
    customerId,
    userId: user.id,
    subscriptionRowId: pending.id,
    successUrl: `${origin}/billing/success`,
    cancelUrl: `${origin}/`,
  });
  await setCheckoutSessionId(pending.id, session.id);

  return Response.json({ url: session.url });
}
