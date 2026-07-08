// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { TestPostgres } from "@/test/postgres";
import { startTestPostgres } from "@/test/postgres";

/**
 * Route-handler tests for the private library and share links (issue #59,
 * PRD #54): generated videos are private account assets — listed, played,
 * downloaded, and deleted only by their owner; opt-in share-by-link resolves
 * a slug and checks visibility before serving. Real test Postgres; only the
 * true externals are faked — identity token verification, the provider
 * client, and blob storage.
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

// In-memory fake of the videos container: paid runs write `${id}.mp4` on
// capture, playback reads it back, deletion removes it.
const blobMocks = vi.hoisted(() => {
  const store = new Map<string, Buffer>();
  return {
    store,
    saveVideoFromUrl: vi.fn(async (id: string) => {
      const path = `${id}.mp4`;
      store.set(path, Buffer.from(`bytes-of-${id}`));
      return path;
    }),
    readVideoBytes: vi.fn(async (path: string) => {
      const bytes = store.get(path);
      if (!bytes) throw Object.assign(new Error("BlobNotFound"), { statusCode: 404 });
      return bytes;
    }),
    deleteVideoBlob: vi.fn(async (path: string) => {
      store.delete(path);
    }),
  };
});
vi.mock("@/lib/server/blob", () => ({
  saveVideoFromUrl: blobMocks.saveVideoFromUrl,
  readVideoBytes: blobMocks.readVideoBytes,
  deleteVideoBlob: blobMocks.deleteVideoBlob,
}));

import { GET as getLibrary } from "./route";
import { POST as startGeneration } from "../generations/route";
import { DELETE as deleteGeneration, GET as pollGeneration } from "../generations/[id]/route";
import { POST as toggleShare } from "../generations/[id]/share/route";
import { GET as getVideo } from "../video/[id]/route";
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
  blobMocks.store.clear();
  providerMocks.uploadToProvider.mockResolvedValue("https://fal.storage/photo.jpg");
  providerMocks.submitToProvider.mockResolvedValue({ requestId: "req-1" });
  providerMocks.providerStatus.mockResolvedValue("completed");
  providerMocks.providerResult.mockResolvedValue("https://fal.output/dance.mp4");
  oidcMocks.verifyIdToken.mockImplementation(async (token: string) => ({
    sub: token.replace(/^token-/, ""),
  }));
  await getPool().query("truncate users cascade");
});

function cookieFor(sub: string): { cookie: string } {
  return { cookie: `dg_session=token-${sub}` };
}

function idParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
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

/** Run one paid generation to completion for `sub`; returns the generation id. */
async function completedGeneration(sub: string): Promise<string> {
  const form = new FormData();
  form.set("photo", new File([new Uint8Array([1, 2, 3])], "grandma.jpg", { type: "image/jpeg" }));
  form.set("engineId", "wan-animate-fal");
  form.set("referenceUrl", "https://example.com/dance.mp4");
  form.set("referenceSourceKind", "direct_url");
  const started = await startGeneration(
    new Request("http://localhost/api/generations", {
      method: "POST",
      headers: cookieFor(sub),
      body: form,
    }),
  );
  expect(started.status).toBe(201);
  const { generation } = await started.json();
  const polled = await pollGeneration(
    new Request(`http://localhost/api/generations/${generation.id}`, { headers: cookieFor(sub) }),
    idParams(generation.id),
  );
  const body = await polled.json();
  expect(body.generation.status).toBe("completed");
  return generation.id as string;
}

function libraryRequest(sub?: string): Request {
  return new Request("http://localhost/api/library", { headers: sub ? cookieFor(sub) : {} });
}

function videoRequest(id: string, sub?: string, query = ""): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://localhost/api/video/${id}${query}`, { headers: sub ? cookieFor(sub) : {} }),
    idParams(id),
  ];
}

function shareRequest(id: string, shared: boolean, sub?: string): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://localhost/api/generations/${id}/share`, {
      method: "POST",
      headers: { ...(sub ? cookieFor(sub) : {}), "content-type": "application/json" },
      body: JSON.stringify({ shared }),
    }),
    idParams(id),
  ];
}

function deleteRequest(id: string, sub?: string): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://localhost/api/generations/${id}`, {
      method: "DELETE",
      headers: sub ? cookieFor(sub) : {},
    }),
    idParams(id),
  ];
}

// ---------------------------------------------------------------------------
// Library listing
// ---------------------------------------------------------------------------

test("library requires authentication", async () => {
  const res = await getLibrary(libraryRequest());
  expect(res.status).toBe(401);
});

test("library lists only the caller's completed videos with playback and download URLs", async () => {
  await seedCredits("keeper", 2);
  await seedCredits("neighbor", 1);
  const mine = await completedGeneration("keeper");
  await completedGeneration("neighbor");

  const res = await getLibrary(libraryRequest("keeper"));
  expect(res.status).toBe(200);
  const { videos } = await res.json();
  expect(videos).toHaveLength(1);
  expect(videos[0]).toMatchObject({
    id: mine,
    engineId: "wan-animate-fal",
    videoUrl: `/api/video/${mine}`,
    downloadUrl: `/api/video/${mine}?download=1`,
    shared: false,
    shareUrl: null,
  });
});

test("library excludes non-completed runs", async () => {
  await seedCredits("mixed", 2);
  const done = await completedGeneration("mixed");
  // A failed run: provider explodes on poll.
  const form = new FormData();
  form.set("photo", new File([new Uint8Array([1])], "g.jpg", { type: "image/jpeg" }));
  form.set("engineId", "wan-animate-fal");
  form.set("referenceUrl", "https://example.com/dance.mp4");
  const started = await startGeneration(
    new Request("http://localhost/api/generations", {
      method: "POST",
      headers: cookieFor("mixed"),
      body: form,
    }),
  );
  const { generation } = await started.json();
  providerMocks.providerStatus.mockRejectedValue(new Error("boom"));
  await pollGeneration(
    new Request(`http://localhost/api/generations/${generation.id}`, { headers: cookieFor("mixed") }),
    idParams(generation.id),
  );

  const { videos } = await (await getLibrary(libraryRequest("mixed"))).json();
  expect(videos.map((v: { id: string }) => v.id)).toEqual([done]);
});

// ---------------------------------------------------------------------------
// Ownership: playback and download
// ---------------------------------------------------------------------------

test("owner can play and download; playback is not publicly cacheable", async () => {
  await seedCredits("owner", 1);
  const id = await completedGeneration("owner");

  const play = await getVideo(...videoRequest(id, "owner"));
  expect(play.status).toBe(200);
  expect(play.headers.get("Content-Type")).toBe("video/mp4");
  expect(play.headers.get("Cache-Control")).not.toContain("public");
  await expect(play.text()).resolves.toBe(`bytes-of-${id}`);

  const download = await getVideo(...videoRequest(id, "owner", "?download=1"));
  expect(download.status).toBe(200);
  expect(download.headers.get("Content-Disposition")).toContain("attachment");
});

test("another authenticated user cannot access someone else's video by URL guessing", async () => {
  await seedCredits("victim", 1);
  const id = await completedGeneration("victim");

  const snooping = await getVideo(...videoRequest(id, "snoop"));
  expect(snooping.status).toBe(404);
  expect(blobMocks.readVideoBytes).not.toHaveBeenCalled();

  const anonymous = await getVideo(...videoRequest(id));
  expect(anonymous.status).toBe(401);
});

test("media asset record is written for the delivered video", async () => {
  await seedCredits("archivist", 1);
  const id = await completedGeneration("archivist");

  const { rows } = await getPool().query(
    `select kind, storage_provider, blob_path, content_type, privacy, retention, deleted_at
     from media_assets where generation_id = $1`,
    [id],
  );
  expect(rows).toEqual([
    {
      kind: "generated_video",
      storage_provider: "azure_blob",
      blob_path: `${id}.mp4`,
      content_type: "video/mp4",
      privacy: "private",
      retention: "keep_until_user_delete",
      deleted_at: null,
    },
  ]);
});

// ---------------------------------------------------------------------------
// Share-by-link
// ---------------------------------------------------------------------------

test("share enable mints a slug; the share link plays without login", async () => {
  await seedCredits("sharer", 1);
  const id = await completedGeneration("sharer");

  const res = await toggleShare(...shareRequest(id, true, "sharer"));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.shared).toBe(true);
  expect(body.shareUrl).toMatch(/^\/v\/[0-9a-f-]{36}$/);
  const slug = body.shareUrl.replace("/v/", "");
  expect(slug).not.toBe(id); // the slug never leaks the private generation id

  const anonymousPlay = await getVideo(...videoRequest(slug));
  expect(anonymousPlay.status).toBe(200);
  await expect(anonymousPlay.text()).resolves.toBe(`bytes-of-${id}`);

  // The library now reports the share state.
  const { videos } = await (await getLibrary(libraryRequest("sharer"))).json();
  expect(videos[0]).toMatchObject({ shared: true, shareUrl: `/v/${slug}` });
});

test("turning sharing off makes the share link stop working", async () => {
  await seedCredits("regretful", 1);
  const id = await completedGeneration("regretful");
  const { shareUrl } = await (await toggleShare(...shareRequest(id, true, "regretful"))).json();
  const slug = shareUrl.replace("/v/", "");

  const off = await toggleShare(...shareRequest(id, false, "regretful"));
  expect(off.status).toBe(200);
  await expect(off.json()).resolves.toMatchObject({ shared: false, shareUrl: null });

  const deadLink = await getVideo(...videoRequest(slug));
  expect(deadLink.status).toBe(404);

  // The owner can still play their own video.
  const ownerPlay = await getVideo(...videoRequest(id, "regretful"));
  expect(ownerPlay.status).toBe(200);
});

test("only the owner can toggle sharing", async () => {
  await seedCredits("mine", 1);
  const id = await completedGeneration("mine");

  const res = await toggleShare(...shareRequest(id, true, "meddler"));
  expect(res.status).toBe(404);

  const anonymous = await toggleShare(...shareRequest(id, true));
  expect(anonymous.status).toBe(401);

  const { rows } = await getPool().query(
    `select visibility, share_slug from video_generations where id = $1`,
    [id],
  );
  expect(rows[0]).toEqual({ visibility: "private", share_slug: null });
});

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

test("delete removes the video from the library, kills playback and share links, and deletes the blob", async () => {
  await seedCredits("cleaner", 1);
  const id = await completedGeneration("cleaner");
  await toggleShare(...shareRequest(id, true, "cleaner"));
  const { videos: before } = await (await getLibrary(libraryRequest("cleaner"))).json();
  const slug = before[0].shareUrl.replace("/v/", "");

  const res = await deleteGeneration(...deleteRequest(id, "cleaner"));
  expect(res.status).toBe(200);
  expect(blobMocks.deleteVideoBlob).toHaveBeenCalledWith(`${id}.mp4`);

  const { videos: after } = await (await getLibrary(libraryRequest("cleaner"))).json();
  expect(after).toEqual([]);

  expect((await getVideo(...videoRequest(id, "cleaner"))).status).toBe(404);
  expect((await getVideo(...videoRequest(slug))).status).toBe(404);

  // Soft delete: the row (and its ledger trail) survives; the asset is marked.
  const { rows } = await getPool().query(
    `select deleted_at from video_generations where id = $1`,
    [id],
  );
  expect(rows[0].deleted_at).not.toBeNull();
  const { rows: assets } = await getPool().query(
    `select deleted_at from media_assets where generation_id = $1`,
    [id],
  );
  expect(assets[0].deleted_at).not.toBeNull();
});

test("only the owner can delete; an in-flight run cannot be deleted", async () => {
  await seedCredits("holder", 2);
  const done = await completedGeneration("holder");

  const meddled = await deleteGeneration(...deleteRequest(done, "meddler"));
  expect(meddled.status).toBe(404);
  const anonymous = await deleteGeneration(...deleteRequest(done));
  expect(anonymous.status).toBe(401);

  // A run that is still submitted holds its reservation and must not vanish.
  const form = new FormData();
  form.set("photo", new File([new Uint8Array([1])], "g.jpg", { type: "image/jpeg" }));
  form.set("engineId", "wan-animate-fal");
  form.set("referenceUrl", "https://example.com/dance.mp4");
  const started = await startGeneration(
    new Request("http://localhost/api/generations", {
      method: "POST",
      headers: cookieFor("holder"),
      body: form,
    }),
  );
  const { generation } = await started.json();
  const inFlight = await deleteGeneration(...deleteRequest(generation.id, "holder"));
  expect(inFlight.status).toBe(409);
});

// ---------------------------------------------------------------------------
// Legacy free-tier share blobs (no generation row) keep working
// ---------------------------------------------------------------------------

test("a finalize-era blob with no generation row is still served by its unguessable id", async () => {
  const legacyId = "99999999-9999-4999-8999-999999999999";
  blobMocks.store.set(`${legacyId}.mp4`, Buffer.from("legacy"));

  const res = await getVideo(...videoRequest(legacyId));
  expect(res.status).toBe(200);
  await expect(res.text()).resolves.toBe("legacy");
});
