import {
  STATE_COOKIE,
  clearedCookie,
  readCookie,
  requestOrigin,
  sessionCookie,
} from "@/lib/server/auth";
import { upsertUser } from "@/lib/server/db";
import { exchangeCodeForIdToken, verifyIdToken } from "@/lib/server/oidc";

export const runtime = "nodejs";

/**
 * Keycloak sends the browser back here after sign-in/registration. Verify the
 * state, exchange the code, create/refresh the internal user and wallet, set
 * the session cookie, and land the visitor back in the studio.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const origin = requestOrigin(request);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = readCookie(request, STATE_COOKIE);
  const secure = origin.startsWith("https:");

  if (!code || !state || !expectedState || state !== expectedState) {
    return Response.json({ error: "invalid sign-in callback" }, { status: 400 });
  }

  const idToken = await exchangeCodeForIdToken(code, `${origin}/api/auth/callback`);
  const claims = await verifyIdToken(idToken);
  await upsertUser(claims.sub, claims.email, claims.name);

  const headers = new Headers({ Location: `${origin}/#studio` });
  headers.append("Set-Cookie", sessionCookie(idToken, secure));
  headers.append("Set-Cookie", clearedCookie(STATE_COOKIE, secure));
  return new Response(null, { status: 303, headers });
}
