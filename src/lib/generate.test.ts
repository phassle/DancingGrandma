import { beforeEach, expect, test, vi } from "vitest";
import { fal } from "@fal-ai/client";
import { generateDanceVideo } from "./generate";
import { ENGINES } from "./engines";

// The fal client is the system boundary — everything below it is mocked.
vi.mock("@fal-ai/client", () => ({
  fal: {
    config: vi.fn(),
    storage: { upload: vi.fn() },
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
const photo = () => new File(["p"], "grandma.png", { type: "image/png" });
const clip = () => new File(["v"], "dance.mp4", { type: "video/mp4" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fal.storage.upload).mockResolvedValue("https://fal.media/files/x");
});

test("balance-exhausted 403 rejects with kind 'unavailable'", async () => {
  vi.mocked(fal.storage.upload).mockRejectedValue(falApiError(403, LOCKED_DETAIL));

  await expect(
    generateDanceVideo(photo(), clip(), wan, () => {}),
  ).rejects.toMatchObject({ kind: "unavailable" });
});

test("a fal timeout rejects with kind 'timeout'", async () => {
  // startTimeout expiries surface as ApiError with timeoutType "user".
  vi.mocked(fal.subscribe).mockRejectedValue(
    falApiError(408, "Request timed out", { timeoutType: "user" }),
  );

  await expect(
    generateDanceVideo(photo(), clip(), wan, () => {}),
  ).rejects.toMatchObject({ kind: "timeout" });
});

test("a render-stage provider failure rejects with kind 'provider'", async () => {
  vi.mocked(fal.subscribe).mockRejectedValue(
    falApiError(500, "Internal server error"),
  );

  await expect(
    generateDanceVideo(photo(), clip(), wan, () => {}),
  ).rejects.toMatchObject({ kind: "provider", message: "Internal server error" });
});

test("a URL reference is handed straight to Wan without uploading it", async () => {
  vi.mocked(fal.subscribe).mockResolvedValue({
    data: { video: { url: "https://fal.media/out.mp4" } },
    requestId: "r2",
  });

  await expect(
    generateDanceVideo(photo(), "https://example.com/griddy.mp4", wan, () => {}),
  ).resolves.toBe("https://fal.media/out.mp4");

  // Only the photo is uploaded; the clip URL goes into the input as-is.
  expect(fal.storage.upload).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fal.subscribe).mock.calls[0][1]).toMatchObject({
    input: { video_url: "https://example.com/griddy.mp4" },
  });
});

test("retrying after a render failure reuses the uploads instead of re-uploading", async () => {
  const star = photo();
  const dance = clip();
  vi.mocked(fal.subscribe).mockRejectedValueOnce(falApiError(500, "boom"));
  await expect(generateDanceVideo(star, dance, wan, () => {})).rejects.toMatchObject({
    kind: "provider",
  });

  vi.mocked(fal.subscribe).mockResolvedValue({
    data: { video: { url: "https://fal.media/out.mp4" } },
    requestId: "r1",
  });
  vi.mocked(fal.storage.upload).mockClear();

  await expect(generateDanceVideo(star, dance, wan, () => {})).resolves.toBe(
    "https://fal.media/out.mp4",
  );
  expect(fal.storage.upload).not.toHaveBeenCalled();
});
