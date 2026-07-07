import "server-only";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * Keycloak OIDC client boundary (PRD #54). This module is the *only* place
 * that talks to Keycloak — tests fake it here (`vi.mock("@/lib/server/oidc")`)
 * and exercise everything behind it for real.
 *
 * Keycloak's subject claim is the external identity; the internal user id
 * stays the business key. No passwords ever touch app tables.
 */

const REALM = "dancinggrandma";
const CLIENT_ID = "web";

export type IdentityClaims = {
  /** Keycloak subject claim — the user's external identity. */
  sub: string;
  email?: string;
  name?: string;
};

export function keycloakBaseUrl(): string {
  // Aspire service discovery (WithReference(keycloak)) injects the endpoint;
  // KEYCLOAK_URL is the manual override outside `aspire run`.
  const url =
    process.env.services__keycloak__http__0 ??
    process.env.services__keycloak__https__0 ??
    process.env.KEYCLOAK_URL;
  if (!url) {
    throw new Error("Keycloak endpoint is not set — run the app via `aspire run`");
  }
  return url.replace(/\/+$/, "");
}

function realmUrl(): string {
  return `${keycloakBaseUrl()}/realms/${REALM}`;
}

function clientSecret(): string {
  // Dev-only default matches keycloak/realms/dancinggrandma-realm.json.
  return process.env.KEYCLOAK_CLIENT_SECRET ?? "dev-only-secret-change-in-cloud";
}

/** Where to send the browser to sign in or register. */
export function authorizationUrl(redirectUri: string, state: string): string {
  const url = new URL(`${realmUrl()}/protocol/openid-connect/auth`);
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

/** Back-channel code exchange; returns the ID token that becomes the session. */
export async function exchangeCodeForIdToken(code: string, redirectUri: string): Promise<string> {
  const res = await fetch(`${realmUrl()}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: clientSecret(),
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    throw new Error(`Keycloak token exchange failed (${res.status})`);
  }
  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) {
    throw new Error("Keycloak token response did not include an id_token");
  }
  return body.id_token;
}

let jwks: JWTVerifyGetKey | undefined;

function keySet(): JWTVerifyGetKey {
  jwks ??= createRemoteJWKSet(new URL(`${realmUrl()}/protocol/openid-connect/certs`));
  return jwks;
}

/**
 * Verify a session's ID token signature, issuer, audience, and expiry against
 * Keycloak's published keys. Throws when the token does not verify.
 */
export async function verifyIdToken(token: string): Promise<IdentityClaims> {
  const { payload } = await jwtVerify(token, keySet(), {
    issuer: realmUrl(),
    audience: CLIENT_ID,
  });
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("ID token is missing a subject claim");
  }
  return {
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    name:
      typeof payload.name === "string"
        ? payload.name
        : typeof payload.preferred_username === "string"
          ? payload.preferred_username
          : undefined,
  };
}
