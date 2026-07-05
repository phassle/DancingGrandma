import { beforeEach, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import Studio from "./Studio";
import {
  GenerationError,
  generateDanceVideo,
  submitDanceVideo,
  trackDanceVideo,
} from "@/lib/generate";

// The wizard is driven through the DOM with the generation seam stubbed —
// GenerationError stays real so failure kinds mean what they mean in prod.
vi.mock("@/lib/generate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/generate")>();
  return {
    ...actual,
    generateDanceVideo: vi.fn(),
    submitDanceVideo: vi.fn(),
    trackDanceVideo: vi.fn(),
  };
});

const generate = vi.mocked(generateDanceVideo);
const submit = vi.mocked(submitDanceVideo);
const track = vi.mocked(trackDanceVideo);

beforeEach(() => {
  generate.mockReset();
  submit.mockReset();
  track.mockReset();
  submit.mockResolvedValue("req-1");
  track.mockResolvedValue("https://fal.media/out.mp4");
  localStorage.clear();
  // jsdom has no object URLs; the wizard only needs a stable string.
  URL.createObjectURL = vi.fn((value: Blob | MediaSource) =>
    value instanceof File && value.type.startsWith("video/")
      ? "blob:dance-preview"
      : "blob:grandma",
  );
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
  track.mockResolvedValue("https://fal.media/out.mp4");

  await startRealRun(user);

  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();
  expect(screen.getByLabelText("Your generated video").getAttribute("src")).toBe(
    "https://fal.media/out.mp4",
  );
});

test("a curated dance with a bundled clip renders for real", async () => {
  const user = userEvent.setup();
  serveClip("/dances/griddy.mp4");
  track.mockResolvedValue("https://fal.media/griddy-out.mp4");

  render(<Studio />);
  await user.upload(
    screen.getByLabelText("Upload a photo of the star"),
    new File(["p"], "grandma.png", { type: "image/png" }),
  );
  await user.click(screen.getByRole("button", { name: "Pick her dance →" }));
  await user.click(await screen.findByRole("radio", { name: /the griddy/i }));
  await user.click(screen.getByRole("button", { name: "Make her dance 💃" }));

  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();
  expect(screen.getByLabelText("Your generated video").getAttribute("src")).toBe(
    "https://fal.media/griddy-out.mp4",
  );
  // A real render is the real thing — no demo-mode disclaimer.
  expect(screen.queryByText(/demo mode/i)).toBeNull();

  const clip = submit.mock.calls[0][1];
  expect(clip).toBeInstanceOf(File);
  expect((clip as File).name).toBe("griddy.mp4");
});

test("dance cards mark only the dances whose reference clip exists as real renders", async () => {
  const user = userEvent.setup();
  // Only Griddy's clip is reachable in this test; the rest 404.
  serveClip("/dances/griddy.mp4");

  render(<Studio />);
  await user.upload(
    screen.getByLabelText("Upload a photo of the star"),
    new File(["p"], "grandma.png", { type: "image/png" }),
  );
  await user.click(screen.getByRole("button", { name: "Pick her dance →" }));

  expect(
    await screen.findByRole("radio", { name: /the griddy.*real render/i }),
  ).toBeDefined();
  // Renegade's clip is unreachable here, so it must not promise a real render.
  expect(screen.getByRole("radio", { name: /renegade/i })).toBeDefined();
  expect(screen.queryByRole("radio", { name: /renegade.*real render/i })).toBeNull();
});

test("a pasted video link can run through Kling with the URL handed through", async () => {
  const user = userEvent.setup();
  track.mockResolvedValue("https://fal.media/link-out.mp4");

  render(<Studio />);
  await user.upload(
    screen.getByLabelText("Upload a photo of the star"),
    new File(["p"], "grandma.png", { type: "image/png" }),
  );
  await user.click(screen.getByRole("button", { name: "Pick her dance →" }));
  await user.type(
    screen.getByLabelText(/paste a video link/i),
    "https://example.com/griddy.mp4",
  );
  await user.click(screen.getByRole("button", { name: /use this link/i }));

  // Direct video URLs can now use any wired fal engine.
  expect(screen.getByRole("link", { name: "Open source clip" }).getAttribute("href")).toBe(
    "https://example.com/griddy.mp4",
  );
  const kling = screen.getByRole("radio", { name: /kling/i }) as HTMLInputElement;
  expect(kling.disabled).toBe(false);
  await user.click(kling);

  await user.click(screen.getByRole("button", { name: "Make her dance 💃" }));

  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();
  expect(submit.mock.calls[0][1]).toBe("https://example.com/griddy.mp4");
  expect(submit.mock.calls[0][2]).toMatchObject({ id: "kling-motion-control" });
});

test("a YouTube page link imports a clip that can run through Kling", async () => {
  const user = userEvent.setup();
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = (typeof input === "string" ? input : (input as Request).url).toString();
    if (url.endsWith("/api/import")) {
      expect(JSON.parse(String(init?.body))).toEqual({
        url: "https://www.youtube.com/shorts/SJKl6PEXklU",
      });
      return new Response("transcoded-bytes", {
        status: 200,
        headers: { "Content-Type": "video/mp4", "X-Clip-Name": "griddy-tutorial.mp4" },
      });
    }
    return new Response(null, { status: 404 });
  });

  render(<Studio />);
  await user.upload(
    screen.getByLabelText("Upload a photo of the star"),
    new File(["p"], "grandma.png", { type: "image/png" }),
  );
  await user.click(screen.getByRole("button", { name: "Pick her dance →" }));
  await user.type(
    screen.getByLabelText(/paste a video link/i),
    "https://www.youtube.com/shorts/SJKl6PEXklU",
  );

  expect(screen.getByText(/ready to import/i)).toBeDefined();
  expect(screen.getByText("https://www.youtube.com/shorts/SJKl6PEXklU")).toBeDefined();
  expect(
    vi.mocked(fetch).mock.calls.some(([input]) =>
      (typeof input === "string" ? input : (input as Request).url)
        .toString()
        .endsWith("/api/import"),
    ),
  ).toBe(false);

  await user.click(screen.getByRole("button", { name: /use this link/i }));

  // The imported file is loaded under the name the route reported.
  expect(await screen.findByText(/“griddy-tutorial.mp4” loaded/)).toBeDefined();
  expect(screen.getByText(/validated mp4 ready/i)).toBeDefined();
  expect(screen.getByRole("link", { name: "Preview downloaded clip" }).getAttribute("href")).toBe(
    "blob:dance-preview",
  );
  expect(
    (screen.getByRole("button", { name: "Make her dance 💃" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);

  const kling = screen.getByRole("radio", { name: /kling/i }) as HTMLInputElement;
  expect(kling.disabled).toBe(false);
  await user.click(kling);
  await user.click(screen.getByRole("button", { name: "Make her dance 💃" }));

  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();
  expect(submit.mock.calls[0][1]).toBeInstanceOf(File);
  expect((submit.mock.calls[0][1] as File).name).toBe("griddy-tutorial.mp4");
  expect(submit.mock.calls[0][2]).toMatchObject({ id: "kling-motion-control" });
});

test("a failed import shows a helpful message, not a doomed run", async () => {
  const user = userEvent.setup();
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = (typeof input === "string" ? input : (input as Request).url).toString();
    if (url.endsWith("/api/import")) {
      return Response.json({ error: "Video unavailable" }, { status: 502 });
    }
    return new Response(null, { status: 404 });
  });

  render(<Studio />);
  await user.upload(
    screen.getByLabelText("Upload a photo of the star"),
    new File(["p"], "grandma.png", { type: "image/png" }),
  );
  await user.click(screen.getByRole("button", { name: "Pick her dance →" }));
  await user.type(
    screen.getByLabelText(/paste a video link/i),
    "https://www.youtube.com/watch?v=nope",
  );
  await user.click(screen.getByRole("button", { name: /use this link/i }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toMatch(/couldn't import/i);
  expect(alert.textContent).toMatch(/video unavailable/i);
  expect(
    (screen.getByRole("button", { name: "Make her dance 💃" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

test("pasting a video from the clipboard loads it as the reference clip", async () => {
  const user = userEvent.setup();

  render(<Studio />);
  await user.upload(
    screen.getByLabelText("Upload a photo of the star"),
    new File(["p"], "grandma.png", { type: "image/png" }),
  );
  await user.click(screen.getByRole("button", { name: "Pick her dance →" }));

  fireEvent.paste(window, {
    clipboardData: {
      files: [new File(["v"], "pasted.mov", { type: "video/quicktime" })],
      getData: () => "",
    },
  });

  expect(await screen.findByText(/“pasted.mov” loaded/)).toBeDefined();
  expect(screen.getByRole("link", { name: "Preview selected clip" }).getAttribute("href")).toBe(
    "blob:dance-preview",
  );
});

test("pasting a page link fills the link field without importing until clicked", async () => {
  const user = userEvent.setup();

  render(<Studio />);
  await user.upload(
    screen.getByLabelText("Upload a photo of the star"),
    new File(["p"], "grandma.png", { type: "image/png" }),
  );
  await user.click(screen.getByRole("button", { name: "Pick her dance →" }));

  fireEvent.paste(window, {
    clipboardData: {
      files: [],
      getData: () => "https://www.youtube.com/watch?v=abc123",
    },
  });

  expect(
    (screen.getByLabelText(/paste a video link/i) as HTMLInputElement).value,
  ).toBe("https://www.youtube.com/watch?v=abc123");
  expect(screen.getByText(/ready to import/i)).toBeDefined();
  expect(screen.getByText("https://www.youtube.com/watch?v=abc123")).toBeDefined();
  expect(
    vi.mocked(fetch).mock.calls.some(([input]) =>
      (typeof input === "string" ? input : (input as Request).url)
        .toString()
        .endsWith("/api/import"),
    ),
  ).toBe(false);
});

test("dropping a video file on the tile loads it as the reference clip", async () => {
  const user = userEvent.setup();

  render(<Studio />);
  await user.upload(
    screen.getByLabelText("Upload a photo of the star"),
    new File(["p"], "grandma.png", { type: "image/png" }),
  );
  await user.click(screen.getByRole("button", { name: "Pick her dance →" }));

  fireEvent.drop(screen.getByText(/got your own dance video/i), {
    dataTransfer: { files: [new File(["v"], "dropped.webm", { type: "video/webm" })] },
  });

  expect(await screen.findByText(/“dropped.webm” loaded/)).toBeDefined();
});

test("a provider error shows a friendly message and retry re-runs with the same files", async () => {
  const user = userEvent.setup();
  track.mockRejectedValueOnce(new GenerationError("provider", "Internal server error"));
  track.mockResolvedValueOnce("https://fal.media/retry.mp4");

  await startRealRun(user);

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Internal server error");
  expect(alert.textContent).toMatch(/try again/i);
  // Back on the dance step with the clip still loaded — nothing to re-upload.
  expect(screen.getByText(/“dance.mp4” loaded/)).toBeDefined();

  await user.click(screen.getByRole("button", { name: "Make her dance 💃" }));

  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();
  const [firstCall, retryCall] = submit.mock.calls;
  expect(retryCall[0]).toBe(firstCall[0]);
  expect(retryCall[1]).toBe(firstCall[1]);
});

test("a timeout says the render took too long and keeps the retry path open", async () => {
  const user = userEvent.setup();
  track.mockRejectedValue(new GenerationError("timeout", "Request timed out"));

  await startRealRun(user);

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toMatch(/took too long/i);
  expect(alert.textContent).toMatch(/try again/i);
  expect(
    screen.getByRole("button", { name: "Make her dance 💃" }),
  ).toBeDefined();
});

test("an unavailable provider shows a clearly labeled golden clip fallback", async () => {
  const user = userEvent.setup();
  track.mockRejectedValue(
    new GenerationError(
      "unavailable",
      "User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing",
    ),
  );

  await startRealRun(user);

  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();
  expect(screen.getByText(/pre-rendered sample/i)).toBeDefined();
  expect(screen.getByLabelText("Your generated video").getAttribute("src")).toBe(
    "/dances/griddy.mp4",
  );
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a real run stores the pending request id until the run reaches a terminal state", async () => {
  const user = userEvent.setup();
  let finish!: (url: string) => void;
  track.mockImplementation(
    () => new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );

  await startRealRun(user);

  await waitFor(() => {
    expect(JSON.parse(localStorage.getItem("dg:pending-run") ?? "null")).toMatchObject({
      requestId: "req-1",
      engineId: "wan-animate-fal",
      startedAt: expect.any(Number),
    });
  });

  await act(async () => {
    finish("https://fal.media/done.mp4");
  });

  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();
  expect(localStorage.getItem("dg:pending-run")).toBeNull();
});

test("a fresh mount resumes a pending run younger than 24 hours", async () => {
  localStorage.setItem(
    "dg:pending-run",
    JSON.stringify({
      requestId: "req-resume",
      engineId: "wan-animate-fal",
      danceName: "The Griddy",
      startedAt: Date.now() - 60_000,
    }),
  );
  track.mockResolvedValue("https://fal.media/resumed.mp4");

  render(<Studio />);

  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();
  expect(track).toHaveBeenCalledWith(
    "req-resume",
    expect.objectContaining({ id: "wan-animate-fal" }),
    expect.any(Function),
  );
  expect(screen.getByLabelText("Your generated video").getAttribute("src")).toBe(
    "https://fal.media/resumed.mp4",
  );
  expect(localStorage.getItem("dg:pending-run")).toBeNull();
});

test("an expired pending run is discarded on mount", () => {
  localStorage.setItem(
    "dg:pending-run",
    JSON.stringify({
      requestId: "req-old",
      engineId: "wan-animate-fal",
      danceName: "The Griddy",
      startedAt: Date.now() - 25 * 60 * 60 * 1000,
    }),
  );

  render(<Studio />);

  expect(screen.getByRole("heading", { name: /who's the star/i })).toBeDefined();
  expect(localStorage.getItem("dg:pending-run")).toBeNull();
  expect(track).not.toHaveBeenCalled();
});

test("a resumed run clears pending storage when it fails", async () => {
  localStorage.setItem(
    "dg:pending-run",
    JSON.stringify({
      requestId: "req-resume",
      engineId: "wan-animate-fal",
      danceName: "The Griddy",
      startedAt: Date.now() - 60_000,
    }),
  );
  track.mockRejectedValue(new GenerationError("provider", "Internal server error"));

  render(<Studio />);

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Internal server error");
  expect(localStorage.getItem("dg:pending-run")).toBeNull();
});

test("queue position updates and elapsed time are visible during a real run", async () => {
  const user = userEvent.setup();
  track.mockImplementation(
    async (_requestId, _engine, onUpdate) =>
      new Promise<string>(() => {
        onUpdate("#3 in line for the dance floor");
      }),
  );

  await startRealRun(user);

  expect(await screen.findByText("#3 in line for the dance floor")).toBeDefined();
  expect(screen.getByText("Queued")).toBeDefined();
  expect(screen.getByText("Queue")).toBeDefined();
  expect(screen.getByText("#3")).toBeDefined();
  expect(screen.getByText(/last update: just now/i)).toBeDefined();
  const progress = screen.getByRole("progressbar", { name: "Generating the video" });
  expect(Number(progress.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
  expect(Number(progress.getAttribute("aria-valuenow"))).toBeLessThan(100);
  expect(screen.getByText("Elapsed")).toBeDefined();
  expect(screen.getByText("0:00")).toBeDefined();

  await waitFor(() => expect(screen.getByText("0:01")).toBeDefined(), {
    timeout: 1500,
  });
});

test("beforeunload is active only while a real run is generating", async () => {
  const user = userEvent.setup();
  let finish!: (url: string) => void;
  track.mockImplementation(
    () => new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );

  await startRealRun(user);
  await waitFor(() => expect(track).toHaveBeenCalled());

  const leaving = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);

  await act(async () => {
    finish("https://fal.media/done.mp4");
  });
  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();

  const afterDone = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(afterDone);
  expect(afterDone.defaultPrevented).toBe(false);
});

test("simulated runs do not store pending runs or trigger the unload guard", async () => {
  const user = userEvent.setup();

  render(<Studio />);
  await user.upload(
    screen.getByLabelText("Upload a photo of the star"),
    new File(["p"], "grandma.png", { type: "image/png" }),
  );
  await user.click(screen.getByRole("button", { name: "Pick her dance →" }));
  await user.click(screen.getByRole("radio", { name: /the griddy/i }));
  await user.click(screen.getByRole("button", { name: "Make her dance 💃" }));

  expect(localStorage.getItem("dg:pending-run")).toBeNull();
  const leaving = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});
