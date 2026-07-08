import { beforeEach, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import Studio from "./Studio";
import { GenerationError } from "@/lib/generate";
import {
  AuthRequiredError,
  createServerGeneration,
  fetchAccount,
  redirectTo,
  startCheckout,
  trackServerGeneration,
} from "@/lib/server-generation";
import { clearDraft, loadDraft, saveDraft } from "@/lib/draft";

// The wizard is driven through the DOM with the paid-generation seam stubbed —
// GenerationError and the gate error classes stay real so failure kinds mean
// what they mean in prod.
vi.mock("@/lib/server-generation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server-generation")>();
  return {
    ...actual,
    fetchAccount: vi.fn(),
    startCheckout: vi.fn(),
    createServerGeneration: vi.fn(),
    trackServerGeneration: vi.fn(),
    redirectTo: vi.fn(),
  };
});

// Draft persistence is IndexedDB-backed (covered by draft.test.ts); here it
// only matters that the wizard saves/restores at the right moments.
vi.mock("@/lib/draft", () => ({
  saveDraft: vi.fn(),
  loadDraft: vi.fn(),
  clearDraft: vi.fn(),
}));

const account = vi.mocked(fetchAccount);
const checkout = vi.mocked(startCheckout);
const create = vi.mocked(createServerGeneration);
const track = vi.mocked(trackServerGeneration);
const redirect = vi.mocked(redirectTo);
const save = vi.mocked(saveDraft);
const load = vi.mocked(loadDraft);
const clear = vi.mocked(clearDraft);

const GATE_COPY =
  "Create an account to save your video. Generation uses 1 credit. The monthly plan is $9.99 and includes 5 credits.";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Default: a signed-in subscriber with credits — the happy paid path.
  account.mockResolvedValue({ status: "signed-in", credits: 5 });
  checkout.mockResolvedValue("https://checkout.stripe.com/c/session");
  create.mockResolvedValue({ id: "gen-1" });
  track.mockResolvedValue("https://fal.media/out.mp4");
  save.mockResolvedValue(undefined);
  load.mockResolvedValue(null);
  clear.mockResolvedValue(undefined);
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
  await user.click(screen.getByLabelText("I have permission to use this photo"));
  await user.click(screen.getByRole("button", { name: "Pick her dance →" }));
  await user.upload(
    screen.getByLabelText("Upload your own reference dance video"),
    new File(["v"], "dance.mp4", { type: "video/mp4" }),
  );
  await user.click(screen.getByRole("button", { name: "Make her dance 💃" }));
}

test("a successful run recreates the draft server-side and lands on the done step", async () => {
  const user = userEvent.setup();
  track.mockResolvedValue("/api/video/gen-1");

  await startRealRun(user);

  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();
  expect(create).toHaveBeenCalledTimes(1);
  const input = create.mock.calls[0][0];
  expect((input.photo as File).name).toBe("grandma.png");
  expect((input.reference as File).name).toBe("dance.mp4");
  expect(input.sourceKind).toBe("upload");
  expect(input.engineId).toBe("kling-motion-control");
  expect(track).toHaveBeenCalledWith("gen-1", expect.any(Function));
  expect(screen.getByLabelText("Your generated video").getAttribute("src")).toBe(
    "/api/video/gen-1",
  );
});

test("download fetches the rendered video and starts a file download", async () => {
  const user = userEvent.setup();
  const anchorClick = vi.fn();
  const createdAnchors: HTMLAnchorElement[] = [];
  track.mockResolvedValue("https://fal.media/out.mp4");
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url === "https://fal.media/out.mp4") {
      return new Response("video-bytes", {
        status: 200,
        headers: { "Content-Type": "video/mp4" },
      });
    }
    return new Response(null, { status: 404 });
  });

  await startRealRun(user);
  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();

  const originalCreateElement = document.createElement.bind(document);
  const createElement = vi.spyOn(document, "createElement");
  createElement.mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
    const element = originalCreateElement(tagName, options);
    if (tagName.toLowerCase() === "a") {
      const createdAnchor = element as HTMLAnchorElement;
      createdAnchors.push(createdAnchor);
      createdAnchor.click = anchorClick;
    }
    return element;
  }) as typeof document.createElement);

  await user.click(screen.getByRole("button", { name: "Download" }));

  expect(fetch).toHaveBeenCalledWith("https://fal.media/out.mp4");
  expect(createdAnchors[0].download).toBe("dancing-grandma.mp4");
  expect(createdAnchors[0].href).toBe("blob:grandma");
  expect(anchorClick).toHaveBeenCalled();
  expect(await screen.findByText(/download started/i)).toBeDefined();
});

test("share copies the persistent /v/{id} link for real renders", async () => {
  const user = userEvent.setup();
  const writeText = vi.fn().mockResolvedValue(undefined);
  track.mockResolvedValue("/api/video/11111111-1111-4111-8111-111111111111");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });

  await startRealRun(user);
  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();

  await user.click(screen.getByRole("button", { name: "Share the chaos" }));

  await waitFor(() => expect(writeText).toHaveBeenCalled());
  expect(writeText).toHaveBeenCalledWith(
    "http://localhost:3000/v/11111111-1111-4111-8111-111111111111",
  );
});

test("Kling is the preselected recommended engine", async () => {
  const user = userEvent.setup();

  render(<Studio />);
  await user.upload(
    screen.getByLabelText("Upload a photo of the star"),
    new File(["p"], "grandma.png", { type: "image/png" }),
  );
  await user.click(screen.getByLabelText("I have permission to use this photo"));
  await user.click(screen.getByRole("button", { name: "Pick her dance →" }));

  expect(screen.getByRole("radio", { name: /kling 2.6 motion control/i })).toHaveProperty(
    "checked",
    true,
  );
  expect(screen.getByText("our pick")).toBeDefined();
});

test("a valid draft shows a ready-to-generate summary", async () => {
  const user = userEvent.setup();

  render(<Studio />);
  await user.upload(
    screen.getByLabelText("Upload a photo of the star"),
    new File(["p"], "grandma.png", { type: "image/png" }),
  );
  await user.click(screen.getByLabelText("I have permission to use this photo"));
  await user.click(screen.getByRole("button", { name: "Pick her dance →" }));

  // No summary until a reference is chosen.
  expect(screen.queryByText(/ready to generate/i)).toBeNull();

  await user.upload(
    screen.getByLabelText("Upload your own reference dance video"),
    new File(["v"], "dance.mp4", { type: "video/mp4" }),
  );

  const summary = screen.getByText(/ready to generate/i).closest("p");
  expect(summary?.textContent).toContain("grandma.png");
  expect(summary?.textContent).toContain("dance.mp4");
  expect(summary?.textContent).toContain("Kling");
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
  await user.click(screen.getByLabelText("I have permission to use this photo"));
  await user.click(screen.getByRole("button", { name: "Pick her dance →" }));
  await user.click(await screen.findByRole("radio", { name: /the griddy/i }));
  await user.click(screen.getByRole("button", { name: "Make her dance 💃" }));

  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();
  expect(screen.getByLabelText("Your generated video").getAttribute("src")).toBe(
    "https://fal.media/griddy-out.mp4",
  );
  // A real render is the real thing — no demo-mode disclaimer.
  expect(screen.queryByText(/demo mode/i)).toBeNull();

  const input = create.mock.calls[0][0];
  expect(input.reference).toBeInstanceOf(File);
  expect((input.reference as File).name).toBe("griddy.mp4");
  expect(input.sourceKind).toBe("curated");
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
  await user.click(screen.getByLabelText("I have permission to use this photo"));
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
  await user.click(screen.getByLabelText("I have permission to use this photo"));
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
  const input = create.mock.calls[0][0];
  expect(input.reference).toBe("https://example.com/griddy.mp4");
  expect(input.sourceKind).toBe("direct_url");
  expect(input.engineId).toBe("kling-motion-control");
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
  await user.click(screen.getByLabelText("I have permission to use this photo"));
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
  const input = create.mock.calls[0][0];
  expect(input.reference).toBeInstanceOf(File);
  expect((input.reference as File).name).toBe("griddy-tutorial.mp4");
  expect(input.sourceKind).toBe("imported_url");
  expect(input.engineId).toBe("kling-motion-control");
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
  await user.click(screen.getByLabelText("I have permission to use this photo"));
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
  await user.click(screen.getByLabelText("I have permission to use this photo"));
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
  await user.click(screen.getByLabelText("I have permission to use this photo"));
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
  await user.click(screen.getByLabelText("I have permission to use this photo"));
  await user.click(screen.getByRole("button", { name: "Pick her dance →" }));

  fireEvent.drop(screen.getByText(/got your own dance video/i), {
    dataTransfer: { files: [new File(["v"], "dropped.webm", { type: "video/webm" })] },
  });

  expect(await screen.findByText(/“dropped.webm” loaded/)).toBeDefined();
});

// --- The generation gate (issue #58) ---

test("an anonymous start opens the gate with the exact deal copy and uploads nothing", async () => {
  const user = userEvent.setup();
  account.mockResolvedValue({ status: "anonymous" });

  await startRealRun(user);

  const gate = await screen.findByRole("dialog");
  expect(gate.textContent).toContain(GATE_COPY);
  // The prepared draft stays visible behind the modal.
  expect(screen.getByText(/“dance.mp4” loaded/)).toBeDefined();
  expect(screen.getByRole("heading", { name: /pick the choreography/i })).toBeDefined();
  // Nothing personal reached any server: no recreation, no draft stash yet.
  expect(create).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(
    vi.mocked(fetch).mock.calls.some(([input]) => {
      const url = (typeof input === "string" ? input : (input as Request).url).toString();
      return url.includes("/api/generations") || url.includes("/api/moderate");
    }),
  ).toBe(false);
});

test("backing out of the gate returns to the intact draft", async () => {
  const user = userEvent.setup();
  account.mockResolvedValue({ status: "anonymous" });

  await startRealRun(user);
  await screen.findByRole("dialog");

  await user.click(screen.getByRole("button", { name: /not now — keep my draft/i }));

  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByText(/“dance.mp4” loaded/)).toBeDefined();
  expect(
    (screen.getByRole("button", { name: "Make her dance 💃" }) as HTMLButtonElement).disabled,
  ).toBe(false);
  expect(create).not.toHaveBeenCalled();
});

test("continuing from the gate stashes the draft browser-side and heads to sign-in", async () => {
  const user = userEvent.setup();
  account.mockResolvedValue({ status: "anonymous" });

  await startRealRun(user);
  await screen.findByRole("dialog");

  await user.click(screen.getByRole("button", { name: /create account or sign in/i }));

  await waitFor(() => expect(redirect).toHaveBeenCalledWith("/api/auth/login"));
  expect(save).toHaveBeenCalledTimes(1);
  const draft = save.mock.calls[0][0];
  expect(draft.photo.name).toBe("grandma.png");
  expect(draft.engineId).toBe("kling-motion-control");
  expect(draft.reference).toMatchObject({ kind: "clip", source: "uploaded" });
  // Still no upload — the draft went to IndexedDB, not the network.
  expect(create).not.toHaveBeenCalled();
});

test("a signed-in user with an empty wallet is routed to checkout with the draft stashed", async () => {
  const user = userEvent.setup();
  account.mockResolvedValue({ status: "signed-in", credits: 0 });

  await startRealRun(user);

  await waitFor(() =>
    expect(redirect).toHaveBeenCalledWith("https://checkout.stripe.com/c/session"),
  );
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(create).not.toHaveBeenCalled();
});

test("a checkout that cannot start leaves the draft on screen with an honest error", async () => {
  const user = userEvent.setup();
  account.mockResolvedValue({ status: "signed-in", credits: 0 });
  checkout.mockRejectedValue(new Error("already_subscribed"));

  await startRealRun(user);

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toMatch(/couldn't open checkout/i);
  expect(screen.getByText(/“dance.mp4” loaded/)).toBeDefined();
  expect(redirect).not.toHaveBeenCalled();
});

test("an expired session at start reopens the gate instead of failing the run", async () => {
  const user = userEvent.setup();
  create.mockRejectedValue(new AuthRequiredError());

  await startRealRun(user);

  expect(await screen.findByRole("dialog")).toBeDefined();
  expect(screen.getByText(/“dance.mp4” loaded/)).toBeDefined();
});

test("a restored draft after sign-in with credits starts generation automatically", async () => {
  load.mockResolvedValue({
    photo: new File(["p"], "grandma.png", { type: "image/png" }),
    reference: {
      kind: "clip",
      file: new File(["v"], "dance.mp4", { type: "video/mp4" }),
      source: "uploaded",
    },
    engineId: "kling-motion-control",
    savedAt: Date.now(),
  });
  let finish!: (url: string) => void;
  track.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );

  render(<Studio />);

  // One continuous flow: the draft is recreated server-side and the run starts.
  expect(await screen.findByRole("heading", { name: /hold my knitting/i })).toBeDefined();
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  const input = create.mock.calls[0][0];
  expect((input.photo as File).name).toBe("grandma.png");
  expect((input.reference as File).name).toBe("dance.mp4");
  expect(input.sourceKind).toBe("upload");
  expect(clear).toHaveBeenCalled();

  await act(async () => {
    finish("/api/video/gen-1");
  });
  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();
});

test("a restored draft with an empty wallet goes straight to checkout and survives the detour", async () => {
  load.mockResolvedValue({
    photo: new File(["p"], "grandma.png", { type: "image/png" }),
    reference: {
      kind: "clip",
      file: new File(["v"], "dance.mp4", { type: "video/mp4" }),
      source: "uploaded",
    },
    engineId: "kling-motion-control",
    savedAt: Date.now(),
  });
  account.mockResolvedValue({ status: "signed-in", credits: 0 });

  render(<Studio />);

  await waitFor(() =>
    expect(redirect).toHaveBeenCalledWith("https://checkout.stripe.com/c/session"),
  );
  // The stored draft must survive the Stripe roundtrip.
  expect(clear).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

test("a restored draft for a signed-out visitor lands back on the intact dance step", async () => {
  load.mockResolvedValue({
    photo: new File(["p"], "grandma.png", { type: "image/png" }),
    reference: {
      kind: "clip",
      file: new File(["v"], "dance.mp4", { type: "video/mp4" }),
      source: "uploaded",
    },
    engineId: "kling-motion-control",
    savedAt: Date.now(),
  });
  account.mockResolvedValue({ status: "anonymous" });

  render(<Studio />);

  expect(
    await screen.findByRole("heading", { name: /pick the choreography/i }),
  ).toBeDefined();
  expect(screen.getByText(/“dance.mp4” loaded/)).toBeDefined();
  await waitFor(() => expect(clear).toHaveBeenCalled());
  expect(redirect).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});

test("a restored curated draft re-checks the bundled clip before auto-starting", async () => {
  serveClip("/dances/griddy.mp4");
  load.mockResolvedValue({
    photo: new File(["p"], "grandma.png", { type: "image/png" }),
    reference: { kind: "curated", danceId: "griddy" },
    engineId: "kling-motion-control",
    savedAt: Date.now(),
  });
  track.mockResolvedValue("/api/video/gen-1");

  render(<Studio />);

  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();
  const input = create.mock.calls[0][0];
  expect((input.reference as File).name).toBe("griddy.mp4");
  expect(input.sourceKind).toBe("curated");
});

// --- Run lifecycle over the durable server workflow ---

test("a provider error shows a friendly message and retry re-runs with the same files", async () => {
  const user = userEvent.setup();
  track.mockRejectedValueOnce(new GenerationError("provider", "Internal server error"));
  track.mockResolvedValueOnce("https://fal.media/retry.mp4");

  await startRealRun(user);

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Internal server error");
  expect(alert.textContent).toMatch(/try again/i);
  await waitFor(() => {
    expect(fetch).toHaveBeenCalledWith(
      "/api/log",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Internal server error"),
      }),
    );
  });
  // Back on the dance step with the clip still loaded — nothing to re-upload.
  expect(screen.getByText(/“dance.mp4” loaded/)).toBeDefined();

  await user.click(screen.getByRole("button", { name: "Make her dance 💃" }));

  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();
  const [firstCall, retryCall] = create.mock.calls;
  expect(retryCall[0].photo).toBe(firstCall[0].photo);
  expect(retryCall[0].reference).toBe(firstCall[0].reference);
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

test("an oversized provider image error tells the user to pick the photo again", async () => {
  const user = userEvent.setup();
  create.mockRejectedValue(
    new GenerationError(
      "provider",
      "body.image_url: Image dimensions are too large. Maximum dimensions are 3850x3850 pixels.",
      {
        status: 422,
        requestId: "fal-req-422",
        code: "image_too_large",
      },
    ),
  );

  await startRealRun(user);

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toMatch(/photo was too large/i);
  expect(alert.textContent).toMatch(/resizes large photos/i);
  expect(alert.textContent).toContain("fal-req-422");
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
    "/dances/renegade.mp4",
  );
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a real run stores the pending generation id until the run reaches a terminal state", async () => {
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
      generationId: "gen-1",
      engineId: "kling-motion-control",
      startedAt: expect.any(Number),
    });
  });

  await act(async () => {
    finish("/api/video/gen-1");
  });

  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();
  expect(localStorage.getItem("dg:pending-run")).toBeNull();
});

test("a fresh mount resumes a pending run younger than 24 hours", async () => {
  localStorage.setItem(
    "dg:pending-run",
    JSON.stringify({
      generationId: "gen-resume",
      engineId: "wan-animate-fal",
      danceName: "The Griddy",
      startedAt: Date.now() - 60_000,
    }),
  );
  track.mockResolvedValue("/api/video/gen-resume");

  render(<Studio />);

  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();
  expect(track).toHaveBeenCalledWith("gen-resume", expect.any(Function));
  // The tab resumes the server job — no new generation is created.
  expect(create).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Your generated video").getAttribute("src")).toBe(
    "/api/video/gen-resume",
  );
  expect(localStorage.getItem("dg:pending-run")).toBeNull();
});

test("an expired pending run is discarded on mount", () => {
  localStorage.setItem(
    "dg:pending-run",
    JSON.stringify({
      generationId: "gen-old",
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
      generationId: "gen-resume",
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
    async (_generationId, onUpdate) =>
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
    finish("/api/video/gen-1");
  });
  expect(await screen.findByRole("heading", { name: /she ate/i })).toBeDefined();

  const afterDone = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(afterDone);
  expect(afterDone.defaultPrevented).toBe(false);
});

test("simulated runs skip the gate and never store pending runs or block unload", async () => {
  const user = userEvent.setup();
  account.mockResolvedValue({ status: "anonymous" });

  render(<Studio />);
  await user.upload(
    screen.getByLabelText("Upload a photo of the star"),
    new File(["p"], "grandma.png", { type: "image/png" }),
  );
  await user.click(screen.getByLabelText("I have permission to use this photo"));
  await user.click(screen.getByRole("button", { name: "Pick her dance →" }));
  await user.click(screen.getByRole("radio", { name: /the griddy/i }));
  await user.click(screen.getByRole("button", { name: "Make her dance 💃" }));

  // A demo run is free: no gate, no server job, no unload guard.
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(localStorage.getItem("dg:pending-run")).toBeNull();
  const leaving = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(false);
  expect(create).not.toHaveBeenCalled();
});

test("consent checkbox must be checked before proceeding to the dance step", async () => {
  const user = userEvent.setup();

  render(<Studio />);
  await user.upload(
    screen.getByLabelText("Upload a photo of the star"),
    new File(["p"], "grandma.png", { type: "image/png" }),
  );

  // Button is disabled before consent is given.
  expect(
    (screen.getByRole("button", { name: "Pick her dance →" }) as HTMLButtonElement).disabled,
  ).toBe(true);

  await user.click(screen.getByLabelText("I have permission to use this photo"));

  // Button is now enabled.
  expect(
    (screen.getByRole("button", { name: "Pick her dance →" }) as HTMLButtonElement).disabled,
  ).toBe(false);

  await user.click(screen.getByRole("button", { name: "Pick her dance →" }));
  expect(screen.getByRole("heading", { name: /pick the choreography/i })).toBeDefined();
});

test("moderation rejection returns to the photo step with an affectionate message", async () => {
  const user = userEvent.setup();
  create.mockRejectedValue(
    new GenerationError("moderation", "This photo can't be used for dancing. Please choose another."),
  );

  await startRealRun(user);

  // Wizard returns to the photo step with the rejection message.
  expect(await screen.findByRole("heading", { name: /who's the star/i })).toBeDefined();
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toMatch(/can't be used for dancing/i);

  // The rejected photo is cleared — user must pick a new one.
  expect(
    (screen.getByRole("button", { name: "Pick her dance →" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
