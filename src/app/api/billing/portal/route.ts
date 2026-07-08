import { requireUser } from "@/lib/server/auth";
import { createPortalSession } from "@/lib/server/stripe";

export const runtime = "nodejs";

/**
 * Stripe Customer Portal (PRD #54, issue #56): self-service subscription
 * management and cancellation. Cancellation stops future grants but never
 * revokes credits already granted — that is enforced by the webhook side,
 * which only ever changes subscription status, never the wallet.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  if (!user.stripe_customer_id) {
    return Response.json({ error: "no_stripe_customer" }, { status: 409 });
  }
  const origin = new URL(request.url).origin;
  const session = await createPortalSession(user.stripe_customer_id, `${origin}/`);
  return Response.json({ url: session.url });
}
