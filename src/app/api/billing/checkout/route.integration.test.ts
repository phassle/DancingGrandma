// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { TestPostgres } from "@/test/postgres";
import { startTestPostgres } from "@/test/postgres";

// Faked external boundaries: identity token verification and the Stripe SDK.
// Route handler, auth, and billing SQL run for real against a test Postgres.
const oidcMocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
}));
const stripeMocks = vi.hoisted(() => ({
  createStripeCustomer: vi.fn(),
  createSubscriptionCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  constructWebhookEvent: vi.fn(),
}));

vi.mock("@/lib/server/oidc", () => ({ verifyIdToken: oidcMocks.verifyIdToken }));
vi.mock("@/lib/server/stripe", () => stripeMocks);

import { POST } from "./route";
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
  oidcMocks.verifyIdToken.mockResolvedValue({
    sub: "kc-sub-1",
    email: "grandma@example.com",
    name: "Dancing Grandma",
  });
  stripeMocks.createStripeCustomer.mockResolvedValue("cus_test_1");
  stripeMocks.createSubscriptionCheckoutSession.mockResolvedValue({
    id: "cs_test_1",
    url: "https://checkout.stripe.com/c/pay/cs_test_1",
  });
});

function checkoutRequest(sessionToken?: string): Request {
  return new Request("http://localhost:3000/api/billing/checkout", {
    method: "POST",
    headers: sessionToken ? { cookie: `dg_session=${sessionToken}` } : {},
  });
}

test("rejects unauthenticated calls", async () => {
  const res = await POST(checkoutRequest());
  expect(res.status).toBe(401);
  expect(stripeMocks.createSubscriptionCheckoutSession).not.toHaveBeenCalled();
});

test("creates a Stripe customer, records a pending subscription, and returns the hosted checkout url", async () => {
  const res = await POST(checkoutRequest("valid-token"));

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toEqual({
    url: "https://checkout.stripe.com/c/pay/cs_test_1",
  });

  // The Stripe customer id is stored on the user.
  const { rows: users } = await getPool().query(
    `select id, stripe_customer_id from users where external_id = 'kc-sub-1'`,
  );
  expect(users[0].stripe_customer_id).toBe("cus_test_1");
  expect(stripeMocks.createStripeCustomer).toHaveBeenCalledWith({
    userId: users[0].id,
    email: "grandma@example.com",
    name: "Dancing Grandma",
  });

  // A pending subscription row exists, linked to the checkout session.
  const { rows: subs } = await getPool().query(
    `select user_id, stripe_subscription_id, stripe_checkout_session_id, status from subscriptions`,
  );
  expect(subs).toEqual([
    {
      user_id: users[0].id,
      stripe_subscription_id: null,
      stripe_checkout_session_id: "cs_test_1",
      status: "pending",
    },
  ]);

  // The session was created with the internal ids in metadata and an
  // idempotency anchor (the subscription row id), pointing back at the app.
  expect(stripeMocks.createSubscriptionCheckoutSession).toHaveBeenCalledTimes(1);
  const opts = stripeMocks.createSubscriptionCheckoutSession.mock.calls[0][0];
  expect(opts.customerId).toBe("cus_test_1");
  expect(opts.userId).toBe(users[0].id);
  expect(opts.subscriptionRowId).toMatch(/^[0-9a-f-]{36}$/);
  expect(opts.successUrl).toBe("http://localhost:3000/billing/success");
  expect(opts.cancelUrl).toBe("http://localhost:3000/");
});

test("reuses an existing Stripe customer instead of creating a new one", async () => {
  await POST(checkoutRequest("valid-token"));
  await getPool().query(`delete from subscriptions`);

  const res = await POST(checkoutRequest("valid-token"));

  expect(res.status).toBe(200);
  expect(stripeMocks.createStripeCustomer).toHaveBeenCalledTimes(1);
  const opts = stripeMocks.createSubscriptionCheckoutSession.mock.calls[1][0];
  expect(opts.customerId).toBe("cus_test_1");
});

test("refuses checkout while a subscription is already active", async () => {
  const first = await POST(checkoutRequest("valid-token"));
  expect(first.status).toBe(200);
  await getPool().query(
    `update subscriptions set status = 'active', stripe_subscription_id = 'sub_live'`,
  );

  const res = await POST(checkoutRequest("valid-token"));

  expect(res.status).toBe(409);
  await expect(res.json()).resolves.toEqual({ error: "already_subscribed", status: "active" });
  expect(stripeMocks.createSubscriptionCheckoutSession).toHaveBeenCalledTimes(1);
});

test("a canceled subscription does not block starting a new one", async () => {
  await POST(checkoutRequest("valid-token"));
  await getPool().query(
    `update subscriptions set status = 'canceled', stripe_subscription_id = 'sub_old'`,
  );
  stripeMocks.createSubscriptionCheckoutSession.mockResolvedValue({
    id: "cs_test_2",
    url: "https://checkout.stripe.com/c/pay/cs_test_2",
  });

  const res = await POST(checkoutRequest("valid-token"));

  expect(res.status).toBe(200);
  const { rows } = await getPool().query(
    `select status from subscriptions order by created_at`,
  );
  expect(rows.map((r) => r.status)).toEqual(["canceled", "pending"]);
});
