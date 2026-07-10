import { beforeEach, expect, test, vi } from "vitest";
import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AZURE_WAN_ENDPOINT = "https://wan.internal.azurecontainerapps.io/animate";
  process.env.AZURE_WAN_KEY = "azure-secret";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ video_url: "https://blob.azure/out.mp4" })),
  );
});

function providerRequest(form: FormData): Request {
  return new Request("http://localhost/api/providers/azure", {
    method: "POST",
    body: form,
  });
}

test("submits Wan character animation to the Azure endpoint with image and motion-reference video", async () => {
  const form = new FormData();
  form.set("photo", new File(["photo"], "grandma.png", { type: "image/png" }));
  form.set("referenceVideo", new File(["dance"], "griddy.mp4", { type: "video/mp4" }));
  form.set("referenceName", "griddy.mp4");

  const res = await POST(providerRequest(form));
  const body = (await res.json()) as { requestId: string; videoUrl: string; referenceName: string };

  expect(res.status).toBe(200);
  expect(body).toMatchObject({
    videoUrl: "https://blob.azure/out.mp4",
    referenceName: "griddy.mp4",
  });
  expect(body.requestId).toMatch(/^az-/);

  // The credential/endpoint stay server-side and the domain payload carries BOTH inputs.
  expect(fetch).toHaveBeenCalledWith(
    "https://wan.internal.azurecontainerapps.io/animate",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer azure-secret" }),
    }),
  );
  const [, init] = vi.mocked(fetch).mock.calls[0];
  const payload = JSON.parse(String(init?.body)) as { character_image?: string; video?: string };
  expect(payload.character_image).toMatch(/^data:image\/png;base64,/);
  expect(payload.video).toMatch(/^data:video\/mp4;base64,/);
});

test("reports provider unavailable when the Azure endpoint is not configured", async () => {
  delete process.env.AZURE_WAN_ENDPOINT;
  const form = new FormData();
  form.set("photo", new File(["photo"], "grandma.png", { type: "image/png" }));
  form.set("referenceVideo", new File(["dance"], "griddy.mp4", { type: "video/mp4" }));

  const res = await POST(providerRequest(form));

  expect(res.status).toBe(503);
  await expect(res.json()).resolves.toMatchObject({
    kind: "unavailable",
    error: "AZURE_WAN_ENDPOINT is not set",
  });
  expect(fetch).not.toHaveBeenCalled();
});

test("reports provider unavailable when the Azure key is not configured", async () => {
  delete process.env.AZURE_WAN_KEY;
  const form = new FormData();
  form.set("photo", new File(["photo"], "grandma.png", { type: "image/png" }));
  form.set("referenceVideo", new File(["dance"], "griddy.mp4", { type: "video/mp4" }));

  const res = await POST(providerRequest(form));

  expect(res.status).toBe(503);
  await expect(res.json()).resolves.toMatchObject({ kind: "unavailable" });
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  [403, "unavailable", 403],
  [429, "unavailable", 503],
  [504, "timeout", 504],
  [500, "provider", 500],
])("maps upstream %i to GenerationError kind %s", async (upstream, kind, expectedStatus) => {
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ error: "boom" }, { status: upstream }),
  );
  const form = new FormData();
  form.set("photo", new File(["photo"], "grandma.png", { type: "image/png" }));
  form.set("referenceVideo", new File(["dance"], "griddy.mp4", { type: "video/mp4" }));

  const res = await POST(providerRequest(form));

  expect(res.status).toBe(expectedStatus);
  await expect(res.json()).resolves.toMatchObject({ kind });
});
