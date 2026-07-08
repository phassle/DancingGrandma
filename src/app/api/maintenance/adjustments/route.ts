import {
  adjustCredits,
  InsufficientCreditsError,
  WalletNotFoundError,
  type AdjustmentEntryType,
} from "@/lib/server/db";
import { maintenanceGuard } from "../guard";
import { isShareId } from "@/lib/share-id";

export const runtime = "nodejs";

/**
 * Support corrections (issue #60, PRD #54 story 28): admin adjustments and
 * refund reversals are always new compensating ledger entries — history is
 * never mutated. Positive admin adjustments grant, negative ones claw back;
 * a refund reversal must remove credits and can never drive the wallet
 * negative.
 */

const ENTRY_TYPES: AdjustmentEntryType[] = ["admin_adjustment", "refund_reversal"];

export async function POST(request: Request): Promise<Response> {
  const denied = maintenanceGuard(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as {
    userId?: unknown;
    amount?: unknown;
    entryType?: unknown;
    note?: unknown;
  } | null;
  if (!body || typeof body.userId !== "string") {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }
  const { amount, entryType } = body;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount === 0) {
    return Response.json({ error: "amount must be a nonzero integer" }, { status: 400 });
  }
  if (!ENTRY_TYPES.includes(entryType as AdjustmentEntryType)) {
    return Response.json(
      { error: "entryType must be admin_adjustment or refund_reversal" },
      { status: 400 },
    );
  }
  if (entryType === "refund_reversal" && amount > 0) {
    return Response.json({ error: "a refund reversal must remove credits" }, { status: 400 });
  }
  if (!isShareId(body.userId)) {
    return Response.json({ error: "user not found" }, { status: 404 });
  }
  const note = typeof body.note === "string" && body.note ? body.note : "support adjustment";

  try {
    const wallet = await adjustCredits(body.userId, amount, entryType as AdjustmentEntryType, note);
    return Response.json({ wallet });
  } catch (err) {
    if (err instanceof WalletNotFoundError) {
      return Response.json({ error: "user not found" }, { status: 404 });
    }
    if (err instanceof InsufficientCreditsError) {
      return Response.json({ error: "insufficient_credits" }, { status: 409 });
    }
    throw err;
  }
}
