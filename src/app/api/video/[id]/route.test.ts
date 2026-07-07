import { beforeEach, expect, test, vi } from "vitest";
import { GET } from "./route";

const blobMocks = vi.hoisted(() => ({
  readVideoBytes: vi.fn(),
}));

vi.mock("@/lib/server/blob", () => ({
  readVideoBytes: blobMocks.readVideoBytes,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

test("serves a stored video for a valid share id", async () => {
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
