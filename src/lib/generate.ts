"use client";

import { fal } from "@fal-ai/client";
import type { Engine } from "./engines";

fal.config({ proxyUrl: "/api/fal/proxy" });

export type GenerationUpdate = (message: string) => void;

/**
 * How a generation run can fail, so the wizard can react differently:
 * - "unavailable" — the provider account can't serve anyone right now
 *   (fal 403 "User is locked. Reason: Exhausted balance").
 * - "timeout" — the run was accepted but didn't finish in time.
 * - "provider" — any other provider-side failure; worth a retry.
 */
export type GenerationFailureKind = "unavailable" | "timeout" | "provider";

export class GenerationError extends Error {
  readonly kind: GenerationFailureKind;

  constructor(kind: GenerationFailureKind, message: string) {
    super(message);
    this.name = "GenerationError";
    this.kind = kind;
  }
}

/** Shape of @fal-ai/client's ApiError, checked structurally because the
 * error may cross the proxy and instanceof is unreliable across bundles. */
type FalApiErrorLike = {
  status?: unknown;
  body?: { detail?: unknown };
  timeoutType?: unknown;
};

function classifyFalError(err: unknown): GenerationError {
  const message = err instanceof Error ? err.message : String(err);
  const { status, body, timeoutType } = (err ?? {}) as FalApiErrorLike;
  const detail = typeof body?.detail === "string" ? body.detail : "";
  if (status === 403 && detail.includes("User is locked")) {
    return new GenerationError("unavailable", detail);
  }
  if (timeoutType != null || status === 408 || status === 504) {
    return new GenerationError("timeout", detail || message);
  }
  return new GenerationError("provider", detail || message);
}

// Uploaded-file URLs, keyed by File identity, so a retry after a failed
// render goes straight back to the render instead of re-uploading.
const uploadedUrls = new WeakMap<File, string>();

async function uploadOnce(file: File): Promise<string> {
  const cached = uploadedUrls.get(file);
  if (cached) return cached;
  const url = await fal.storage.upload(file);
  uploadedUrls.set(file, url);
  return url;
}

/**
 * The single generation seam: photo + reference dance video + engine → video URL.
 * Everything above (the wizard) and below (engine adapters) varies independently.
 * The reference can be a File (uploaded to fal storage) or an already-public
 * URL (handed to the engine as-is — fal fetches it server-side).
 */
export async function generateDanceVideo(
  photo: File,
  referenceVideo: File | string,
  engine: Engine,
  onUpdate: GenerationUpdate,
): Promise<string> {
  if (!engine.endpoint) {
    throw new Error(`${engine.name} has no wired adapter yet`);
  }

  let imageUrl: string;
  let videoUrl: string;
  try {
    onUpdate("Uploading the star…");
    imageUrl = await uploadOnce(photo);
    if (typeof referenceVideo === "string") {
      videoUrl = referenceVideo;
    } else {
      onUpdate("Uploading the choreography…");
      videoUrl = await uploadOnce(referenceVideo);
    }
  } catch (err) {
    throw classifyFalError(err);
  }

  // Per-engine input mapping. Both current adapters take image+video URLs;
  // Kling additionally carries the reference audio through on its own.
  const input =
    engine.id === "kling-motion-control"
      ? { image_url: imageUrl, video_url: videoUrl, keep_original_sound: true }
      : { image_url: imageUrl, video_url: videoUrl, resolution: "580p" };

  onUpdate("Teaching her the moves…");
  let result;
  try {
    result = await fal.subscribe(engine.endpoint, {
      input,
      logs: false,
      onQueueUpdate: (update) => {
        if (update.status === "IN_QUEUE") onUpdate("Waiting for a spot on the dance floor…");
        if (update.status === "IN_PROGRESS") onUpdate("Rendering, frame by frame…");
      },
    });
  } catch (err) {
    throw classifyFalError(err);
  }

  const url = (result.data as { video?: { url?: string } })?.video?.url;
  if (!url) {
    throw new Error("The engine finished but returned no video");
  }
  return url;
}
