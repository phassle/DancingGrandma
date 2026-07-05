"use client";

import { fal } from "@fal-ai/client";
import type { Engine, EngineProvider } from "./engines";

fal.config({ proxyUrl: "/api/fal/proxy" });

export type GenerationUpdate = (message: string) => void;
export type GenerationStatus = "IN_QUEUE" | "IN_PROGRESS";

export type GenerationProgress = {
  status: GenerationStatus;
  queuePosition?: number;
};

export type TrackOptions = {
  pollMs?: number;
};

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
const acceptedRuns = new Map<string, { engineId: string; provider: EngineProvider; startedAt: number }>();
const immediateResults = new Map<string, string>();
const submittedReferenceUrls = new Map<string, string>();

async function uploadOnce(file: File): Promise<string> {
  const cached = uploadedUrls.get(file);
  if (cached) return cached;
  const url = await fal.storage.upload(file);
  uploadedUrls.set(file, url);
  return url;
}

type GenerationAdapter = {
  submit(photo: File, referenceVideo: File | string, engine: Engine): Promise<string>;
  track(
    requestId: string,
    engine: Engine,
    onUpdate: GenerationUpdate,
    options?: TrackOptions,
  ): Promise<string>;
};

function falInputFor(engine: Engine, imageUrl: string, videoUrl: string) {
  // Per-engine input mapping. Both current adapters take image+video URLs;
  // Kling additionally carries the reference audio through on its own.
  return engine.id === "kling-motion-control"
    ? {
        image_url: imageUrl,
        video_url: videoUrl,
        keep_original_sound: true,
        character_orientation: "video",
      }
    : { image_url: imageUrl, video_url: videoUrl, resolution: "580p" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function progressMessage(progress: GenerationProgress): string {
  if (progress.status === "IN_QUEUE" && progress.queuePosition != null) {
    return `#${progress.queuePosition} in line for the dance floor`;
  }
  if (progress.status === "IN_QUEUE") {
    return "Waiting for a spot on the dance floor…";
  }
  return "Rendering, frame by frame…";
}

function recordAcceptedRun(requestId: string, engine: Engine) {
  acceptedRuns.set(requestId, {
    engineId: engine.id,
    provider: engine.provider,
    startedAt: Date.now(),
  });
}

function logRun(engine: Engine, requestId: string, outcome: "completed" | "failed") {
  const accepted = acceptedRuns.get(requestId);
  const latencyMs = accepted ? Date.now() - accepted.startedAt : undefined;
  console.info("[generation]", {
    engineId: engine.id,
    provider: engine.provider,
    requestId,
    outcome,
    latencyMs,
  });
  acceptedRuns.delete(requestId);
}

async function classifyProviderResponse(res: Response): Promise<GenerationError> {
  const body: { error?: string; kind?: GenerationFailureKind } = await res
    .json()
    .then((value) => value as { error?: string; kind?: GenerationFailureKind })
    .catch(() => ({ error: `${res.status} ${res.statusText}` }));
  if (body.kind) {
    return new GenerationError(body.kind, body.error || res.statusText);
  }
  if ([401, 402, 403, 429, 503].includes(res.status)) {
    return new GenerationError("unavailable", body.error || res.statusText);
  }
  if ([408, 504].includes(res.status)) {
    return new GenerationError("timeout", body.error || res.statusText);
  }
  return new GenerationError("provider", body.error || res.statusText);
}

async function finalizeDeliveredVideo(
  videoUrl: string,
  engine: Engine,
  referenceVideoUrl?: string,
): Promise<string> {
  const res = await fetch("/api/video/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      videoUrl,
      referenceVideoUrl,
      carriesAudio: engine.carriesAudio,
    }),
  });
  if (!res.ok) throw await classifyProviderResponse(res);
  const video = await res.blob();
  return URL.createObjectURL(video);
}

function providerRouteAdapter(provider: Extract<EngineProvider, "replicate">): GenerationAdapter {
  return {
    async submit(photo, referenceVideo, engine) {
      const form = new FormData();
      form.set("photo", photo);
      form.set("engineId", engine.id);
      if (engine.endpoint) form.set("endpoint", engine.endpoint);
      if (typeof referenceVideo === "string") {
        form.set("referenceUrl", referenceVideo);
        form.set("referenceName", referenceVideo);
      } else {
        form.set("referenceVideo", referenceVideo);
        form.set("referenceName", referenceVideo.name);
      }

      const res = await fetch(`/api/providers/${provider}`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw await classifyProviderResponse(res);

      const body = (await res.json()) as { requestId?: string; videoUrl?: string };
      if (!body.requestId) {
        throw new GenerationError("provider", `${engine.name} returned no request id`);
      }
      if (body.videoUrl) immediateResults.set(body.requestId, body.videoUrl);
      return body.requestId;
    },
    async track(requestId, engine, onUpdate) {
      onUpdate("Rendering, frame by frame…");
      const videoUrl = immediateResults.get(requestId);
      if (!videoUrl) {
        throw new GenerationError("provider", `${engine.name} returned no playable video`);
      }
      immediateResults.delete(requestId);
      onUpdate("Finalizing audio and watermark…");
      return finalizeDeliveredVideo(videoUrl, engine);
    },
  };
}

const falAdapter: GenerationAdapter = {
  async submit(
    photo: File,
    referenceVideo: File | string,
    engine: Engine,
  ): Promise<string> {
    if (!engine.endpoint) {
      throw new Error(`${engine.name} has no wired adapter yet`);
    }

    let imageUrl: string;
    let videoUrl: string;
    try {
      imageUrl = await uploadOnce(photo);
      if (typeof referenceVideo === "string") {
        videoUrl = referenceVideo;
      } else {
        videoUrl = await uploadOnce(referenceVideo);
      }
    } catch (err) {
      throw classifyFalError(err);
    }

    try {
      const submitted = await fal.queue.submit(engine.endpoint, {
        input: falInputFor(engine, imageUrl, videoUrl),
      });
      submittedReferenceUrls.set(submitted.request_id, videoUrl);
      return submitted.request_id;
    } catch (err) {
      throw classifyFalError(err);
    }
  },
  async track(
    requestId: string,
    engine: Engine,
    onUpdate: GenerationUpdate,
    { pollMs = 500 }: TrackOptions = {},
  ): Promise<string> {
    if (!engine.endpoint) {
      throw new Error(`${engine.name} has no wired adapter yet`);
    }

    try {
      for (;;) {
        const status = await fal.queue.status(engine.endpoint, {
          requestId,
          logs: false,
        });
        if (status.status === "IN_QUEUE") {
          onUpdate(progressMessage({
            status: status.status,
            queuePosition: status.queue_position,
          }));
        }
        if (status.status === "IN_PROGRESS") {
          onUpdate(progressMessage({ status: status.status }));
        }
        if (status.status === "COMPLETED") break;
        await sleep(pollMs);
      }

      const result = await fal.queue.result(engine.endpoint, { requestId });
      const url = (result.data as { video?: { url?: string } })?.video?.url;
      if (!url) {
        throw new Error("The engine finished but returned no video");
      }
      const referenceVideoUrl = submittedReferenceUrls.get(requestId);
      submittedReferenceUrls.delete(requestId);
      onUpdate("Finalizing audio and watermark…");
      return finalizeDeliveredVideo(url, engine, referenceVideoUrl);
    } catch (err) {
      throw classifyFalError(err);
    }
  },
};

const providerAdapters: Partial<Record<EngineProvider, GenerationAdapter>> = {
  fal: falAdapter,
  replicate: providerRouteAdapter("replicate"),
};

export function hasWiredGenerationAdapter(engine: Engine): boolean {
  return Boolean(engine.endpoint && providerAdapters[engine.provider]);
}

function adapterFor(engine: Engine): GenerationAdapter {
  const adapter = providerAdapters[engine.provider];
  if (!adapter || !engine.endpoint) {
    throw new Error(`${engine.name} has no wired adapter yet`);
  }
  return adapter;
}

export async function submitDanceVideo(
  photo: File,
  referenceVideo: File | string,
  engine: Engine,
): Promise<string> {
  const requestId = await adapterFor(engine).submit(photo, referenceVideo, engine);
  recordAcceptedRun(requestId, engine);
  return requestId;
}

export async function trackDanceVideo(
  requestId: string,
  engine: Engine,
  onUpdate: GenerationUpdate,
  options: TrackOptions = {},
): Promise<string> {
  try {
    const url = await adapterFor(engine).track(requestId, engine, onUpdate, options);
    logRun(engine, requestId, "completed");
    return url;
  } catch (err) {
    logRun(engine, requestId, "failed");
    throw err;
  }
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
  onUpdate("Uploading the star…");
  const requestId = await submitDanceVideo(photo, referenceVideo, engine);
  onUpdate("Teaching her the moves…");
  return trackDanceVideo(requestId, engine, onUpdate);
}
