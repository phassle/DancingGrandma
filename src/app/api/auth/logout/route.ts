import { SESSION_COOKIE, clearedCookie } from "@/lib/server/auth";

export const runtime = "nodejs";

/**
 * Local sign-out: drop the session cookie and go home. (Ending the Keycloak
 * SSO session too is a later refinement — the app session is what gates
 * credits and generation.)
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${url.origin}/`,
      "Set-Cookie": clearedCookie(SESSION_COOKIE, url.protocol === "https:"),
    },
  });
}
