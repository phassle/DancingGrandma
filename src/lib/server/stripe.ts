import "server-only";
import Stripe from "stripe";

/**
 * Stripe SDK client boundary (PRD #54, issue #56). This module is the *only*
 * place that talks to Stripe — tests fake it here (`vi.mock("@/lib/server/stripe")`)
 * and exercise everything behind it for real.
 *
 * The user pays securely with Stripe as a Stripe Customer under
 * DancingGrandma's merchant account; card details never touch the app.
 * Fulfillment is webhook-only — nothing here grants credits.
 */

let client: Stripe | undefined;

function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set — run the app via `aspire run`");
  }
  client = new Stripe(key);
  return client;
}

function priceId(): string {
  const price = process.env.STRIPE_PRICE_ID;
  if (!price) {
    throw new Error("STRIPE_PRICE_ID is not set — the $9.99/month plan's Stripe price id");
  }
  return price;
}

/** Create the Stripe Customer for a user; returns the Stripe customer id. */
export async function createStripeCustomer(opts: {
  userId: string;
  email?: string | null;
  name?: string | null;
}): Promise<string> {
  const customer = await getStripe().customers.create(
    {
      email: opts.email ?? undefined,
      name: opts.name ?? undefined,
      metadata: { user_id: opts.userId },
    },
    { idempotencyKey: `customer-${opts.userId}` },
  );
  return customer.id;
}

export type CheckoutSession = { id: string; url: string };

/**
 * Create a subscription-mode Checkout Session for the $9.99/month plan.
 * The internal user and subscription-row ids travel in metadata (copied onto
 * the Stripe subscription too, so out-of-order invoice webhooks can resolve
 * the user); the subscription row id doubles as the idempotency key.
 */
export async function createSubscriptionCheckoutSession(opts: {
  customerId: string;
  userId: string;
  subscriptionRowId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<CheckoutSession> {
  const metadata = { user_id: opts.userId, subscription_row_id: opts.subscriptionRowId };
  const session = await getStripe().checkout.sessions.create(
    {
      mode: "subscription",
      customer: opts.customerId,
      line_items: [{ price: priceId(), quantity: 1 }],
      success_url: opts.successUrl,
      cancel_url: opts.cancelUrl,
      metadata,
      subscription_data: { metadata },
    },
    { idempotencyKey: `checkout-${opts.subscriptionRowId}` },
  );
  if (!session.url) throw new Error("Stripe returned a checkout session without a url");
  return { id: session.id, url: session.url };
}

/** Self-service subscription management and cancellation. */
export async function createPortalSession(
  customerId: string,
  returnUrl: string,
): Promise<{ url: string }> {
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return { url: session.url };
}

/**
 * Narrowed webhook event shape — just what the handlers read. Keeping the
 * boundary's return type small keeps the fakes in tests honest and simple.
 */
export type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

/** Verify a webhook payload's signature and return the event. Throws if invalid. */
export async function constructWebhookEvent(
  payload: string,
  signature: string,
): Promise<StripeEvent> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not set — the webhook endpoint's signing secret");
  }
  const event = await getStripe().webhooks.constructEventAsync(payload, signature, secret);
  return event as unknown as StripeEvent;
}
