import { beforeEach, expect, test, vi } from "vitest";
import { fal } from "@fal-ai/client";
import {
  cleanupPhotoUpload,
  generateDanceVideo,
  hasWiredGenerationAdapter,
  submitDanceVideo,
  trackDanceVideo,
} from "./generate";
import { DEFAULT_ENGINE, ENGINES } from "./engines";

// The fal client is the system boundary — everything below it is mocked.
vi.mock("@fal-ai/client", () => ({
  fal: {
    config: vi.fn(),
    storage: { upload: vi.fn() },
    queue: {
      submit: vi.fn(),
      status: vi.fn(),
      result: vi.fn(),
    },
    subscribe: vi.fn(),
  },
}));

/**
 * Error shape captured live from the locked fal account on 2026-07-05:
 * ApiError { message: "Forbidden", status: 403, body: { detail: "User is
 * locked. Reason: Exhausted balance. Top up your balance at
 * fal.ai/dashboard/billing" } } — trailing period varies by endpoint.
 */
const LOCKED_DETAIL =
  "User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing";

function falApiError(
  status: number,
  detail: unknown,
  extras: Record<string, unknown> = {},
): Error {
  const message = typeof detail === "string" ? detail : JSON.stringify(detail);
  return Object.assign(new Error(message), { status, body: { detail }, ...extras });
}

const wan = ENGINES.find((e) => e.id === "wan-animate-fal")!;
const kling = ENGINES.find((e) => e.id === "kling-motion-control")!;
const replicateWan = ENGINES.find((e) => e.id === "wan-animate-replicate")!;
const azureSora = ENGINES.find((e) => e.id === "sora-2-azure")!;
const photo = () => new File(["p"], "grandma.png", { type: "image/png" });
const clip = () => new File(["v"], "dance.mp4", { type: "video/mp4" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({
      width: 100,
      height: 100,
      close: vi.fn(),
    })),
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:finalized-video");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/video/finalize")) {
        return new Response("final-video", {
          headers: { "Content-Type": "video/mp4" },
        });
      }
      if (url.endsWith("/api/moderate")) {
        return Response.json({ accepted: true });
      }
      if (url.endsWith("/api/photo/cleanup")) {
        return Response.json({ deleted: true });
      }
      return new Response(null, { status: 404, statusText: "Not Found" });
    }),
  );
  vi.mocked(fal.storage.upload).mockResolvedValue("https://fal.media/files/x");
  vi.mocked(fal.queue.submit).mockResolvedValue({
    status: "IN_QUEUE",
    request_id: "req-1",
    queue_position: 3,
    response_url: "",
    status_url: "",
    cancel_url: "",
  });
  vi.mocked(fal.queue.status).mockResolvedValue({
    status: "COMPLETED",
    request_id: "req-1",
    response_url: "",
    status_url: "",
    cancel_url: "",
    logs: [],
  });
  vi.mocked(fal.queue.result).mockResolvedValue({
    data: { video: { url: "https://fal.media/out.mp4" } },
    requestId: "req-1",
  });
});

test("available engines declare providers and resolve to wired adapters", () => {
  for (const engine of ENGINES) {
    expect(engine.provider).toMatch(/^(fal|replicate|huggingface|azure)$/);
    if (engine.status === "coming-soon") {
      expect(hasWiredGenerationAdapter(engine)).toBe(false);
    } else {
      expect(hasWiredGenerationAdapter(engine)).toBe(true);
    }
  }
});

test("Kling is the default recommended engine", () => {
  expect(DEFAULT_ENGINE.id).toBe("kling-motion-control");
  expect(ENGINES[0].id).toBe("kling-motion-control");
  expect(ENGINES[0].status).toBe("recommended");
  expect(wan.status).toBe("available");
});

test("balance-exhausted 403 rejects with kind 'unavailable'", async () => {
  vi.mocked(fal.storage.upload).mockRejectedValue(falApiError(403, LOCKED_DETAIL));

  await expect(
    generateDanceVideo(photo(), clip(), wan, () => {}),
  ).rejects.toMatchObject({ kind: "unavailable" });
});

test("a fal timeout rejects with kind 'timeout'", async () => {
  // startTimeout expiries surface as ApiError with timeoutType "user".
  vi.mocked(fal.queue.status).mockRejectedValue(
    falApiError(408, "Request timed out", { timeoutType: "user" }),
  );

  await expect(
    generateDanceVideo(photo(), clip(), wan, () => {}),
  ).rejects.toMatchObject({ kind: "timeout" });
});

test("a render-stage provider failure rejects with kind 'provider'", async () => {
  vi.mocked(fal.queue.status).mockRejectedValue(
    falApiError(500, "Internal server error"),
  );

  await expect(
    generateDanceVideo(photo(), clip(), wan, () => {}),
  ).rejects.toMatchObject({ kind: "provider", message: "Internal server error" });
});

test("fal validation details keep request metadata and are logged for Aspire", async () => {
  vi.mocked(fal.queue.result).mockRejectedValue(
    falApiError(
      422,
      [
        {
          loc: ["body", "image_url"],
          msg: "Image dimensions are too large. Maximum dimensions are 3850x3850 pixels.",
          type: "image_too_large",
        },
      ],
      { requestId: "fal-req-422" },
    ),
  );

  await expect(trackDanceVideo("req-1", kling, () => {})).rejects.toMatchObject({
    kind: "provider",
    status: 422,
    requestId: "fal-req-422",
    code: "image_too_large",
    message: "body.image_url: Image dimensions are too large. Maximum dimensions are 3850x3850 pixels.",
  });
  expect(console.error).toHaveBeenCalledWith(
    "[dg:generation-error]",
    expect.objectContaining({
      phase: "fal-result",
      engineId: "kling-motion-control",
      status: 422,
      requestId: "fal-req-422",
      code: "image_too_large",
    }),
  );
});

test("submitDanceVideo returns the queue request id as soon as the run is accepted", async () => {
  await expect(
    submitDanceVideo(photo(), "https://example.com/griddy.mp4", wan),
  ).resolves.toBe("req-1");

  // Only the photo is uploaded; the clip URL goes into the input as-is.
  expect(fal.storage.upload).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fal.queue.submit).mock.calls[0][1]).toMatchObject({
    input: { video_url: "https://example.com/griddy.mp4" },
  });
  expect(fal.queue.status).not.toHaveBeenCalled();
  expect(fal.queue.result).not.toHaveBeenCalled();
});

test("Kling Motion Control submits fal's required video-orientation input", async () => {
  await expect(submitDanceVideo(photo(), "https://example.com/griddy.mp4", kling)).resolves.toBe(
    "req-1",
  );

  expect(fal.queue.submit).toHaveBeenCalledWith(kling.endpoint, {
    input: {
      image_url: "https://fal.media/files/x",
      video_url: "https://example.com/griddy.mp4",
      keep_original_sound: true,
      character_orientation: "video",
    },
  });
});

test("oversized source photos are downscaled before provider upload", async () => {
  const close = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({
      width: 4284,
      height: 5712,
      close,
    })),
  );
  const drawImage = vi.fn();
  const toBlob = vi.fn(
    (callback: BlobCallback, type?: string, quality?: unknown) => {
      callback(new Blob(["resized"], { type }));
      expect(quality).toBe(0.92);
    },
  );
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage })),
    toBlob,
  } as unknown as HTMLCanvasElement;
  const originalCreateElement = document.createElement.bind(document);
  const createElement = vi.spyOn(document, "createElement");
  createElement.mockImplementation(((tagName: string) => {
    if (tagName === "canvas") return canvas;
    return originalCreateElement(tagName);
  }) as typeof document.createElement);
  const oversized = new File(["p"], "IMG_0557.jpg", {
    type: "image/jpeg",
    lastModified: 123,
  });

  await expect(
    submitDanceVideo(oversized, "https://example.com/griddy.mp4", kling),
  ).resolves.toBe("req-1");

  const uploaded = vi.mocked(fal.storage.upload).mock.calls[0][0] as File;
  expect(uploaded).not.toBe(oversized);
  expect(uploaded.name).toBe("IMG_0557-provider.jpg");
  expect(uploaded.type).toBe("image/jpeg");
  expect(canvas.width).toBe(2880);
  expect(canvas.height).toBe(3840);
  expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.92);
  expect(close).toHaveBeenCalled();
});

test("trackDanceVideo polls queue status and resolves the result video URL", async () => {
  vi.mocked(fal.queue.status)
    .mockResolvedValueOnce({
      status: "IN_QUEUE",
      request_id: "req-1",
      queue_position: 3,
      response_url: "",
      status_url: "",
      cancel_url: "",
    })
    .mockResolvedValueOnce({
      status: "IN_PROGRESS",
      request_id: "req-1",
      response_url: "",
      status_url: "",
      cancel_url: "",
      logs: [],
    })
    .mockResolvedValueOnce({
      status: "COMPLETED",
      request_id: "req-1",
      response_url: "",
      status_url: "",
      cancel_url: "",
      logs: [],
    });
  const updates: string[] = [];

  await expect(
    trackDanceVideo("req-1", wan, (message) => updates.push(message), { pollMs: 0 }),
  ).resolves.toBe("blob:finalized-video");

  expect(updates).toEqual([
    "#3 in line for the dance floor",
    "Rendering, frame by frame…",
    "Finalizing audio and watermark…",
  ]);
  expect(fal.queue.result).toHaveBeenCalledWith(wan.endpoint, { requestId: "req-1" });
  expect(fetch).toHaveBeenCalledWith(
    "/api/video/finalize",
    expect.objectContaining({ method: "POST" }),
  );
});

test("generateDanceVideo composes submit and track without fal.subscribe", async () => {
  await expect(
    generateDanceVideo(photo(), "https://example.com/griddy.mp4", wan, () => {}),
  ).resolves.toBe("blob:finalized-video");

  expect(fal.queue.submit).toHaveBeenCalled();
  expect(fal.queue.status).toHaveBeenCalled();
  expect(fal.queue.result).toHaveBeenCalled();
  expect(fal.subscribe).not.toHaveBeenCalled();
});

test("the Replicate provider goes through the server route and tracks its returned video", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/providers/replicate")) {
        return Response.json({
          requestId: "rep-1",
          videoUrl: "https://replicate.example/out.mp4",
        });
      }
      if (url.endsWith("/api/video/finalize")) {
        return new Response("final-video", {
          headers: { "Content-Type": "video/mp4" },
        });
      }
      return new Response(null, { status: 404, statusText: "Not Found" });
    }),
  );

  await expect(submitDanceVideo(photo(), clip(), replicateWan)).resolves.toBe("rep-1");
  expect(fetch).toHaveBeenCalledWith(
    "/api/providers/replicate",
    expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
  );

  await expect(trackDanceVideo("rep-1", replicateWan, () => {})).resolves.toBe(
    "blob:finalized-video",
  );
});

test("the Azure Sora engine is not wired until it supports character animation", async () => {
  expect(azureSora.status).toBe("coming-soon");
  expect(hasWiredGenerationAdapter(azureSora)).toBe(false);

  await expect(submitDanceVideo(photo(), clip(), azureSora)).rejects.toThrow(
    "Sora 2 · Azure AI Foundry has no wired adapter yet",
  );
});

test("provider route timeouts map to kind 'timeout'", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ error: "gateway timeout" }, { status: 504 })),
  );

  await expect(submitDanceVideo(photo(), clip(), replicateWan)).rejects.toMatchObject({
    kind: "timeout",
    message: "gateway timeout",
  });
});

test("retrying after a render failure reuses the uploads instead of re-uploading", async () => {
  const star = photo();
  const dance = clip();
  vi.mocked(fal.queue.status).mockRejectedValueOnce(falApiError(500, "boom"));
  await expect(generateDanceVideo(star, dance, wan, () => {})).rejects.toMatchObject({
    kind: "provider",
  });

  vi.mocked(fal.queue.result).mockResolvedValue({
    data: { video: { url: "https://fal.media/out.mp4" } },
    requestId: "r1",
  });
  vi.mocked(fal.storage.upload).mockClear();

  await expect(generateDanceVideo(star, dance, wan, () => {})).resolves.toBe(
    "blob:finalized-video",
  );
  expect(fal.storage.upload).not.toHaveBeenCalled();
});

test("moderation rejection blocks submission and throws with kind 'moderation'", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/moderate")) {
        return Response.json({ accepted: false, reason: "This photo can't be used for dancing." });
      }
      if (url.endsWith("/api/video/finalize")) {
        return new Response("final-video", { headers: { "Content-Type": "video/mp4" } });
      }
      return new Response(null, { status: 404 });
    }),
  );

  await expect(
    submitDanceVideo(photo(), clip(), wan),
  ).rejects.toMatchObject({
    kind: "moderation",
    message: "This photo can't be used for dancing.",
  });

  // Provider was never called — photo didn't reach fal.
  expect(fal.storage.upload).not.toHaveBeenCalled();
  expect(fal.queue.submit).not.toHaveBeenCalled();
});

test("a moderation server error does not block the run (best-effort)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/moderate")) {
        return new Response(null, { status: 500, statusText: "Internal Server Error" });
      }
      if (url.endsWith("/api/video/finalize")) {
        return new Response("final-video", { headers: { "Content-Type": "video/mp4" } });
      }
      return new Response(null, { status: 404 });
    }),
  );

  // Moderation 500 should be treated as accepted — run goes through.
  await expect(
    generateDanceVideo(photo(), clip(), wan, () => {}),
  ).resolves.toBe("blob:finalized-video");
  expect(console.warn).toHaveBeenCalledWith(
    "[dg:moderation-error]",
    expect.objectContaining({ status: 500 }),
  );
});

test("cleanupPhotoUpload deletes the fal URL and clears the cache", async () => {
  const star = photo();
  // Use a URL reference so only the photo is uploaded.
  await submitDanceVideo(star, "https://example.com/griddy.mp4", wan);
  expect(fal.storage.upload).toHaveBeenCalledTimes(1);

  await cleanupPhotoUpload(star);

  expect(fetch).toHaveBeenCalledWith(
    "/api/photo/cleanup",
    expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("fal.media"),
    }),
  );
});

test("photo upload uses a 1-hour TTL lifecycle to honour auto-expiry", async () => {
  await submitDanceVideo(photo(), "https://example.com/griddy.mp4", wan);

  expect(fal.storage.upload).toHaveBeenCalledWith(
    expect.any(File),
    expect.objectContaining({ lifecycle: { expiresIn: "1h" } }),
  );
});
