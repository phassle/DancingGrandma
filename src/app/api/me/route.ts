import { requireUser } from "@/lib/server/auth";
import { getWallet } from "@/lib/server/db";

export const runtime = "nodejs";

/**
 * Who am I and what can I spend? The authenticated balance route: rejects
 * anonymous calls, returns the signed-in user and their wallet's available
 * and reserved credits (both 0 for a fresh account).
 */
export async function GET(request: Request): Promise<Response> {
  const user = await requireUser(request);
  if (user instanceof Response) return user;
  const wallet = await getWallet(user.id);
  return Response.json({
    user: { id: user.id, email: user.email, displayName: user.display_name },
    wallet,
  });
}
