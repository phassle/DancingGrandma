import { expect } from "vitest";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { POST as grantDevCredits } from "@/app/api/dev/credits/route";

/**
 * Shared session helpers for the route-handler integration tests.
 *
 * The token value is opaque to the routes; the faked verifier maps any token
 * to whatever claims it is programmed with. Encoding the sub in the token
 * lets multi-user tests switch identity per request.
 */
export function cookieFor(sub: string): { cookie: string } {
  return { cookie: `${SESSION_COOKIE}=token-${sub}` };
}

/** Seed a wallet through the dev-credits route (admin-adjustment ledger entry). */
export async function seedCredits(sub: string, amount: number): Promise<void> {
  const res = await grantDevCredits(
    new Request("http://localhost/api/dev/credits", {
      method: "POST",
      headers: { ...cookieFor(sub), "content-type": "application/json" },
      body: JSON.stringify({ amount }),
    }),
  );
  expect(res.status).toBe(200);
}
