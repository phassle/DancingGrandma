import { processStripeEvent } from "@/lib/server/billing";
import { constructWebhookEvent } from "@/lib/server/stripe";

export const runtime = "nodejs";

/**
 * Stripe webhook endpoint — the only place credits are ever granted
 * (PRD #54, issue #56). The raw body is verified against the endpoint's
 * signing secret before anything is trusted; each event is applied in one
 * database transaction keyed by its event id, so Stripe's retries and
 * out-of-order deliveries converge on correct state.
 */
export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "missing stripe-signature header" }, { status: 400 });
  }

  const payload = await request.text();
  let event;
  try {
    event = await constructWebhookEvent(payload, signature);
  } catch {
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }

  try {
    await processStripeEvent(event);
  } catch (err) {
    // Not applied — tell Stripe to retry this event.
    console.error(`stripe webhook ${event.id} (${event.type}) failed:`, err);
    return Response.json({ error: "event processing failed" }, { status: 500 });
  }

  return Response.json({ received: true });
}
