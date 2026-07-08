import { beforeEach, expect, test, vi } from "vitest";
import { GenerationError } from "./generate";
import {
  AuthRequiredError,
  CheckoutRequiredError,
  createServerGeneration,
  fetchAccount,
  startCheckout,
  trackServerGeneration,
} from "./server-generation";

/**
 * The client seam to the durable paid workflow (issue #58, PRD #54):
 * account/credit checks for the generation gate, Stripe Checkout kickoff,
 * server-side draft recreation (POST /api/generations), and tracking a
 * running job by polling the status route.
 */

type Handler = (input: string, init?: RequestInit) => Promise<Response> | Response;

function stubFetch(handler: Handler) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      return handler(url.toString(), init);
    }),
  );
}

/** Accept every photo at /api/moderate; delegate the rest. */
function withModerationAccepted(handler: Handler): Handler {
  return (url, init) => {
    if (url.endsWith("/api/moderate")) return Response.json({ accepted: true });
    return handler(url, init);
  };
}

const photo = () => new File([new Uint8Array([1, 2, 3])], "grandma.png", { type: "image/png" });
const clip = () => new File([new Uint8Array([9])], "dance.mp4", { type: "video/mp4" });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("fetchAccount reports a signed-in user's spendable credits", async () => {
  stubFetch((url) => {
    expect(url).toContain("/api/me");
    return Response.json({
      user: { id: "u1", email: "grandma@example.com", displayName: "Grandma" },
      wallet: { available: 3, reserved: 1 },
    });
  });

  expect(await fetchAccount()).toEqual({ status: "signed-in", credits: 3, name: "Grandma" });
});

test("fetchAccount treats 401 and network failures as anonymous", async () => {
  stubFetch(() => Response.json({ error: "unauthenticated" }, { status: 401 }));
  expect(await fetchAccount()).toEqual({ status: "anonymous" });

  stubFetch(() => Promise.reject(new Error("offline")));
  expect(await fetchAccount()).toEqual({ status: "anonymous" });
});

test("startCheckout returns the hosted Checkout url", async () => {
  stubFetch((url, init) => {
    expect(url).toContain("/api/billing/checkout");
    expect(init?.method).toBe("POST");
    return Response.json({ url: "https://checkout.stripe.com/c/session" });
  });

  expect(await startCheckout()).toBe("https://checkout.stripe.com/c/session");
});

test("startCheckout throws when checkout can't be created", async () => {
  stubFetch(() => Response.json({ error: "already_subscribed" }, { status: 409 }));
  await expect(startCheckout()).rejects.toThrow(/already_subscribed/);
});

test("createServerGeneration recreates the draft as multipart form data (url reference)", async () => {
  let form: FormData | undefined;
  stubFetch(
    withModerationAccepted((url, init) => {
      expect(url).toContain("/api/generations");
      form = init?.body as FormData;
      return Response.json(
        { generation: { id: "gen-1", requestId: "req-1", status: "submitted" } },
        { status: 201 },
      );
    }),
  );

  const created = await createServerGeneration({
    photo: photo(),
    reference: "https://example.com/dance.mp4",
    sourceKind: "direct_url",
    engineId: "kling-motion-control",
  });

  expect(created).toEqual({ id: "gen-1" });
  expect(form).toBeDefined();
  expect((form!.get("photo") as File).name).toBe("grandma.png");
  expect(form!.get("referenceUrl")).toBe("https://example.com/dance.mp4");
  expect(form!.get("referenceVideo")).toBeNull();
  expect(form!.get("engineId")).toBe("kling-motion-control");
  expect(form!.get("referenceSourceKind")).toBe("direct_url");
});

test("createServerGeneration uploads a reference clip file as private media", async () => {
  let form: FormData | undefined;
  stubFetch(
    withModerationAccepted((url, init) => {
      form = init?.body as FormData;
      return Response.json({ generation: { id: "gen-2" } }, { status: 201 });
    }),
  );

  await createServerGeneration({
    photo: photo(),
    reference: clip(),
    sourceKind: "upload",
    engineId: "kling-motion-control",
  });

  expect((form!.get("referenceVideo") as File).name).toBe("dance.mp4");
  expect(form!.get("referenceUrl")).toBeNull();
  expect(form!.get("referenceSourceKind")).toBe("upload");
});

test("a moderation rejection throws before anything reaches the generation route", async () => {
  const generationCalls: string[] = [];
  stubFetch((url) => {
    if (url.endsWith("/api/moderate")) {
      return Response.json({ accepted: false, reason: "No dancing for this one." });
    }
    generationCalls.push(url);
    return Response.json({}, { status: 500 });
  });

  await expect(
    createServerGeneration({
      photo: photo(),
      reference: clip(),
      sourceKind: "upload",
      engineId: "kling-motion-control",
    }),
  ).rejects.toMatchObject({ name: "GenerationError", kind: "moderation" });
  expect(generationCalls).toEqual([]);
});

test("402 means the wallet is empty: CheckoutRequiredError", async () => {
  stubFetch(
    withModerationAccepted(() =>
      Response.json({ error: "insufficient_credits", action: "checkout" }, { status: 402 }),
    ),
  );

  await expect(
    createServerGeneration({
      photo: photo(),
      reference: clip(),
      sourceKind: "upload",
      engineId: "kling-motion-control",
    }),
  ).rejects.toBeInstanceOf(CheckoutRequiredError);
});

test("401 means the session is gone: AuthRequiredError", async () => {
  stubFetch(
    withModerationAccepted(() =>
      Response.json({ error: "unauthenticated" }, { status: 401 }),
    ),
  );

  await expect(
    createServerGeneration({
      photo: photo(),
      reference: clip(),
      sourceKind: "upload",
      engineId: "kling-motion-control",
    }),
  ).rejects.toBeInstanceOf(AuthRequiredError);
});

test("a submission failure surfaces the server's error kind", async () => {
  stubFetch(
    withModerationAccepted(() =>
      Response.json({ error: "Exhausted balance", kind: "unavailable" }, { status: 502 }),
    ),
  );

  await expect(
    createServerGeneration({
      photo: photo(),
      reference: clip(),
      sourceKind: "upload",
      engineId: "kling-motion-control",
    }),
  ).rejects.toMatchObject({
    name: "GenerationError",
    kind: "unavailable",
    message: "Exhausted balance",
  });
});

test("trackServerGeneration polls to completion and returns the stored video url", async () => {
  const statuses = ["submitted", "running", "finalizing", "completed"];
  let poll = 0;
  stubFetch((url) => {
    expect(url).toContain("/api/generations/gen-1");
    const status = statuses[Math.min(poll++, statuses.length - 1)];
    return Response.json({
      generation: { id: "gen-1", status, blobPath: status === "completed" ? "gen-1.mp4" : null },
    });
  });

  const updates: string[] = [];
  const url = await trackServerGeneration("gen-1", (msg) => updates.push(msg), { pollMs: 1 });

  expect(url).toBe("/api/video/gen-1");
  expect(updates.some((m) => /queue/i.test(m))).toBe(true);
  expect(updates.some((m) => /rendering/i.test(m))).toBe(true);
  expect(updates.some((m) => /finalizing/i.test(m))).toBe(true);
});

test("a failed job throws a GenerationError with the recorded kind and message", async () => {
  stubFetch(() =>
    Response.json({
      generation: { id: "gen-1", status: "failed", errorKind: "timeout", error: "took too long" },
    }),
  );

  await expect(trackServerGeneration("gen-1", () => {}, { pollMs: 1 })).rejects.toMatchObject({
    name: "GenerationError",
    kind: "timeout",
    message: "took too long",
  });
});

test("unknown failure kinds fall back to a retryable provider error", async () => {
  stubFetch(() =>
    Response.json({
      generation: { id: "gen-1", status: "failed", errorKind: "storage", error: "azurite down" },
    }),
  );

  await expect(trackServerGeneration("gen-1", () => {}, { pollMs: 1 })).rejects.toMatchObject({
    kind: "provider",
    message: "azurite down",
  });
});

test("losing the session mid-run throws AuthRequiredError", async () => {
  stubFetch(() => Response.json({ error: "unauthenticated" }, { status: 401 }));

  await expect(trackServerGeneration("gen-1", () => {}, { pollMs: 1 })).rejects.toBeInstanceOf(
    AuthRequiredError,
  );
});

test("transient poll failures keep the run alive", async () => {
  let poll = 0;
  stubFetch(() => {
    poll += 1;
    if (poll === 1) return Response.json({ error: "boom" }, { status: 500 });
    if (poll === 2) return Promise.reject(new Error("offline"));
    return Response.json({
      generation: { id: "gen-1", status: "completed", blobPath: "gen-1.mp4" },
    });
  });

  await expect(trackServerGeneration("gen-1", () => {}, { pollMs: 1 })).resolves.toBe(
    "/api/video/gen-1",
  );
});

test("GenerationError from the seam stays the shared type", () => {
  // The wizard branches on GenerationError kinds; the seam must not fork it.
  expect(new CheckoutRequiredError()).toBeInstanceOf(Error);
  expect(new AuthRequiredError()).toBeInstanceOf(Error);
  expect(new GenerationError("provider", "x")).toBeInstanceOf(Error);
});
