// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  fetchActivePaidGeneration,
  PaidGenerationError,
  startPaidGeneration,
  trackPaidGeneration,
} from "./paid-generation";

/**
 * The browser-side seam for durable paid runs (issue #57): start against the
 * authenticated server route, poll the job until terminal, resume the latest
 * non-terminal job after a reload. The fetch boundary is faked; assertions
 * are on requests made and results/errors surfaced.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const submitted = {
  id: "gen-1",
  engineId: "wan-animate-fal",
  status: "submitted",
  requestId: "req-1",
  blobPath: null,
  errorKind: null,
  error: null,
};

test("startPaidGeneration posts the draft as form data and returns the job", async () => {
  fetchMock.mockResolvedValue(jsonResponse({ generation: submitted, wallet: { available: 0, reserved: 1 } }, 201));

  const photo = new File([new Uint8Array([1])], "grandma.jpg", { type: "image/jpeg" });
  const generation = await startPaidGeneration(photo, "https://example.com/dance.mp4", "wan-animate-fal");

  expect(generation).toMatchObject({ id: "gen-1", status: "submitted" });
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/generations");
  expect(init.method).toBe("POST");
  const form = init.body as FormData;
  expect(form.get("engineId")).toBe("wan-animate-fal");
  expect(form.get("referenceUrl")).toBe("https://example.com/dance.mp4");
  expect(form.get("photo")).toBe(photo);
});

test("insufficient credits surfaces a checkout action", async () => {
  // Responses are single-use; mint a fresh one per call.
  fetchMock.mockImplementation(async () =>
    jsonResponse({ error: "insufficient_credits", action: "checkout" }, 402),
  );

  const photo = new File([new Uint8Array([1])], "grandma.jpg", { type: "image/jpeg" });
  const attempt = startPaidGeneration(photo, "https://example.com/dance.mp4", "wan-animate-fal");

  await expect(attempt).rejects.toBeInstanceOf(PaidGenerationError);
  await expect(
    startPaidGeneration(photo, "https://example.com/dance.mp4", "wan-animate-fal"),
  ).rejects.toMatchObject({ kind: "insufficient_credits", action: "checkout" });
});

test("an unauthenticated start asks for sign-in", async () => {
  fetchMock.mockResolvedValue(jsonResponse({ error: "unauthenticated" }, 401));

  const photo = new File([new Uint8Array([1])], "grandma.jpg", { type: "image/jpeg" });
  await expect(
    startPaidGeneration(photo, "https://example.com/dance.mp4", "wan-animate-fal"),
  ).rejects.toMatchObject({ kind: "unauthenticated" });
});

test("trackPaidGeneration polls the job route until it completes", async () => {
  const updates: string[] = [];
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ generation: { ...submitted, status: "running" } }))
    .mockResolvedValueOnce(jsonResponse({ generation: { ...submitted, status: "finalizing" } }))
    .mockResolvedValueOnce(
      jsonResponse({ generation: { ...submitted, status: "completed", blobPath: "gen-1.mp4" } }),
    );

  const done = await trackPaidGeneration("gen-1", (status) => updates.push(status), { pollMs: 1 });

  expect(done).toMatchObject({ status: "completed", blobPath: "gen-1.mp4" });
  expect(updates).toEqual(["running", "finalizing"]);
  expect(fetchMock).toHaveBeenCalledWith("/api/generations/gen-1", expect.anything());
});

test("trackPaidGeneration throws with the job's error kind when it fails", async () => {
  fetchMock.mockResolvedValue(
    jsonResponse({
      generation: { ...submitted, status: "failed", errorKind: "provider", error: "render exploded" },
    }),
  );

  await expect(trackPaidGeneration("gen-1", () => {}, { pollMs: 1 })).rejects.toMatchObject({
    kind: "provider",
    message: "render exploded",
  });
});

test("fetchActivePaidGeneration resumes the latest non-terminal job", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ generation: submitted }));
  await expect(fetchActivePaidGeneration()).resolves.toMatchObject({ id: "gen-1" });
  expect(fetchMock).toHaveBeenCalledWith("/api/generations", expect.anything());

  fetchMock.mockResolvedValueOnce(jsonResponse({ generation: null }));
  await expect(fetchActivePaidGeneration()).resolves.toBeNull();
});
