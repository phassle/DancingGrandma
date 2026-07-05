import { beforeEach, expect, test, vi } from "vitest";
import { fal } from "@fal-ai/client";
import {
  generateDanceVideo,
  hasWiredGenerationAdapter,
  submitDanceVideo,
  trackDanceVideo,
} from "./generate";
import { ENGINES } from "./engines";

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
  detail: string,
  extras: Record<string, unknown> = {},
): Error {
  return Object.assign(new Error(detail), { status, body: { detail }, ...extras });
}

const wan = ENGINES.find((e) => e.id === "wan-animate-fal")!;
const replicateWan = ENGINES.find((e) => e.id === "wan-animate-replicate")!;
const azureSora = ENGINES.find((e) => e.id === "sora-2-azure")!;
const photo = () => new File(["p"], "grandma.png", { type: "image/png" });
const clip = () => new File(["v"], "dance.mp4", { type: "video/mp4" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
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
