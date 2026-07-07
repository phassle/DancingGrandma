// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { TestPostgres } from "@/test/postgres";
import { startTestPostgres } from "@/test/postgres";

const oidcMocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
}));

vi.mock("@/lib/server/oidc", () => ({ verifyIdToken: oidcMocks.verifyIdToken }));

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
  oidcMocks.verifyIdToken.mockResolvedValue({ sub: "kc-sub-1", email: "grandma@example.com" });
});

function subscriptionRequest(sessionToken?: string): Request {
  return new Request("http://localhost:3000/api/billing/subscription", {
    headers: sessionToken ? { cookie: `dg_session=${sessionToken}` } : {},
  });
}

test("rejects unauthenticated calls", async () => {
  const res = await GET(subscriptionRequest());
  expect(res.status).toBe(401);
});

test("a user who never checked out sees no subscription and an empty wallet", async () => {
  const res = await GET(subscriptionRequest("valid-token"));
  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toEqual({
    subscription: null,
    wallet: { available: 0, reserved: 0 },
  });
});

test("while the webhook has not landed, the success page sees pending — never credits", async () => {
  const first = await (await GET(subscriptionRequest("valid-token"))).json();
  await getPool().query(
    `insert into subscriptions (user_id, stripe_checkout_session_id) values ($1, 'cs_1')`,
    [first.user?.id ?? (await userIdOf("kc-sub-1"))],
  );

  const res = await GET(subscriptionRequest("valid-token"));
  await expect(res.json()).resolves.toEqual({
    subscription: { status: "pending" },
    wallet: { available: 0, reserved: 0 },
  });
});

test("once fulfillment lands, the same poll reports active and the granted credits", async () => {
  await GET(subscriptionRequest("valid-token"));
  const uid = await userIdOf("kc-sub-1");
  await getPool().query(
    `insert into subscriptions (user_id, stripe_subscription_id, status)
     values ($1, 'sub_1', 'active')`,
    [uid],
  );
  await getPool().query(
    `insert into credit_ledger (user_id, entry_type, available_delta, reserved_delta)
     values ($1, 'subscription_period_grant', 5, 0)`,
    [uid],
  );
  await getPool().query(`update credit_wallets set available = 5 where user_id = $1`, [uid]);

  const res = await GET(subscriptionRequest("valid-token"));
  await expect(res.json()).resolves.toEqual({
    subscription: { status: "active" },
    wallet: { available: 5, reserved: 0 },
  });
});

test("a live subscription wins over an older canceled one", async () => {
  await GET(subscriptionRequest("valid-token"));
  const uid = await userIdOf("kc-sub-1");
  await getPool().query(
    `insert into subscriptions (user_id, stripe_subscription_id, status, created_at)
     values ($1, 'sub_old', 'canceled', now() - interval '60 days'),
            ($1, 'sub_new', 'active', now() - interval '90 days')`,
    [uid],
  );

  const res = await GET(subscriptionRequest("valid-token"));
  const body = await res.json();
  expect(body.subscription).toEqual({ status: "active" });
});

async function userIdOf(externalId: string): Promise<string> {
  const { rows } = await getPool().query(`select id from users where external_id = $1`, [
    externalId,
  ]);
  return rows[0].id;
}
