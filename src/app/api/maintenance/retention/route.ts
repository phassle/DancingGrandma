import { runRetentionSweep } from "@/lib/server/retention";
import { maintenanceGuard } from "../guard";

export const runtime = "nodejs";

/**
 * The retention sweep (issue #60, PRD #54), for an operator or scheduled
 * job: expires unused credits of users inactive for 90+ days via explicit
 * credit_expiration ledger entries (reserved credits are never touched) and
 * purges source-photo bytes left behind on terminal generations.
 */
export async function POST(request: Request): Promise<Response> {
  const denied = maintenanceGuard(request);
  if (denied) return denied;
  return Response.json(await runRetentionSweep());
}
