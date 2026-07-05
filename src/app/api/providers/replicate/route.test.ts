import { beforeEach, expect, test, vi } from "vitest";
import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.REPLICATE_API_TOKEN = "replicate-token";
  process.env.REPLICATE_POLL_MS = "0";
  delete process.env.REPLICATE_WAN_ANIMATE_MODEL;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        id: "pred-1",
        status: "succeeded",
        output: "https://replicate.delivery/out.mp4",
      }),
    ),
  );
});

function providerRequest(form: FormData): Request {
  return new Request("http://localhost/api/providers/replicate", {
    method: "POST",
    body: form,
  });
}

test("submits Wan character animation to Replicate with image and motion-reference video", async () => {
  const form = new FormData();
  form.set("photo", new File(["photo"], "grandma.png", { type: "image/png" }));
  form.set("referenceVideo", new File(["dance"], "griddy.mp4", { type: "video/mp4" }));
  form.set("referenceName", "griddy.mp4");
  form.set("endpoint", "wan-video/wan-2.2-animate-animation");

  const res = await POST(providerRequest(form));
  const body = (await res.json()) as { requestId: string; videoUrl: string };

  expect(res.status).toBe(200);
  expect(body).toMatchObject({
    requestId: "rep-pred-1",
    videoUrl: "https://replicate.delivery/out.mp4",
  });
  expect(fetch).toHaveBeenCalledWith(
    "https://api.replicate.com/v1/models/wan-video/wan-2.2-animate-animation/predictions",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer replicate-token",
        Prefer: "wait=60",
      }),
    }),
  );
  const [, init] = vi.mocked(fetch).mock.calls[0];
  const payload = JSON.parse(String(init?.body)) as {
    input: Record<string, string | number | boolean>;
  };
  expect(payload.input).toMatchObject({
    character_image: expect.stringMatching(/^data:image\/png;base64,/),
    video: expect.stringMatching(/^data:video\/mp4;base64,/),
    resolution: "720",
    refert_num: 1,
    frames_per_second: 24,
    go_fast: true,
    merge_audio: true,
  });
});

test("polls an in-progress Replicate prediction until it returns an output URL", async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      Response.json({
        id: "pred-1",
        status: "processing",
        urls: { get: "https://api.replicate.com/v1/predictions/pred-1" },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        id: "pred-1",
        status: "succeeded",
        output: ["https://replicate.delivery/out.mp4"],
      }),
    );
  const form = new FormData();
  form.set("photo", new File(["photo"], "grandma.png", { type: "image/png" }));
  form.set("referenceVideo", new File(["dance"], "griddy.mp4", { type: "video/mp4" }));

  const res = await POST(providerRequest(form));

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toMatchObject({
    videoUrl: "https://replicate.delivery/out.mp4",
  });
  expect(fetch).toHaveBeenLastCalledWith(
    "https://api.replicate.com/v1/predictions/pred-1",
    expect.objectContaining({
      headers: { Authorization: "Bearer replicate-token" },
    }),
  );
});

test("reports provider unavailable when no Replicate token is configured", async () => {
  delete process.env.REPLICATE_API_TOKEN;
  const form = new FormData();
  form.set("photo", new File(["photo"], "grandma.png", { type: "image/png" }));
  form.set("referenceVideo", new File(["dance"], "griddy.mp4", { type: "video/mp4" }));

  const res = await POST(providerRequest(form));

  expect(res.status).toBe(503);
  await expect(res.json()).resolves.toMatchObject({
    kind: "unavailable",
    error: "REPLICATE_API_TOKEN is not set",
  });
  expect(fetch).not.toHaveBeenCalled();
});

test("rejects client-tampered Replicate model ids", async () => {
  const form = new FormData();
  form.set("photo", new File(["photo"], "grandma.png", { type: "image/png" }));
  form.set("referenceVideo", new File(["dance"], "griddy.mp4", { type: "video/mp4" }));
  form.set("endpoint", "black-forest-labs/flux-schnell");

  const res = await POST(providerRequest(form));

  expect(res.status).toBe(400);
  await expect(res.json()).resolves.toMatchObject({
    kind: "provider",
    error: "Unsupported Replicate model: black-forest-labs/flux-schnell",
  });
  expect(fetch).not.toHaveBeenCalled();
});
