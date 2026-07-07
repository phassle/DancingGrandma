// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { TestPostgres } from "@/test/postgres";
import { startTestPostgres } from "@/test/postgres";

/**
 * Route-handler tests for the durable paid-generation lifecycle (issue #57,
 * PRD #54): reserve on start, capture on delivery-to-blob, release on
 * technical failure. Real test Postgres; only the true externals are faked —
 * identity token verification, the provider client, and blob upload.
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
}));
vi.mock("@/lib/server/blob", () => blobMocks);

import { GET as getActive, POST as startGeneration } from "./route";
import { GET as getGeneration } from "./[id]/route";
import { POST as grantDevCredits } from "../dev/credits/route";
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
  providerMocks.uploadToProvider.mockResolvedValue("https://fal.storage/photo.jpg");
  providerMocks.submitToProvider.mockResolvedValue({ requestId: "req-1" });
  providerMocks.providerStatus.mockResolvedValue("running");
  providerMocks.providerResult.mockResolvedValue("https://fal.output/dance.mp4");
  blobMocks.saveVideoFromUrl.mockImplementation(async (id: string) => `${id}.mp4`);
  await getPool().query("truncate users cascade");
});

function cookieFor(sub: string): { cookie: string } {
  // The token value is opaque to the routes; the faked verifier maps any
  // token to whatever claims it is programmed with. Encode the sub in the
  // token so multi-user tests can switch identity per request.
  return { cookie: `dg_session=token-${sub}` };
}

function signInAll() {
  oidcMocks.verifyIdToken.mockImplementation(async (token: string) => ({
    sub: token.replace(/^token-/, ""),
  }));
}

async function seedCredits(sub: string, amount: number): Promise<void> {
  const res = await grantDevCredits(
    new Request("http://localhost/api/dev/credits", {
      method: "POST",
      headers: { ...cookieFor(sub), "content-type": "application/json" },
      body: JSON.stringify({ amount }),
    }),
  );
  expect(res.status).toBe(200);
}

function startRequest(sub?: string): Request {
  const form = new FormData();
  form.set("photo", new File([new Uint8Array([1, 2, 3])], "grandma.jpg", { type: "image/jpeg" }));
  form.set("engineId", "wan-animate-fal");
  form.set("referenceUrl", "https://example.com/dance.mp4");
  form.set("referenceSourceKind", "direct_url");
  return new Request("http://localhost/api/generations", {
    method: "POST",
    headers: sub ? cookieFor(sub) : {},
    body: form,
  });
}

function statusRequest(id: string, sub: string): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://localhost/api/generations/${id}`, { headers: cookieFor(sub) }),
    { params: Promise.resolve({ id }) },
  ];
}

async function wallet(sub: string): Promise<{ available: number; reserved: number }> {
  const { rows } = await getPool().query(
    `select w.available, w.reserved from credit_wallets w
     join users u on u.id = w.user_id where u.external_id = $1`,
    [sub],
  );
  return rows[0];
}

async function ledgerEntries(sub: string): Promise<{ entry_type: string; available_delta: number; reserved_delta: number }[]> {
  const { rows } = await getPool().query(
    `select l.entry_type, l.available_delta, l.reserved_delta from credit_ledger l
     join users u on u.id = l.user_id where u.external_id = $1 order by l.id`,
    [sub],
  );
  return rows;
}

test("rejects unauthenticated start", async () => {
  const res = await startGeneration(startRequest());
  expect(res.status).toBe(401);
  expect(providerMocks.submitToProvider).not.toHaveBeenCalled();
});

test("insufficient credits: no job submitted, client is told to go to checkout", async () => {
  signInAll();
  const res = await startGeneration(startRequest("broke"));

  expect(res.status).toBe(402);
  await expect(res.json()).resolves.toMatchObject({
    error: "insufficient_credits",
    action: "checkout",
  });
  expect(providerMocks.submitToProvider).not.toHaveBeenCalled();
  const { rows } = await getPool().query("select count(*)::int as jobs from video_generations");
  expect(rows[0].jobs).toBe(0);
});

test("pre-submission validation rejection costs nothing", async () => {
  signInAll();
  await seedCredits("val", 1);

  const form = new FormData();
  form.set("engineId", "no-such-engine");
  const res = await startGeneration(
    new Request("http://localhost/api/generations", {
      method: "POST",
      headers: cookieFor("val"),
      body: form,
    }),
  );

  expect(res.status).toBe(400);
  expect(await wallet("val")).toEqual({ available: 1, reserved: 0 });
  expect(providerMocks.submitToProvider).not.toHaveBeenCalled();
  const { rows } = await getPool().query("select count(*)::int as jobs from video_generations");
  expect(rows[0].jobs).toBe(0);
});

test("start with 1 credit: job created, credit reserved, provider submitted, request id stored", async () => {
  signInAll();
  await seedCredits("starter", 1);

  const res = await startGeneration(startRequest("starter"));

  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.generation).toMatchObject({
    id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    engineId: "wan-animate-fal",
    status: "submitted",
    requestId: "req-1",
  });
  expect(body.wallet).toEqual({ available: 0, reserved: 1 });

  expect(providerMocks.submitToProvider).toHaveBeenCalledTimes(1);
  const [engine, imageUrl, videoUrl] = providerMocks.submitToProvider.mock.calls[0];
  expect(engine.id).toBe("wan-animate-fal");
  expect(imageUrl).toBe("https://fal.storage/photo.jpg");
  expect(videoUrl).toBe("https://example.com/dance.mp4");

  const { rows } = await getPool().query("select * from video_generations");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    status: "submitted",
    provider: "fal",
    endpoint: "fal-ai/wan/v2.2-14b/animate/move",
    provider_request_id: "req-1",
    reference_source_kind: "direct_url",
    credit_price: 1,
  });
  expect(await ledgerEntries("starter")).toEqual([
    expect.objectContaining({ entry_type: "admin_adjustment" }),
    { entry_type: "generation_reserve", available_delta: -1, reserved_delta: 1 },
  ]);
});

test("double-click / two-tab start with 1 credit reserves exactly once", async () => {
  signInAll();
  await seedCredits("racer", 1);
  // Make sure the wallet row exists before the concurrent burst.
  const [first, second] = await Promise.all([
    startGeneration(startRequest("racer")),
    startGeneration(startRequest("racer")),
  ]);

  const statuses = [first.status, second.status].sort();
  expect(statuses).toEqual([201, 402]);
  expect(providerMocks.submitToProvider).toHaveBeenCalledTimes(1);

  const { rows } = await getPool().query("select count(*)::int as jobs from video_generations");
  expect(rows[0].jobs).toBe(1);
  expect(await wallet("racer")).toEqual({ available: 0, reserved: 1 });
});

test("provider submission failure fails the job and releases the reservation", async () => {
  signInAll();
  await seedCredits("failed-submit", 1);
  providerMocks.submitToProvider.mockRejectedValue(
    Object.assign(new Error("Exhausted balance"), { kind: "unavailable" }),
  );

  const res = await startGeneration(startRequest("failed-submit"));

  expect(res.status).toBe(502);
  const body = await res.json();
  expect(body.generation).toMatchObject({
    status: "failed",
    errorKind: "unavailable",
    error: "Exhausted balance",
  });

  expect(await wallet("failed-submit")).toEqual({ available: 1, reserved: 0 });
  expect(await ledgerEntries("failed-submit")).toEqual([
    expect.objectContaining({ entry_type: "admin_adjustment" }),
    { entry_type: "generation_reserve", available_delta: -1, reserved_delta: 1 },
    { entry_type: "generation_release", available_delta: 1, reserved_delta: -1 },
  ]);
});

test("status poll passes provider progress through without capturing", async () => {
  signInAll();
  await seedCredits("poller", 1);
  const { generation } = await (await startGeneration(startRequest("poller"))).json();
  providerMocks.providerStatus.mockResolvedValue("running");

  const res = await getGeneration(...statusRequest(generation.id, "poller"));

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    generation: { id: generation.id, status: "running" },
  });
  expect(await wallet("poller")).toEqual({ available: 0, reserved: 1 });
  expect(blobMocks.saveVideoFromUrl).not.toHaveBeenCalled();
});

test("provider success: output copied to blob before completed; reservation captured exactly once", async () => {
  signInAll();
  await seedCredits("winner", 1);
  const { generation } = await (await startGeneration(startRequest("winner"))).json();
  providerMocks.providerStatus.mockResolvedValue("completed");

  const res = await getGeneration(...statusRequest(generation.id, "winner"));

  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.generation).toMatchObject({
    id: generation.id,
    status: "completed",
    blobPath: `${generation.id}.mp4`,
  });
  expect(blobMocks.saveVideoFromUrl).toHaveBeenCalledWith(
    generation.id,
    "https://fal.output/dance.mp4",
  );
  expect(await wallet("winner")).toEqual({ available: 0, reserved: 0 });

  // A second poll is a no-op: still completed, no double capture.
  const again = await getGeneration(...statusRequest(generation.id, "winner"));
  await expect(again.json()).resolves.toMatchObject({ generation: { status: "completed" } });
  expect(await wallet("winner")).toEqual({ available: 0, reserved: 0 });
  const captures = (await ledgerEntries("winner")).filter(
    (e) => e.entry_type === "generation_capture",
  );
  expect(captures).toEqual([
    { entry_type: "generation_capture", available_delta: 0, reserved_delta: -1 },
  ]);
});

test("blob persistence failure never reports completed and releases the reservation", async () => {
  signInAll();
  await seedCredits("stormy", 1);
  const { generation } = await (await startGeneration(startRequest("stormy"))).json();
  providerMocks.providerStatus.mockResolvedValue("completed");
  blobMocks.saveVideoFromUrl.mockRejectedValue(new Error("azurite is down"));

  const res = await getGeneration(...statusRequest(generation.id, "stormy"));

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    generation: { status: "failed", errorKind: "storage", error: "azurite is down" },
  });
  expect(await wallet("stormy")).toEqual({ available: 1, reserved: 0 });
});

test("provider failure while running: job failed with error kind, reservation released", async () => {
  signInAll();
  await seedCredits("crashy", 1);
  const { generation } = await (await startGeneration(startRequest("crashy"))).json();
  providerMocks.providerStatus.mockRejectedValue(
    Object.assign(new Error("render exploded"), { kind: "provider" }),
  );

  const res = await getGeneration(...statusRequest(generation.id, "crashy"));

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    generation: { status: "failed", errorKind: "provider", error: "render exploded" },
  });
  expect(await wallet("crashy")).toEqual({ available: 1, reserved: 0 });
  expect(await ledgerEntries("crashy")).toEqual([
    expect.objectContaining({ entry_type: "admin_adjustment" }),
    { entry_type: "generation_reserve", available_delta: -1, reserved_delta: 1 },
    { entry_type: "generation_release", available_delta: 1, reserved_delta: -1 },
  ]);
});

test("status route hides other users' generations", async () => {
  signInAll();
  await seedCredits("owner", 1);
  const { generation } = await (await startGeneration(startRequest("owner"))).json();

  const res = await getGeneration(...statusRequest(generation.id, "snoop"));
  expect(res.status).toBe(404);

  const bogus = await getGeneration(...statusRequest("not-a-uuid", "owner"));
  expect(bogus.status).toBe(404);
});

test("reload resume: listing active returns the latest non-terminal generation from the server", async () => {
  signInAll();
  await seedCredits("returning", 1);
  const { generation } = await (await startGeneration(startRequest("returning"))).json();

  const during = await getActive(
    new Request("http://localhost/api/generations?active=1", { headers: cookieFor("returning") }),
  );
  expect(during.status).toBe(200);
  await expect(during.json()).resolves.toMatchObject({
    generation: { id: generation.id, status: "submitted", requestId: "req-1" },
  });

  providerMocks.providerStatus.mockResolvedValue("completed");
  await getGeneration(...statusRequest(generation.id, "returning"));

  const after = await getActive(
    new Request("http://localhost/api/generations?active=1", { headers: cookieFor("returning") }),
  );
  await expect(after.json()).resolves.toEqual({ generation: null });
});

test("active listing requires authentication", async () => {
  const res = await getActive(new Request("http://localhost/api/generations?active=1"));
  expect(res.status).toBe(401);
});

test("dev credit seeding writes an admin-adjustment ledger entry", async () => {
  signInAll();
  await seedCredits("seeded", 5);

  expect(await wallet("seeded")).toEqual({ available: 5, reserved: 0 });
  expect(await ledgerEntries("seeded")).toEqual([
    { entry_type: "admin_adjustment", available_delta: 5, reserved_delta: 0 },
  ]);

  const unauthenticated = await grantDevCredits(
    new Request("http://localhost/api/dev/credits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 5 }),
    }),
  );
  expect(unauthenticated.status).toBe(401);
});
