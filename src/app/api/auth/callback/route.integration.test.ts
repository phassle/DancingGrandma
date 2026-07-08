// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { TestPostgres } from "@/test/postgres";
import { startTestPostgres } from "@/test/postgres";

// Keycloak (code exchange + token verification) is the faked boundary; user
// creation and the wallet run for real against a test Postgres.
const oidcMocks = vi.hoisted(() => ({
  exchangeCodeForIdToken: vi.fn(),
  verifyIdToken: vi.fn(),
}));

vi.mock("@/lib/server/oidc", () => ({
  exchangeCodeForIdToken: oidcMocks.exchangeCodeForIdToken,
  verifyIdToken: oidcMocks.verifyIdToken,
}));

import { GET } from "./route";
import { closePool, getPool } from "@/lib/server/db";

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startTestPostgres();
  process.env.ConnectionStrings__grandmadb = pg.connectionString;
}, 120_000);

afterAll(async () => {
  await closePool();
  await pg.stop();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await getPool().query("truncate users cascade");
});

function callbackRequest(params: { code?: string; state?: string; stateCookie?: string }): Request {
  const url = new URL("http://localhost:3000/api/auth/callback");
  if (params.code) url.searchParams.set("code", params.code);
  if (params.state) url.searchParams.set("state", params.state);
  return new Request(url, {
    headers: params.stateCookie ? { cookie: `dg_oauth_state=${params.stateCookie}` } : {},
  });
}

test("signs the visitor in: creates the user, sets the session, lands in the studio", async () => {
  oidcMocks.exchangeCodeForIdToken.mockResolvedValue("keycloak-id-token");
  oidcMocks.verifyIdToken.mockResolvedValue({
    sub: "kc-sub-9",
    email: "grandma@example.com",
    name: "Dancing Grandma",
  });

  const res = await GET(callbackRequest({ code: "auth-code", state: "xyz", stateCookie: "xyz" }));

  expect(res.status).toBe(303);
  expect(res.headers.get("Location")).toBe("http://localhost:3000/#studio");
  expect(oidcMocks.exchangeCodeForIdToken).toHaveBeenCalledWith(
    "auth-code",
    "http://localhost:3000/api/auth/callback",
  );

  const cookies = res.headers.getSetCookie();
  expect(cookies.some((c) => c.startsWith("dg_session=keycloak-id-token") && c.includes("HttpOnly"))).toBe(true);
  expect(cookies.some((c) => c.startsWith("dg_oauth_state=;"))).toBe(true);

  const { rows } = await getPool().query(
    `select u.external_id, u.email, w.available, w.reserved
     from users u join credit_wallets w on w.user_id = u.id`,
  );
  expect(rows).toEqual([
    { external_id: "kc-sub-9", email: "grandma@example.com", available: 0, reserved: 0 },
  ]);
});

test("rejects a state mismatch without creating anything", async () => {
  const res = await GET(
    callbackRequest({ code: "auth-code", state: "forged", stateCookie: "expected" }),
  );

  expect(res.status).toBe(400);
  expect(oidcMocks.exchangeCodeForIdToken).not.toHaveBeenCalled();
  const { rows } = await getPool().query(`select count(*)::int as n from users`);
  expect(rows[0].n).toBe(0);
});

test("rejects a callback without a code", async () => {
  const res = await GET(callbackRequest({ state: "xyz", stateCookie: "xyz" }));
  expect(res.status).toBe(400);
  expect(oidcMocks.exchangeCodeForIdToken).not.toHaveBeenCalled();
});
