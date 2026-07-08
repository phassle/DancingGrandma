import { beforeEach, expect, test, vi } from "vitest";

const blobMocks = vi.hoisted(() => ({
  readVideoBytes: vi.fn(),
}));
vi.mock("@/lib/server/blob", () => ({
  readVideoBytes: blobMocks.readVideoBytes,
}));

// Ownership and share-link behavior is covered end-to-end in
// src/app/api/library/library.integration.test.ts; these unit tests pin the
// legacy path — an unguessable finalize-era blob with no database row.
const dbMocks = vi.hoisted(() => ({
  getGenerationById: vi.fn(),
  getSharedGeneration: vi.fn(),
}));
vi.mock("@/lib/server/db", () => dbMocks);

const authMocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
}));
vi.mock("@/lib/server/auth", () => authMocks);

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getGenerationById.mockResolvedValue(undefined);
  dbMocks.getSharedGeneration.mockResolvedValue(undefined);
  authMocks.authenticateRequest.mockResolvedValue(null);
});

test("serves a stored legacy video for a valid share id", async () => {
  blobMocks.readVideoBytes.mockResolvedValue(Buffer.from("video"));
  const res = await GET(new Request("http://localhost/api/video/11111111-1111-4111-8111-111111111111"), {
    params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }),
  });

  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("video/mp4");
  await expect(res.text()).resolves.toBe("video");
  expect(blobMocks.readVideoBytes).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111.mp4");
});

test("returns 404 when the id is not a valid share id", async () => {
  const res = await GET(new Request("http://localhost/api/video/not-an-id"), {
    params: Promise.resolve({ id: "not-an-id" }),
  });

  expect(res.status).toBe(404);
  expect(blobMocks.readVideoBytes).not.toHaveBeenCalled();
});

test("a private generation id requires login even when the blob exists", async () => {
  blobMocks.readVideoBytes.mockResolvedValue(Buffer.from("video"));
  dbMocks.getGenerationById.mockResolvedValue({
    id: "22222222-2222-4222-8222-222222222222",
    user_id: "someone",
    blob_path: "22222222-2222-4222-8222-222222222222.mp4",
    deleted_at: null,
  });

  const res = await GET(new Request("http://localhost/api/video/22222222-2222-4222-8222-222222222222"), {
    params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }),
  });

  expect(res.status).toBe(401);
  expect(blobMocks.readVideoBytes).not.toHaveBeenCalled();
});
