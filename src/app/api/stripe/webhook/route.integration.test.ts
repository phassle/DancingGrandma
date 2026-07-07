// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { TestPostgres } from "@/test/postgres";
import { startTestPostgres } from "@/test/postgres";

// The Stripe SDK is the faked external boundary (signature verification
// included); everything behind it — event application, subscription state,
// grants, ledger, wallet — runs for real against a test Postgres.
const stripeMocks = vi.hoisted(() => ({
  createStripeCustomer: vi.fn(),
  createSubscriptionCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  constructWebhookEvent: vi.fn(),
}));

vi.mock("@/lib/server/stripe", () => stripeMocks);

import { POST } from "./route";
import { closePool, getPool } from "@/lib/server/db";

let pg: TestPostgres;
let userId: string;
let eventSeq = 0;

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
  const pool = getPool();
  await pool.query("truncate users cascade");
  await pool.query("truncate stripe_webhook_events");
  const { rows } = await pool.query(
    `insert into users (external_id, email, stripe_customer_id)
     values ('kc-sub-1', 'grandma@example.com', 'cus_test_1') returning id`,
  );
  userId = rows[0].id;
  await pool.query(`insert into credit_wallets (user_id) values ($1)`, [userId]);
});

/** POST the event to the webhook route as Stripe would deliver it. */
async function deliver(event: {
  id?: string;
  type: string;
  data: { object: Record<string, unknown> };
}): Promise<Response> {
  const withId = { id: event.id ?? `evt_${++eventSeq}`, ...event };
  stripeMocks.constructWebhookEvent.mockResolvedValueOnce(withId);
  return POST(
    new Request("http://localhost:3000/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=sig" },
      body: JSON.stringify(withId),
    }),
  );
}

async function createPendingCheckout(sessionId = "cs_1"): Promise<string> {
  const { rows } = await getPool().query(
    `insert into subscriptions (user_id, stripe_checkout_session_id)
     values ($1, $2) returning id`,
    [userId, sessionId],
  );
  return rows[0].id;
}

function checkoutCompleted(sessionId = "cs_1", subscription = "sub_1") {
  return {
    type: "checkout.session.completed",
    data: { object: { id: sessionId, subscription, metadata: { user_id: userId } } },
  };
}

function invoicePaid(invoiceId = "in_1", subscription = "sub_1") {
  return {
    type: "invoice.paid",
    data: {
      object: {
        id: invoiceId,
        customer: "cus_test_1",
        parent: {
          subscription_details: { subscription, metadata: { user_id: userId } },
        },
      },
    },
  };
}

async function snapshot() {
  const pool = getPool();
  const subs = (
    await pool.query(
      `select stripe_subscription_id, stripe_checkout_session_id, status
       from subscriptions order by created_at`,
    )
  ).rows;
  const wallet = (
    await pool.query(`select available, reserved from credit_wallets where user_id = $1`, [userId])
  ).rows[0];
  const ledger = (
    await pool.query(
      `select entry_type, available_delta from credit_ledger where user_id = $1 order by id`,
      [userId],
    )
  ).rows;
  return { subs, wallet, ledger };
}

test("rejects a payload whose signature does not verify, without recording anything", async () => {
  stripeMocks.constructWebhookEvent.mockRejectedValueOnce(new Error("bad signature"));
  const res = await POST(
    new Request("http://localhost:3000/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=forged" },
      body: "{}",
    }),
  );
  expect(res.status).toBe(400);
  const { rows } = await getPool().query(`select count(*)::int as n from stripe_webhook_events`);
  expect(rows[0].n).toBe(0);
});

test("rejects a payload with no signature header at all", async () => {
  const res = await POST(
    new Request("http://localhost:3000/api/stripe/webhook", { method: "POST", body: "{}" }),
  );
  expect(res.status).toBe(400);
  expect(stripeMocks.constructWebhookEvent).not.toHaveBeenCalled();
});

test("paid subscription invoice marks the subscription active and grants exactly 5 credits", async () => {
  await createPendingCheckout();
  expect((await deliver(checkoutCompleted())).status).toBe(200);
  expect((await deliver(invoicePaid())).status).toBe(200);

  const { subs, wallet, ledger } = await snapshot();
  expect(subs).toEqual([
    { stripe_subscription_id: "sub_1", stripe_checkout_session_id: "cs_1", status: "active" },
  ]);
  expect(wallet).toEqual({ available: 5, reserved: 0 });
  expect(ledger).toEqual([{ entry_type: "subscription_period_grant", available_delta: 5 }]);
});

test("replaying the same event id grants nothing more", async () => {
  await createPendingCheckout();
  await deliver(checkoutCompleted());
  const paid = { id: "evt_replay", ...invoicePaid() };

  expect((await deliver(paid)).status).toBe(200);
  expect((await deliver(paid)).status).toBe(200);
  expect((await deliver(paid)).status).toBe(200);

  const { wallet, ledger } = await snapshot();
  expect(wallet).toEqual({ available: 5, reserved: 0 });
  expect(ledger).toHaveLength(1);
});

test("two distinct events for the same invoice still grant only once", async () => {
  await createPendingCheckout();
  await deliver(checkoutCompleted());

  await deliver({ id: "evt_a", ...invoicePaid("in_1") });
  const succeeded = invoicePaid("in_1");
  succeeded.type = "invoice.payment_succeeded";
  await deliver({ id: "evt_b", ...succeeded });

  const { wallet } = await snapshot();
  expect(wallet).toEqual({ available: 5, reserved: 0 });
});

test("out-of-order delivery — invoice.paid before checkout.session.completed — converges", async () => {
  await createPendingCheckout();

  expect((await deliver(invoicePaid())).status).toBe(200);
  expect((await deliver(checkoutCompleted())).status).toBe(200);

  const { subs, wallet } = await snapshot();
  expect(subs).toEqual([
    { stripe_subscription_id: "sub_1", stripe_checkout_session_id: "cs_1", status: "active" },
  ]);
  expect(wallet).toEqual({ available: 5, reserved: 0 });
});

test("each new paid billing period grants 5 more credits", async () => {
  await createPendingCheckout();
  await deliver(checkoutCompleted());
  await deliver(invoicePaid("in_1"));
  await deliver(invoicePaid("in_2"));

  const { wallet, ledger } = await snapshot();
  expect(wallet).toEqual({ available: 10, reserved: 0 });
  expect(ledger.map((l: { available_delta: number }) => l.available_delta)).toEqual([5, 5]);
});

test("failed renewal marks the subscription past due without touching the wallet", async () => {
  await createPendingCheckout();
  await deliver(checkoutCompleted());
  await deliver(invoicePaid());

  const failed = {
    type: "invoice.payment_failed",
    data: {
      object: {
        id: "in_2",
        customer: "cus_test_1",
        parent: { subscription_details: { subscription: "sub_1", metadata: {} } },
      },
    },
  };
  expect((await deliver(failed)).status).toBe(200);

  const { subs, wallet } = await snapshot();
  expect(subs[0].status).toBe("past_due");
  expect(wallet).toEqual({ available: 5, reserved: 0 });
});

test("cancellation stops future state changes but never revokes granted credits", async () => {
  await createPendingCheckout();
  await deliver(checkoutCompleted());
  await deliver(invoicePaid());

  const deleted = {
    type: "customer.subscription.deleted",
    data: { object: { id: "sub_1", customer: "cus_test_1" } },
  };
  expect((await deliver(deleted)).status).toBe(200);

  const { subs, wallet } = await snapshot();
  expect(subs[0].status).toBe("canceled");
  expect(wallet).toEqual({ available: 5, reserved: 0 });
});

test("a late paid event after cancellation still grants but does not resurrect the subscription", async () => {
  await createPendingCheckout();
  await deliver(checkoutCompleted());
  await deliver({
    type: "customer.subscription.deleted",
    data: { object: { id: "sub_1", customer: "cus_test_1" } },
  });

  await deliver(invoicePaid("in_final"));

  const { subs, wallet } = await snapshot();
  expect(subs[0].status).toBe("canceled");
  expect(wallet).toEqual({ available: 5, reserved: 0 });
});

test("wallet, ledger, and reconciliation view agree after a burst of duplicate and out-of-order events", async () => {
  await createPendingCheckout();
  await deliver(invoicePaid("in_1"));
  await deliver({ id: "evt_dup", ...invoicePaid("in_1") });
  await deliver({ id: "evt_dup", ...invoicePaid("in_1") });
  await deliver(checkoutCompleted());
  await deliver(invoicePaid("in_2"));

  const { wallet } = await snapshot();
  const { rows } = await getPool().query(
    `select ledger_available, ledger_reserved from credit_wallet_reconciliation where user_id = $1`,
    [userId],
  );
  expect(wallet).toEqual({ available: 10, reserved: 0 });
  expect(rows[0]).toEqual({ ledger_available: 10, ledger_reserved: 0 });
});

test("unhandled event types are acknowledged and recorded, changing nothing", async () => {
  const res = await deliver({
    type: "customer.updated",
    data: { object: { id: "cus_test_1" } },
  });
  expect(res.status).toBe(200);
  const { rows } = await getPool().query(`select count(*)::int as n from stripe_webhook_events`);
  expect(rows[0].n).toBe(1);
});
