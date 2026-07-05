import { beforeEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import Studio from "./Studio";
import { GenerationError, generateDanceVideo } from "@/lib/generate";

// The wizard is driven through the DOM with the generation seam stubbed —
// GenerationError stays real so failure kinds mean what they mean in prod.
vi.mock("@/lib/generate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/generate")>();
  return { ...actual, generateDanceVideo: vi.fn() };
});

const generate = vi.mocked(generateDanceVideo);

beforeEach(() => {
  generate.mockReset();
  // jsdom has no object URLs; the wizard only needs a stable string.
  URL.createObjectURL = vi.fn(() => "blob:grandma");
  URL.revokeObjectURL = vi.fn();
  // No bundled reference clips unless a test serves them explicitly.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 404 })),
  );
});

/** Serve a reference clip at the given path; every other path stays 404. */
function serveClip(path: string) {
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (!url.toString().endsWith(path)) return new Response(null, { status: 404 });
    if (init?.method === "HEAD") return new Response(null, { status: 200 });
    return new Response("clip", { status: 200 });
  });
}

/** Upload a photo + a custom reference clip and hit "Make her dance". */
async function startRealRun(user: UserEvent) {
  render(<Studio />);
  await user.upload(
    screen.getByLabelText("Upload a photo of the star"),
    new File(["p"], "grandma.png", { type: "image/png" }),
  );
  await user.click(screen.getByRole("button", { name: "Pick her dance →" }));
  await user.upload(
    screen.getByLabelText("Upload your own reference dance video"),
    new File(["v"], "dance.mp4", { type: "video/mp4" }),
  );
  await user.click(screen.getByRole("button", { name: "Make her dance 💃" }));
}

test("a successful run lands on the done step with the rendered video", async () => {
  const user = userEvent.setup();
  generate.mockResolvedValue("https://fal.media/out.mp4");

  await startRealRun(user);

  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();
  expect(screen.getByLabelText("Your generated video").getAttribute("src")).toBe(
    "https://fal.media/out.mp4",
  );
});

test("a curated dance with a bundled clip renders for real", async () => {
  const user = userEvent.setup();
  serveClip("/dances/freestyle.mp4");
  generate.mockResolvedValue("https://fal.media/freestyle-out.mp4");

  render(<Studio />);
  await user.upload(
    screen.getByLabelText("Upload a photo of the star"),
    new File(["p"], "grandma.png", { type: "image/png" }),
  );
  await user.click(screen.getByRole("button", { name: "Pick her dance →" }));
  await user.click(await screen.findByRole("radio", { name: /street freestyle/i }));
  await user.click(screen.getByRole("button", { name: "Make her dance 💃" }));

  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();
  expect(screen.getByLabelText("Your generated video").getAttribute("src")).toBe(
    "https://fal.media/freestyle-out.mp4",
  );
  // A real render is the real thing — no demo-mode disclaimer.
  expect(screen.queryByText(/demo mode/i)).toBeNull();

  const clip = generate.mock.calls[0][1];
  expect(clip).toBeInstanceOf(File);
  expect((clip as File).name).toBe("freestyle.mp4");
});

test("dance cards mark only the dances whose reference clip exists as real renders", async () => {
  const user = userEvent.setup();
  serveClip("/dances/freestyle.mp4");

  render(<Studio />);
  await user.upload(
    screen.getByLabelText("Upload a photo of the star"),
    new File(["p"], "grandma.png", { type: "image/png" }),
  );
  await user.click(screen.getByRole("button", { name: "Pick her dance →" }));

  expect(
    await screen.findByRole("radio", { name: /street freestyle.*real render/i }),
  ).toBeDefined();
  // The Griddy's drop-in clip is missing, so it must not promise a real render.
  expect(screen.getByRole("radio", { name: /the griddy/i })).toBeDefined();
  expect(screen.queryByRole("radio", { name: /griddy.*real render/i })).toBeNull();
});

test("a provider error shows a friendly message and retry re-runs with the same files", async () => {
  const user = userEvent.setup();
  generate.mockRejectedValueOnce(new GenerationError("provider", "Internal server error"));
  generate.mockResolvedValueOnce("https://fal.media/retry.mp4");

  await startRealRun(user);

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Internal server error");
  expect(alert.textContent).toMatch(/try again/i);
  // Back on the dance step with the clip still loaded — nothing to re-upload.
  expect(screen.getByText(/“dance.mp4” loaded/)).toBeDefined();

  await user.click(screen.getByRole("button", { name: "Make her dance 💃" }));

  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();
  const [firstCall, retryCall] = generate.mock.calls;
  expect(retryCall[0]).toBe(firstCall[0]);
  expect(retryCall[1]).toBe(firstCall[1]);
});

test("a timeout says the render took too long and keeps the retry path open", async () => {
  const user = userEvent.setup();
  generate.mockRejectedValue(new GenerationError("timeout", "Request timed out"));

  await startRealRun(user);

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toMatch(/took too long/i);
  expect(alert.textContent).toMatch(/try again/i);
  expect(
    screen.getByRole("button", { name: "Make her dance 💃" }),
  ).toBeDefined();
});

test("a locked provider account closes the dance floor instead of showing the generic error", async () => {
  const user = userEvent.setup();
  generate.mockRejectedValue(
    new GenerationError(
      "unavailable",
      "User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing",
    ),
  );

  await startRealRun(user);

  expect(
    await screen.findByRole("heading", { name: /dance floor is closed/i }),
  ).toBeDefined();
  expect(screen.getByText(/back soon/i)).toBeDefined();
  expect(screen.queryByRole("alert")).toBeNull();

  // The way back keeps the photo and clip loaded for when the floor reopens.
  await user.click(screen.getByRole("button", { name: /back to the studio/i }));
  expect(
    await screen.findByRole("heading", { name: /pick the choreography/i }),
  ).toBeDefined();
  expect(screen.getByText(/“dance.mp4” loaded/)).toBeDefined();
});
