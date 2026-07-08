import { beforeEach, expect, test, vi } from "vitest";
import { moderatePhoto } from "./generate";
import { DEFAULT_ENGINE, ENGINES } from "./engines";

const photo = () => new File(["p"], "grandma.png", { type: "image/png" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

test("Kling is the default recommended engine", () => {
  expect(DEFAULT_ENGINE.id).toBe("kling-motion-control");
  expect(ENGINES[0].id).toBe("kling-motion-control");
  expect(ENGINES[0].status).toBe("recommended");
});

test("moderation rejection throws with kind 'moderation'", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ accepted: false, reason: "This photo can't be used for dancing." }),
    ),
  );

  await expect(moderatePhoto(photo())).rejects.toMatchObject({
    kind: "moderation",
    message: "This photo can't be used for dancing.",
  });
});

test("a moderation server error does not block the run (best-effort)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 500, statusText: "Internal Server Error" })),
  );

  await expect(moderatePhoto(photo())).resolves.toBeUndefined();
  expect(console.warn).toHaveBeenCalledWith(
    "[dg:moderation-error]",
    expect.objectContaining({ status: 500 }),
  );
});

test("a moderation network error does not block the run (best-effort)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("offline");
    }),
  );

  await expect(moderatePhoto(photo())).resolves.toBeUndefined();
  expect(console.warn).toHaveBeenCalledWith("[dg:moderation-fetch-error]", "offline");
});
