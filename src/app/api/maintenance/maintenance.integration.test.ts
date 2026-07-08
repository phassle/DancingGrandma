// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { TestPostgres } from "@/test/postgres";
import { startTestPostgres } from "@/test/postgres";

/**
 * Route-handler tests for retention and expiration policies (issue #60,
 * PRD #54): 90-day credit expiry as explicit ledger entries, activity
 * refresh resetting the clock, admin adjustments / refund reversals as
 * compensating entries, and the sweep purging leftover terminal source
 * photos. Real test Postgres; identity verification, the provider client,
 * and blob storage are faked at their boundaries.
 */

const oidcMocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
}));
vi.mock("@/lib/server/oidc", () => ({
  verifyIdToken: oidcMocks.verifyIdToken,
}));

const providerMocks = vi.hoisted(() => ({
  uploadToProvider: vi.fn(),
  submitToProvider: vi.fn(),
  providerStatus: vi.fn(),
  providerResult: vi.fn(),
}));
vi.mock("@/lib/server/provider", () => providerMocks);

const blobMocks = vi.hoisted(() => ({
  saveVideoFromUrl: vi.fn(),
  saveSourcePhotoBytes: vi.fn(),
  deleteBlob: vi.fn(),
}));
vi.mock("@/lib/server/blob", () => blobMocks);

import { POST as runRetention } from "./retention/route";
import { POST as adjustRoute } from "./adjustments/route";
import { POST as startGeneration } from "../generations/route";
import { GET as getGeneration } from "../generations/[id]/route";
import { GET as whoAmI } from "../me/route";
import { POST as grantDevCredits } from "../dev/credits/route";
import { closePool, getPool } from "@/lib/server/db";

const TOKEN = "test-maintenance-token";

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
  process.env.MAINTENANCE_TOKEN = TOKEN;
  providerMocks.uploadToProvider.mockResolvedValue("https://fal.storage/photo.jpg");
  providerMocks.submitToProvider.mockResolvedValue({ requestId: "req-1" });
  providerMocks.providerStatus.mockResolvedValue("running");
  providerMocks.providerResult.mockResolvedValue("https://fal.output/dance.mp4");
  blobMocks.saveVideoFromUrl.mockImplementation(async (id: string) => `${id}.mp4`);
  blobMocks.saveSourcePhotoBytes.mockImplementation(async (id: string) => `sources/${id}`);
  blobMocks.deleteBlob.mockResolvedValue(undefined);
  oidcMocks.verifyIdToken.mockImplementation(async (token: string) => ({
    sub: token.replace(/^token-/, ""),
  }));
  await getPool().query("truncate users cascade");
});

function cookieFor(sub: string): { cookie: string } {
  return { cookie: `dg_session=token-${sub}` };
}

async function seedUserWithCredits(sub: string, amount: number): Promise<void> {
  const res = await grantDevCredits(
    new Request("http://localhost/api/dev/credits", {
      method: "POST",
      headers: { ...cookieFor(sub), "content-type": "application/json" },
      body: JSON.stringify({ amount }),
    }),
  );
  expect(res.status).toBe(200);
}

async function setLastActivityDaysAgo(sub: string, days: number): Promise<void> {
  await getPool().query(
    `update users set last_activity_at = now() - make_interval(days => $2)
     where external_id = $1`,
    [sub, days],
  );
}

async function userIdOf(sub: string): Promise<string> {
  const { rows } = await getPool().query(`select id from users where external_id = $1`, [sub]);
  return rows[0].id;
}

async function wallet(sub: string): Promise<{ available: number; reserved: number }> {
  const { rows } = await getPool().query(
    `select w.available, w.reserved from credit_wallets w
     join users u on u.id = w.user_id where u.external_id = $1`,
    [sub],
  );
  return rows[0];
}

async function ledgerEntries(
  sub: string,
): Promise<{ entry_type: string; available_delta: number; reserved_delta: number }[]> {
  const { rows } = await getPool().query(
    `select l.entry_type, l.available_delta, l.reserved_delta from credit_ledger l
     join users u on u.id = l.user_id where u.external_id = $1 order by l.id`,
    [sub],
  );
  return rows;
}

function retentionRequest(token?: string): Request {
  return new Request("http://localhost/api/maintenance/retention", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function adjustmentRequest(body: unknown, token: string | undefined = TOKEN): Request {
  return new Request("http://localhost/api/maintenance/adjustments", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function startRequest(sub: string): Request {
  const form = new FormData();
  form.set("photo", new File([new Uint8Array([1, 2, 3])], "grandma.jpg", { type: "image/jpeg" }));
  form.set("engineId", "wan-animate-fal");
  form.set("referenceUrl", "https://example.com/dance.mp4");
  form.set("referenceSourceKind", "direct_url");
  return new Request("http://localhost/api/generations", {
    method: "POST",
    headers: cookieFor(sub),
    body: form,
  });
}

// --- Route guarding ---------------------------------------------------------

test("maintenance routes require the maintenance token", async () => {
  expect((await runRetention(retentionRequest())).status).toBe(401);
  expect((await runRetention(retentionRequest("wrong-token"))).status).toBe(401);
  expect((await adjustRoute(adjustmentRequest({ userId: "x", amount: 1 }, "wrong-token"))).status).toBe(401);
});

test("maintenance routes are disabled when no token is configured", async () => {
  delete process.env.MAINTENANCE_TOKEN;
  expect((await runRetention(retentionRequest(TOKEN))).status).toBe(404);
  expect(
    (
      await adjustRoute(
        adjustmentRequest({ userId: "x", amount: 1, entryType: "admin_adjustment" }),
      )
    ).status,
  ).toBe(404);
});

// --- 90-day credit expiry ---------------------------------------------------

test("credits of a 90+ day inactive user expire via an explicit ledger entry", async () => {
  await seedUserWithCredits("sleeper", 5);
  await setLastActivityDaysAgo("sleeper", 91);

  const res = await runRetention(retentionRequest(TOKEN));

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({ expiredWallets: 1, expiredCredits: 5 });
  expect(await wallet("sleeper")).toEqual({ available: 0, reserved: 0 });
  expect(await ledgerEntries("sleeper")).toEqual([
    { entry_type: "admin_adjustment", available_delta: 5, reserved_delta: 0 },
    { entry_type: "credit_expiration", available_delta: -5, reserved_delta: 0 },
  ]);

  // The wallet projection and the ledger must agree after expiration.
  const { rows } = await getPool().query(
    `select r.ledger_available, r.ledger_reserved from credit_wallet_reconciliation r
     join users u on u.id = r.user_id where u.external_id = 'sleeper'`,
  );
  expect(rows[0]).toEqual({ ledger_available: 0, ledger_reserved: 0 });
});

test("a user inside the 90-day window is never expired", async () => {
  await seedUserWithCredits("recent", 5);
  await setLastActivityDaysAgo("recent", 89);

  const res = await runRetention(retentionRequest(TOKEN));

  await expect(res.json()).resolves.toMatchObject({ expiredWallets: 0, expiredCredits: 0 });
  expect(await wallet("recent")).toEqual({ available: 5, reserved: 0 });
});

test("any authenticated visit resets the expiration clock", async () => {
  await seedUserWithCredits("returning", 5);
  await setLastActivityDaysAgo("returning", 120);

  // The user comes back: any authenticated request refreshes activity.
  const visit = await whoAmI(
    new Request("http://localhost/api/me", { headers: cookieFor("returning") }),
  );
  expect(visit.status).toBe(200);

  const res = await runRetention(retentionRequest(TOKEN));

  await expect(res.json()).resolves.toMatchObject({ expiredWallets: 0, expiredCredits: 0 });
  expect(await wallet("returning")).toEqual({ available: 5, reserved: 0 });
});

test("expiration never touches credits reserved on a non-terminal generation", async () => {
  await seedUserWithCredits("walker", 2);
  const startRes = await startGeneration(startRequest("walker"));
  expect(startRes.status).toBe(201);
  const { generation } = await startRes.json();
  expect(await wallet("walker")).toEqual({ available: 1, reserved: 1 });
  await setLastActivityDaysAgo("walker", 100);

  const res = await runRetention(retentionRequest(TOKEN));

  await expect(res.json()).resolves.toMatchObject({ expiredWallets: 1, expiredCredits: 1 });
  expect(await wallet("walker")).toEqual({ available: 0, reserved: 1 });

  // The in-flight run still completes and captures its reservation.
  providerMocks.providerStatus.mockResolvedValue("completed");
  const poll = await getGeneration(
    new Request(`http://localhost/api/generations/${generation.id}`, {
      headers: cookieFor("walker"),
    }),
    { params: Promise.resolve({ id: generation.id }) },
  );
  await expect(poll.json()).resolves.toMatchObject({ generation: { status: "completed" } });
  expect(await wallet("walker")).toEqual({ available: 0, reserved: 0 });
});

// --- Admin adjustments and refund reversals ---------------------------------

test("admin adjustments and refund reversals append compensating ledger entries", async () => {
  await seedUserWithCredits("customer", 5);
  const userId = await userIdOf("customer");

  const grant = await adjustRoute(
    adjustmentRequest({ userId, amount: 3, entryType: "admin_adjustment", note: "support goodwill" }),
  );
  expect(grant.status).toBe(200);
  await expect(grant.json()).resolves.toEqual({ wallet: { available: 8, reserved: 0 } });

  const reversal = await adjustRoute(
    adjustmentRequest({ userId, amount: -2, entryType: "refund_reversal", note: "stripe refund re_123" }),
  );
  expect(reversal.status).toBe(200);
  await expect(reversal.json()).resolves.toEqual({ wallet: { available: 6, reserved: 0 } });

  expect(await ledgerEntries("customer")).toEqual([
    { entry_type: "admin_adjustment", available_delta: 5, reserved_delta: 0 },
    { entry_type: "admin_adjustment", available_delta: 3, reserved_delta: 0 },
    { entry_type: "refund_reversal", available_delta: -2, reserved_delta: 0 },
  ]);
});

test("a refund reversal cannot drive the wallet negative", async () => {
  await seedUserWithCredits("light", 1);
  const userId = await userIdOf("light");

  const res = await adjustRoute(
    adjustmentRequest({ userId, amount: -5, entryType: "refund_reversal", note: "too big" }),
  );

  expect(res.status).toBe(409);
  expect(await wallet("light")).toEqual({ available: 1, reserved: 0 });
  expect(await ledgerEntries("light")).toEqual([
    { entry_type: "admin_adjustment", available_delta: 1, reserved_delta: 0 },
  ]);
});

test("adjustment validation: bad entry type, zero amount, positive reversal, unknown user", async () => {
  await seedUserWithCredits("valid", 1);
  const userId = await userIdOf("valid");

  expect((await adjustRoute(adjustmentRequest({ userId, amount: 1, entryType: "generation_reserve" }))).status).toBe(400);
  expect((await adjustRoute(adjustmentRequest({ userId, amount: 0, entryType: "admin_adjustment" }))).status).toBe(400);
  expect((await adjustRoute(adjustmentRequest({ userId, amount: 1.5, entryType: "admin_adjustment" }))).status).toBe(400);
  expect((await adjustRoute(adjustmentRequest({ userId, amount: 2, entryType: "refund_reversal" }))).status).toBe(400);
  expect(
    (
      await adjustRoute(
        adjustmentRequest({
          userId: "00000000-0000-0000-0000-000000000000",
          amount: 1,
          entryType: "admin_adjustment",
        }),
      )
    ).status,
  ).toBe(404);
  expect((await adjustRoute(adjustmentRequest({ userId: "not-a-uuid", amount: 1, entryType: "admin_adjustment" }))).status).toBe(404);
});

test("ledger history is never mutated — updates and deletes are rejected", async () => {
  await seedUserWithCredits("audited", 1);

  await expect(getPool().query(`update credit_ledger set note = 'tampered'`)).rejects.toThrow(
    /append-only/,
  );
  await expect(getPool().query(`delete from credit_ledger`)).rejects.toThrow(/append-only/);
});

// --- Sweep catches leftover terminal source photos --------------------------

test("the sweep purges source photos left behind on terminal generations, not active ones", async () => {
  const { rows: userRows } = await getPool().query(
    `insert into users (external_id) values ('straggler') returning id`,
  );
  const userId = userRows[0].id;
  const { rows: doneRows } = await getPool().query(
    `insert into video_generations (user_id, engine, status, credits_spent)
     values ($1, 'wan-animate-fal', 'completed', 1) returning id`,
    [userId],
  );
  const { rows: activeRows } = await getPool().query(
    `insert into video_generations (user_id, engine, status)
     values ($1, 'wan-animate-fal', 'running') returning id`,
    [userId],
  );
  await getPool().query(
    `insert into media_assets (user_id, generation_id, kind, blob_path, content_type, byte_size, sha256)
     values ($1, $2, 'source_photo', 'sources/done', 'image/jpeg', 3, 'aaa'),
            ($1, $3, 'source_photo', 'sources/active', 'image/jpeg', 3, 'bbb')`,
    [userId, doneRows[0].id, activeRows[0].id],
  );

  const res = await runRetention(retentionRequest(TOKEN));

  await expect(res.json()).resolves.toMatchObject({ purgedPhotos: 1 });
  expect(blobMocks.deleteBlob).toHaveBeenCalledWith("sources/done");
  expect(blobMocks.deleteBlob).not.toHaveBeenCalledWith("sources/active");

  const { rows: assets } = await getPool().query(
    `select blob_path, sha256, purged_at from media_assets order by sha256`,
  );
  expect(assets[0]).toMatchObject({ blob_path: null, sha256: "aaa" });
  expect(assets[0].purged_at).not.toBeNull();
  expect(assets[1]).toMatchObject({ blob_path: "sources/active", sha256: "bbb", purged_at: null });
});
