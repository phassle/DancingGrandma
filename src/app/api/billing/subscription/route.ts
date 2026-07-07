import { authenticateRequest } from "@/lib/server/auth";
import { getCurrentSubscription } from "@/lib/server/billing";
import { getWallet } from "@/lib/server/db";

export const runtime = "nodejs";

/**
 * Backend truth for the checkout success page (PRD #54, issue #56): the
 * page polls this until the webhook has really granted the credits. Client-
 * side checkout success is never trusted for fulfillment.
 */
export async function GET(request: Request): Promise<Response> {
  const user = await authenticateRequest(request);
  if (!user) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const [subscription, wallet] = await Promise.all([
    getCurrentSubscription(user.id),
    getWallet(user.id),
  ]);
  return Response.json({
    subscription: subscription ? { status: subscription.status } : null,
    wallet,
  });
}
