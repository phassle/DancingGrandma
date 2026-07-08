import "fake-indexeddb/auto";
import { beforeEach, expect, test } from "vitest";
import { clearDraft, loadDraft, saveDraft } from "./draft";

/**
 * The pre-account draft lives in IndexedDB only — it must survive the
 * full-page redirects to Keycloak and Stripe without any byte reaching
 * the server before authentication (issue #58, PRD #54).
 */

const photo = () => new File([new Uint8Array([1, 2, 3])], "grandma.png", { type: "image/png" });

beforeEach(async () => {
  await clearDraft();
});

test("a saved draft round-trips the photo, reference clip, and engine choice", async () => {
  const clip = new File([new Uint8Array([9, 9])], "dance.mp4", { type: "video/mp4" });
  await saveDraft({
    photo: photo(),
    reference: { kind: "clip", file: clip, source: "uploaded" },
    engineId: "kling-motion-control",
  });

  const draft = await loadDraft();
  expect(draft).not.toBeNull();
  expect(draft!.engineId).toBe("kling-motion-control");
  expect(draft!.photo.name).toBe("grandma.png");
  expect(draft!.photo.type).toBe("image/png");
  expect(new Uint8Array(await draft!.photo.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  expect(draft!.reference).toMatchObject({ kind: "clip", source: "uploaded" });
  if (draft!.reference.kind !== "clip") throw new Error("expected a clip reference");
  expect(draft!.reference.file.name).toBe("dance.mp4");
  expect(new Uint8Array(await draft!.reference.file.arrayBuffer())).toEqual(
    new Uint8Array([9, 9]),
  );
});

test("curated and direct-url references round-trip without file payloads", async () => {
  await saveDraft({
    photo: photo(),
    reference: { kind: "curated", danceId: "griddy" },
    engineId: "wan-animate-fal",
  });
  expect((await loadDraft())!.reference).toEqual({ kind: "curated", danceId: "griddy" });

  await saveDraft({
    photo: photo(),
    reference: { kind: "url", url: "https://example.com/dance.mp4" },
    engineId: "wan-animate-fal",
  });
  expect((await loadDraft())!.reference).toEqual({
    kind: "url",
    url: "https://example.com/dance.mp4",
  });
});

test("loadDraft is null when nothing was saved", async () => {
  expect(await loadDraft()).toBeNull();
});

test("an expired draft is discarded on load", async () => {
  await saveDraft(
    {
      photo: photo(),
      reference: { kind: "curated", danceId: "griddy" },
      engineId: "wan-animate-fal",
    },
    // Saved 25 hours ago — past the 24h TTL.
    Date.now() - 25 * 60 * 60 * 1000,
  );

  expect(await loadDraft()).toBeNull();
  // And it stays gone.
  expect(await loadDraft()).toBeNull();
});

test("clearDraft removes a saved draft", async () => {
  await saveDraft({
    photo: photo(),
    reference: { kind: "curated", danceId: "griddy" },
    engineId: "wan-animate-fal",
  });
  await clearDraft();
  expect(await loadDraft()).toBeNull();
});
