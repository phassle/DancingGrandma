// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { TestPostgres } from "@/test/postgres";
import { startTestPostgres } from "@/test/postgres";

// Identity token verification is the faked external boundary — everything
// else (route handler, auth, db) runs for real against a test Postgres.
const oidcMocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
}));

vi.mock("@/lib/server/oidc", () => ({
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

function meRequest(sessionToken?: string): Request {
  return new Request("http://localhost/api/me", {
    headers: sessionToken ? { cookie: `dg_session=${sessionToken}` } : {},
  });
}

test("rejects unauthenticated calls", async () => {
  const res = await GET(meRequest());
  expect(res.status).toBe(401);
  expect(oidcMocks.verifyIdToken).not.toHaveBeenCalled();
});

test("rejects calls whose session token does not verify", async () => {
  oidcMocks.verifyIdToken.mockRejectedValue(new Error("bad signature"));
  const res = await GET(meRequest("tampered-token"));
  expect(res.status).toBe(401);
});

test("first sign-in creates the user and an empty wallet", async () => {
  oidcMocks.verifyIdToken.mockResolvedValue({
    sub: "kc-sub-1",
    email: "grandma@example.com",
    name: "Dancing Grandma",
  });

  const res = await GET(meRequest("valid-token"));

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({
    user: {
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      email: "grandma@example.com",
      displayName: "Dancing Grandma",
    },
    wallet: { available: 0, reserved: 0 },
  });

  const { rows } = await getPool().query(
    `select u.external_id, w.available, w.reserved
     from users u join credit_wallets w on w.user_id = u.id`,
  );
  expect(rows).toEqual([{ external_id: "kc-sub-1", available: 0, reserved: 0 }]);
});

test("repeat visits reuse the same user and refresh last_activity_at", async () => {
  oidcMocks.verifyIdToken.mockResolvedValue({ sub: "kc-sub-1", email: "grandma@example.com" });

  const first = await (await GET(meRequest("valid-token"))).json();
  await getPool().query(`update users set last_activity_at = now() - interval '30 days'`);

  const second = await (await GET(meRequest("valid-token"))).json();

  expect(second.user.id).toBe(first.user.id);
  const { rows } = await getPool().query(
    `select count(*)::int as users,
            min(extract(epoch from now() - last_activity_at))::int as age_seconds
     from users`,
  );
  expect(rows[0].users).toBe(1);
  expect(rows[0].age_seconds).toBeLessThan(60);
});

test("balance reflects the wallet row, not the legacy ledger view", async () => {
  oidcMocks.verifyIdToken.mockResolvedValue({ sub: "kc-sub-1" });
  const first = await (await GET(meRequest("valid-token"))).json();

  await getPool().query(
    `insert into credit_ledger (user_id, entry_type, available_delta, reserved_delta)
     values ($1, 'subscription_period_grant', 5, 0)`,
    [first.user.id],
  );
  await getPool().query(`update credit_wallets set available = 5 where user_id = $1`, [
    first.user.id,
  ]);

  const res = await GET(meRequest("valid-token"));
  await expect(res.json()).resolves.toMatchObject({ wallet: { available: 5, reserved: 0 } });
});

test("wallet available and reserved balances can never go negative", async () => {
  oidcMocks.verifyIdToken.mockResolvedValue({ sub: "kc-sub-1" });
  const { user } = await (await GET(meRequest("valid-token"))).json();

  await expect(
    getPool().query(`update credit_wallets set available = -1 where user_id = $1`, [user.id]),
  ).rejects.toThrow(/check constraint/);
  await expect(
    getPool().query(`update credit_wallets set reserved = -1 where user_id = $1`, [user.id]),
  ).rejects.toThrow(/check constraint/);
});

test("credit ledger rows can never be updated or deleted", async () => {
  oidcMocks.verifyIdToken.mockResolvedValue({ sub: "kc-sub-1" });
  const { user } = await (await GET(meRequest("valid-token"))).json();

  await getPool().query(
    `insert into credit_ledger (user_id, entry_type, available_delta, reserved_delta)
     values ($1, 'subscription_period_grant', 5, 0)`,
    [user.id],
  );

  await expect(
    getPool().query(`update credit_ledger set available_delta = 500`),
  ).rejects.toThrow(/append-only/);
  await expect(getPool().query(`delete from credit_ledger`)).rejects.toThrow(/append-only/);
});
