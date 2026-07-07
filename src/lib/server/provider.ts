import "server-only";
import { createFalClient, type FalClient } from "@fal-ai/client";
import type { Engine } from "@/lib/engines";

/**
 * Server-side provider boundary for paid generation (PRD #54). The browser
 * no longer drives the provider through the proxy for paid runs; these
 * functions are the only place the app talks to fal from the server, so
 * route-handler tests fake exactly this module.
 *
 * Failures are thrown as plain Errors carrying a structural `kind` so the
 * caller can record an error kind on the generation without depending on
 * provider-specific error classes.
 */

export type ProviderJobStatus = "queued" | "running" | "completed";

export type ProviderFailureKind = "unavailable" | "timeout" | "provider";

let client: FalClient | undefined;

function getFalClient(): FalClient {
  if (client) return client;
  const credentials = process.env.FAL_KEY;
  if (!credentials) {
    throw providerError("unavailable", "FAL_KEY is not set — server-side generation is not configured");
  }
  client = createFalClient({ credentials });
  return client;
}

export function providerError(kind: ProviderFailureKind, message: string): Error & { kind: ProviderFailureKind } {
  return Object.assign(new Error(message), { kind });
}

type FalApiErrorLike = { status?: unknown; body?: { detail?: unknown }; timeoutType?: unknown };

function classifyFalError(err: unknown): Error & { kind: ProviderFailureKind } {
  if (err instanceof Error && "kind" in err) return err as Error & { kind: ProviderFailureKind };
  const message = err instanceof Error ? err.message : String(err);
  const { status, body, timeoutType } = (err ?? {}) as FalApiErrorLike;
  const detail = typeof body?.detail === "string" ? body.detail : "";
  if (status === 403 && detail.includes("User is locked")) {
    return providerError("unavailable", detail);
  }
  if (timeoutType != null || status === 408 || status === 504) {
    return providerError("timeout", detail || message);
  }
  return providerError("provider", detail || message);
}

/** Upload a user asset (photo or reference clip) to provider storage. */
export async function uploadToProvider(file: File): Promise<string> {
  try {
    return await getFalClient().storage.upload(file);
  } catch (err) {
    throw classifyFalError(err);
  }
}

/** Per-engine input mapping — mirrors the client adapter in src/lib/generate.ts. */
function falInputFor(engine: Engine, imageUrl: string, videoUrl: string): Record<string, unknown> {
  return engine.id === "kling-motion-control"
    ? {
        image_url: imageUrl,
        video_url: videoUrl,
        keep_original_sound: true,
        character_orientation: "video",
      }
    : { image_url: imageUrl, video_url: videoUrl, resolution: "580p" };
}

export async function submitToProvider(
  engine: Engine,
  imageUrl: string,
  videoUrl: string,
): Promise<{ requestId: string }> {
  if (!engine.endpoint) {
    throw providerError("provider", `${engine.name} has no wired endpoint`);
  }
  try {
    const submitted = await getFalClient().queue.submit(engine.endpoint, {
      input: falInputFor(engine, imageUrl, videoUrl),
    });
    return { requestId: submitted.request_id };
  } catch (err) {
    throw classifyFalError(err);
  }
}

export async function providerStatus(endpoint: string, requestId: string): Promise<ProviderJobStatus> {
  try {
    const status = await getFalClient().queue.status(endpoint, { requestId, logs: false });
    if (status.status === "COMPLETED") return "completed";
    if (status.status === "IN_PROGRESS") return "running";
    return "queued";
  } catch (err) {
    throw classifyFalError(err);
  }
}

/** The delivered video URL of a completed provider job (transport only). */
export async function providerResult(endpoint: string, requestId: string): Promise<string> {
  try {
    const result = await getFalClient().queue.result(endpoint, { requestId });
    const url = (result.data as { video?: { url?: string } })?.video?.url;
    if (!url) {
      throw providerError("provider", "The engine finished but returned no video");
    }
    return url;
  } catch (err) {
    throw classifyFalError(err);
  }
}
