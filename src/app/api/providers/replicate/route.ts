import { randomUUID } from "crypto";

export const runtime = "nodejs";

type ErrorKind = "unavailable" | "timeout" | "provider";
type ReplicatePrediction = {
  id?: string;
  status?: "starting" | "processing" | "succeeded" | "failed" | "canceled" | string;
  output?: string | string[] | null;
  error?: string | null;
  urls?: { get?: string };
};

function errorResponse(kind: ErrorKind, error: string, status: number): Response {
  return Response.json({ kind, error }, { status });
}

function formString(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isBlobLike(value: FormDataEntryValue | null): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Blob).arrayBuffer === "function"
  );
}

function entryName(value: FormDataEntryValue | null, fallback: string): string {
  return typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string"
    ? value.name
    : fallback;
}

function selectedWanModel(form: FormData): string | Response {
  const configuredModel =
    process.env.REPLICATE_WAN_ANIMATE_MODEL ?? "wan-video/wan-2.2-animate-animation";
  const requestedModel = formString(form, "endpoint") ?? configuredModel;
  const allowedModels = new Set([
    configuredModel,
    "wan-video/wan-2.2-animate-animation",
    "wan-video/wan-2.2-animate-replace",
  ]);
  if (!allowedModels.has(requestedModel)) {
    return errorResponse("provider", `Unsupported Replicate model: ${requestedModel}`, 400);
  }
  return requestedModel;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function blobDataUrl(blob: Blob): Promise<string> {
  const bytes = Buffer.from(await blob.arrayBuffer());
  return `data:${blob.type || "application/octet-stream"};base64,${bytes.toString("base64")}`;
}

async function fetchAsDataUrl(url: string, requestUrl: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const absoluteUrl = new URL(url, requestUrl).toString();
  if (!absoluteUrl.startsWith("http://") && !absoluteUrl.startsWith("https://")) {
    throw new Error(`Unsupported reference URL: ${url}`);
  }
  const res = await fetch(absoluteUrl);
  if (!res.ok) {
    throw new Error(`reference video download failed: ${res.status}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get("Content-Type") || "video/mp4";
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

function classifyReplicateStatus(status: number, error: string): Response {
  if ([401, 402, 403, 429, 503].includes(status)) {
    return errorResponse("unavailable", error, status === 429 ? 503 : status);
  }
  if ([408, 504].includes(status)) {
    return errorResponse("timeout", error, status);
  }
  return errorResponse("provider", error, status);
}

async function replicateJson(res: Response): Promise<ReplicatePrediction | { error?: string }> {
  return res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
}

function outputUrl(prediction: ReplicatePrediction): string | null {
  if (typeof prediction.output === "string" && prediction.output) return prediction.output;
  if (Array.isArray(prediction.output) && typeof prediction.output[0] === "string") {
    return prediction.output[0];
  }
  return null;
}

async function waitForReplicatePrediction(
  prediction: ReplicatePrediction,
  token: string,
): Promise<ReplicatePrediction> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (prediction.status === "succeeded") return prediction;
    if (prediction.status === "failed" || prediction.status === "canceled") {
      throw new Error(prediction.error || `Replicate prediction ${prediction.status}`);
    }
    if (!prediction.urls?.get) {
      throw new Error("Replicate returned no polling URL");
    }
    await delay(Number(process.env.REPLICATE_POLL_MS ?? "5000"));
    const res = await fetch(prediction.urls.get, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await replicateJson(res);
      throw new Error(body.error || `${res.status} ${res.statusText}`);
    }
    prediction = (await res.json()) as ReplicatePrediction;
  }
  throw new Error("Replicate prediction timed out");
}

export async function POST(request: Request): Promise<Response> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return errorResponse("unavailable", "REPLICATE_API_TOKEN is not set", 503);
  }

  const form = await request.formData();
  const photo = form.get("photo");
  if (!isBlobLike(photo)) {
    return errorResponse("provider", "photo file is required", 400);
  }

  const model = selectedWanModel(form);
  if (model instanceof Response) return model;

  const referenceUrl = formString(form, "referenceUrl");
  const referenceFile = form.get("referenceVideo");
  const referenceName = formString(form, "referenceName") ?? entryName(referenceFile, referenceUrl ?? "");
  if (!referenceUrl && !isBlobLike(referenceFile)) {
    return errorResponse("provider", "reference video is required", 400);
  }

  try {
    const characterImage = await blobDataUrl(photo);
    const motionReference = referenceUrl
      ? await fetchAsDataUrl(referenceUrl, request.url)
      : await blobDataUrl(referenceFile as Blob);
    const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "wait=60",
      },
      body: JSON.stringify({
        input: {
          video: motionReference,
          character_image: characterImage,
          resolution: "720",
          refert_num: 1,
          frames_per_second: 24,
          go_fast: true,
          merge_audio: true,
        },
      }),
    });

    if (!res.ok) {
      const body = await replicateJson(res);
      return classifyReplicateStatus(res.status, body.error || res.statusText);
    }

    const prediction = await waitForReplicatePrediction(
      (await res.json()) as ReplicatePrediction,
      token,
    );
    const videoUrl = outputUrl(prediction);
    if (!videoUrl) {
      throw new Error("Replicate finished but returned no video URL");
    }

    return Response.json({
      requestId: prediction.id ? `rep-${prediction.id}` : `rep-${randomUUID()}`,
      videoUrl,
      referenceName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const timeout = message.includes("timed out");
    return errorResponse(timeout ? "timeout" : "provider", message, timeout ? 504 : 502);
  }
}
