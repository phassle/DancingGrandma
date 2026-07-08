// @vitest-environment node
import { beforeEach, expect, test } from "vitest";
import { GET } from "./route";

beforeEach(() => {
  process.env.services__keycloak__http__0 = "http://localhost:8080";
});

test("redirects to the Keycloak authorization endpoint with a state cookie", async () => {
  const res = await GET(new Request("http://localhost:3000/api/auth/login"));

  expect(res.status).toBe(307);
  const location = new URL(res.headers.get("Location")!);
  expect(location.origin).toBe("http://localhost:8080");
  expect(location.pathname).toBe("/realms/dancinggrandma/protocol/openid-connect/auth");
  expect(location.searchParams.get("client_id")).toBe("web");
  expect(location.searchParams.get("response_type")).toBe("code");
  expect(location.searchParams.get("scope")).toBe("openid email profile");
  expect(location.searchParams.get("redirect_uri")).toBe(
    "http://localhost:3000/api/auth/callback",
  );

  const state = location.searchParams.get("state");
  expect(state).toBeTruthy();
  expect(res.headers.get("Set-Cookie")).toContain(`dg_oauth_state=${state}`);
  expect(res.headers.get("Set-Cookie")).toContain("HttpOnly");
});
