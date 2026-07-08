import { SESSION_COOKIE, clearedCookie, requestOrigin } from "@/lib/server/auth";

export const runtime = "nodejs";

/**
 * Local sign-out: drop the session cookie and go home. (Ending the Keycloak
 * SSO session too is a later refinement — the app session is what gates
 * credits and generation.)
 */
export async function GET(request: Request): Promise<Response> {
  const origin = requestOrigin(request);
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${origin}/`,
      "Set-Cookie": clearedCookie(SESSION_COOKIE, origin.startsWith("https:")),
    },
  });
}
