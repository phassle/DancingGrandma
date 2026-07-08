import { requireUser } from "@/lib/server/auth";
import { grantAdminCredits } from "@/lib/server/db";

export const runtime = "nodejs";

/**
 * Dev-only credit seeding (issue #57, PRD #54): grants credits to the
 * signed-in user with an explicit admin_adjustment ledger entry, so the
 * generation slice can be exercised before the Stripe slice (#56) lands.
 * Hidden in production — real credits come only from verified webhooks.
 */
export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const body = (await request.json().catch(() => ({}))) as { amount?: unknown };
  const amount = typeof body.amount === "number" ? body.amount : 5;
  if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
    return Response.json({ error: "amount must be an integer between 1 and 100" }, { status: 400 });
  }

  const wallet = await grantAdminCredits(user.id, amount, "dev seed");
  return Response.json({ wallet });
}
