import { stateCookie } from "@/lib/server/auth";
import { authorizationUrl } from "@/lib/server/oidc";

export const runtime = "nodejs";

/**
 * Kick off sign-in/registration: send the browser to Keycloak with a fresh
 * anti-CSRF state, remembered in a short-lived cookie for the callback.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const state = crypto.randomUUID();
  const redirectUri = `${url.origin}/api/auth/callback`;

  return new Response(null, {
    status: 307,
    headers: {
      Location: authorizationUrl(redirectUri, state),
      "Set-Cookie": stateCookie(state, url.protocol === "https:"),
    },
  });
}
