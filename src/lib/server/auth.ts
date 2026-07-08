import "server-only";
import { upsertUser, type User } from "./db";
import { verifyIdToken } from "./oidc";

/**
 * Session handling for authenticated routes. The session cookie carries the
 * Keycloak ID token; every authenticated request re-verifies it, finds or
 * creates the internal user, and refreshes their last-activity timestamp.
 */

export const SESSION_COOKIE = "dg_session";
export const STATE_COOKIE = "dg_oauth_state";

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) {
      return decodeURIComponent(pair.slice(eq + 1).trim());
    }
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function clearedCookie(name: string, secure: boolean): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function stateCookie(state: string, secure: boolean): string {
  return `${STATE_COOKIE}=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}`;
}

/**
 * Authenticate a request from its session cookie. Returns the internal user
 * (created on first sign-in, activity refreshed on every visit) or null.
 */
export async function authenticateRequest(request: Request): Promise<User | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  try {
    const claims = await verifyIdToken(token);
    return await upsertUser(claims.sub, claims.email, claims.name);
  } catch {
    return null;
  }
}

/**
 * The shared route guard: the authenticated user, or the 401 response the
 * route should return as-is (mirrors the maintenanceGuard pattern).
 */
export async function requireUser(request: Request): Promise<User | Response> {
  const user = await authenticateRequest(request);
  return user ?? Response.json({ error: "unauthenticated" }, { status: 401 });
}
