// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { TestPostgres } from "@/test/postgres";
import { startTestPostgres } from "@/test/postgres";

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
  oidcMocks.verifyIdToken.mockResolvedValue({ sub: "kc-sub-1" });
  stripeMocks.createPortalSession.mockResolvedValue({
    url: "https://billing.stripe.com/p/session/test_1",
  });
});

function portalRequest(sessionToken?: string): Request {
  return new Request("http://localhost:3000/api/billing/portal", {
    method: "POST",
    headers: sessionToken ? { cookie: `dg_session=${sessionToken}` } : {},
  });
}

test("rejects unauthenticated calls", async () => {
  const res = await POST(portalRequest());
  expect(res.status).toBe(401);
  expect(stripeMocks.createPortalSession).not.toHaveBeenCalled();
});

test("a user who was never a Stripe customer has no portal to visit", async () => {
  const res = await POST(portalRequest("valid-token"));
  expect(res.status).toBe(409);
  await expect(res.json()).resolves.toEqual({ error: "no_stripe_customer" });
  expect(stripeMocks.createPortalSession).not.toHaveBeenCalled();
});

test("returns the Customer Portal url for a Stripe customer", async () => {
  const first = await POST(portalRequest("valid-token")); // creates the user
  expect(first.status).toBe(409);
  await getPool().query(`update users set stripe_customer_id = 'cus_test_1'`);

  const res = await POST(portalRequest("valid-token"));

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toEqual({
    url: "https://billing.stripe.com/p/session/test_1",
  });
  expect(stripeMocks.createPortalSession).toHaveBeenCalledWith(
    "cus_test_1",
    "http://localhost:3000/",
  );
});
