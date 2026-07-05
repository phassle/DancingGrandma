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
 * - "moderation" — the uploaded photo was rejected by server-side moderation.
 */
export type GenerationFailureKind = "unavailable" | "timeout" | "provider" | "moderation";

export type GenerationErrorMeta = {
  status?: number;
  requestId?: string;
  code?: string;
  providerDetail?: unknown;
};

export class GenerationError extends Error {
  readonly kind: GenerationFailureKind;
  readonly status?: number;
  readonly requestId?: string;
  readonly code?: string;
  readonly providerDetail?: unknown;

  constructor(kind: GenerationFailureKind, message: string, meta: GenerationErrorMeta = {}) {
    super(message);
    this.name = "GenerationError";
    this.kind = kind;
    this.status = meta.status;
    this.requestId = meta.requestId;
    this.code = meta.code;
    this.providerDetail = meta.providerDetail;
  }
}

/** Shape of @fal-ai/client's ApiError, checked structurally because the
 * error may cross the proxy and instanceof is unreliable across bundles. */
type FalApiErrorLike = {
  status?: unknown;
  body?: { detail?: unknown };
  requestId?: unknown;
  timeoutType?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringifyDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => stringifyDetail(item)).filter(Boolean).join("; ");
  }
  if (isRecord(detail)) {
    const message = detail.msg ?? detail.message ?? detail.error;
    const loc = Array.isArray(detail.loc) ? detail.loc.join(".") : undefined;
    const text = typeof message === "string" ? message : "";
    return loc && text ? `${loc}: ${text}` : text || JSON.stringify(detail);
  }
  return "";
}

function detailCode(detail: unknown): string | undefined {
  if (Array.isArray(detail)) {
    return detail.map(detailCode).find((code) => code !== undefined);
  }
  if (isRecord(detail) && typeof detail.type === "string") return detail.type;
  return undefined;
}

function falErrorMeta(err: FalApiErrorLike): GenerationErrorMeta {
  return {
    status: typeof err.status === "number" ? err.status : undefined,
    requestId: typeof err.requestId === "string" ? err.requestId : undefined,
    code: detailCode(err.body?.detail),
    providerDetail: err.body?.detail,
  };
}

function classifyFalError(err: unknown): GenerationError {
  const message = err instanceof Error ? err.message : String(err);
  const { status, body, timeoutType } = (err ?? {}) as FalApiErrorLike;
  const detail = stringifyDetail(body?.detail);
  const meta = falErrorMeta((err ?? {}) as FalApiErrorLike);
  if (status === 403 && detail.includes("User is locked")) {
    return new GenerationError("unavailable", detail, meta);
  }
  if (timeoutType != null || status === 408 || status === 504) {
    return new GenerationError("timeout", detail || message, meta);
  }
  return new GenerationError("provider", detail || message, meta);
}

function toGenerationError(err: unknown): GenerationError {
  return err instanceof GenerationError ? err : classifyFalError(err);
}

function logGenerationError(phase: string, engine: Engine, error: GenerationError) {
  console.error("[dg:generation-error]", {
    phase,
    engineId: engine.id,
    engineName: engine.name,
    provider: engine.provider,
    endpoint: engine.endpoint,
    kind: error.kind,
    message: error.message,
    status: error.status,
    requestId: error.requestId,
    code: error.code,
    providerDetail: error.providerDetail,
  });
}

// Uploaded-file URLs, keyed by File identity, so a retry after a failed
// render goes straight back to the render instead of re-uploading.
const uploadedUrls = new WeakMap<File, string>();
const acceptedRuns = new Map<string, { engineId: string; provider: EngineProvider; startedAt: number }>();
const immediateResults = new Map<string, string>();
const submittedReferenceUrls = new Map<string, string>();
const MAX_PROVIDER_IMAGE_DIMENSION = 3840;

type DrawableImage = {
  width: number;
  height: number;
  draw(ctx: CanvasRenderingContext2D, width: number, height: number): void;
  close?(): void;
};

async function decodeDrawableImage(file: File): Promise<DrawableImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (ctx, width, height) => ctx.drawImage(bitmap, 0, 0, width, height),
      close: () => bitmap.close(),
    };
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not read the selected photo"));
      img.src = url;
    });
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: (ctx, width, height) => ctx.drawImage(img, 0, 0, width, height),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not resize the selected photo"));
    }, type, quality);
  });
}

function resizedPhotoName(name: string): string {
  return name.replace(/\.[^.]+$/, "") + "-provider.jpg";
}

async function resizePhotoForProvider(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (typeof document === "undefined") return file;

  const image = await decodeDrawableImage(file);
  try {
    const largest = Math.max(image.width, image.height);
    if (largest <= MAX_PROVIDER_IMAGE_DIMENSION) return file;

    const scale = MAX_PROVIDER_IMAGE_DIMENSION / largest;
    const width = Math.round(image.width * scale);
    const height = Math.round(image.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the selected photo");
    image.draw(ctx, width, height);

    const blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
    return new File([blob], resizedPhotoName(file.name), {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } finally {
    image.close?.();
  }
}

async function uploadOnce(file: File): Promise<string> {
  const cached = uploadedUrls.get(file);
  if (cached) return cached;
  const url = await fal.storage.upload(file);
  uploadedUrls.set(file, url);
  return url;
}

async function uploadPhotoOnce(file: File): Promise<string> {
  const cached = uploadedUrls.get(file);
  if (cached) return cached;
  const uploadable = await resizePhotoForProvider(file);
  // Upload with a 1-hour TTL so the file auto-expires even if our post-run
  // cleanup doesn't reach the server.
  const url = await fal.storage.upload(uploadable, { lifecycle: { expiresIn: "1h" } });
  uploadedUrls.set(file, url);
  return url;
}

/**
 * Call the server-side moderation endpoint. Throws a GenerationError with
 * kind "moderation" if the photo is rejected.
 */
async function moderatePhoto(photo: File): Promise<void> {
  const form = new FormData();
  form.set("photo", photo);
  let res: Response;
  try {
    res = await fetch("/api/moderate", { method: "POST", body: form });
  } catch (err) {
    // Network error — treat as accepted so a connectivity blip doesn't block
    // all runs. Real rejections come from a healthy server response.
    console.warn("[dg:moderation-fetch-error]", err instanceof Error ? err.message : err);
    return;
  }
  if (!res.ok) {
    // Server error on moderation side — treat as accepted (best-effort).
    console.warn("[dg:moderation-error]", { status: res.status });
    return;
  }
  const body = (await res.json().catch(() => ({ accepted: true }))) as {
    accepted: boolean;
    reason?: string;
  };
  if (!body.accepted) {
    throw new GenerationError(
      "moderation",
      body.reason ?? "This photo can't be used. Please choose a different one.",
    );
  }
}

/**
 * Delete an uploaded photo from fal storage after the run (best-effort).
 * The photo was also uploaded with a 1-hour TTL as a belt-and-suspenders
 * measure, so this is an optimistic early deletion.
 */
export async function cleanupPhotoUpload(photo: File): Promise<void> {
  const url = uploadedUrls.get(photo);
  if (!url) return;
  uploadedUrls.delete(photo);
  try {
    await fetch("/api/photo/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch {
    // Best-effort — the 1-hour TTL handles cleanup if this call fails.
  }
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
    return new GenerationError(body.kind, body.error || res.statusText, { status: res.status });
  }
  if ([401, 402, 403, 429, 503].includes(res.status)) {
    return new GenerationError("unavailable", body.error || res.statusText, { status: res.status });
  }
  if ([408, 504].includes(res.status)) {
    return new GenerationError("timeout", body.error || res.statusText, { status: res.status });
  }
  return new GenerationError("provider", body.error || res.statusText, { status: res.status });
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
      try {
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
      } catch (err) {
        const error = toGenerationError(err);
        logGenerationError("provider-submit", engine, error);
        throw error;
      }
    },
    async track(requestId, engine, onUpdate) {
      try {
        onUpdate("Rendering, frame by frame…");
        const videoUrl = immediateResults.get(requestId);
        if (!videoUrl) {
          throw new GenerationError("provider", `${engine.name} returned no playable video`, {
            requestId,
          });
        }
        immediateResults.delete(requestId);
        onUpdate("Finalizing audio and watermark…");
        return finalizeDeliveredVideo(videoUrl, engine);
      } catch (err) {
        const error = toGenerationError(err);
        logGenerationError("provider-track", engine, error);
        throw error;
      }
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
      imageUrl = await uploadPhotoOnce(photo);
      if (typeof referenceVideo === "string") {
        videoUrl = referenceVideo;
      } else {
        videoUrl = await uploadOnce(referenceVideo);
      }
    } catch (err) {
      const error = classifyFalError(err);
      logGenerationError("fal-upload", engine, error);
      throw error;
    }

    try {
      const submitted = await fal.queue.submit(engine.endpoint, {
        input: falInputFor(engine, imageUrl, videoUrl),
      });
      submittedReferenceUrls.set(submitted.request_id, videoUrl);
      return submitted.request_id;
    } catch (err) {
      const error = classifyFalError(err);
      logGenerationError("fal-submit", engine, error);
      throw error;
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

    let phase = "fal-status";
    try {
      for (;;) {
        phase = "fal-status";
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

      phase = "fal-result";
      const result = await fal.queue.result(engine.endpoint, { requestId });
      const url = (result.data as { video?: { url?: string } })?.video?.url;
      if (!url) {
        throw new GenerationError("provider", "The engine finished but returned no video", {
          requestId,
        });
      }
      const referenceVideoUrl = submittedReferenceUrls.get(requestId);
      submittedReferenceUrls.delete(requestId);
      onUpdate("Finalizing audio and watermark…");
      phase = "finalize";
      return finalizeDeliveredVideo(url, engine, referenceVideoUrl);
    } catch (err) {
      const error = toGenerationError(err);
      logGenerationError(phase, engine, error);
      throw error;
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
  await moderatePhoto(photo);
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
