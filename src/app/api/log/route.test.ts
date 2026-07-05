import { beforeEach, expect, test, vi } from "vitest";
import { POST } from "./route";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

test("logs client generation errors for Aspire", async () => {
  const res = await POST(
    new Request("http://localhost/api/log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Referer: "http://localhost/studio",
        "User-Agent": "vitest",
      },
      body: JSON.stringify({
        phase: "generation",
        engineId: "kling-motion-control",
        error: { message: "image too large", requestId: "fal-req-422" },
      }),
    }),
  );

  await expect(res.json()).resolves.toEqual({ ok: true });
  expect(console.error).toHaveBeenCalledWith(
    "[dg:client-error]",
    expect.objectContaining({
      phase: "generation",
      engineId: "kling-motion-control",
      url: "http://localhost/studio",
      userAgent: "vitest",
      error: { message: "image too large", requestId: "fal-req-422" },
    }),
  );
});
