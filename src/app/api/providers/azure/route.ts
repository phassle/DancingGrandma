import { randomUUID } from "crypto";

export const runtime = "nodejs";

/**
 * Azure character-animation provider route (issue #17).
 *
 * Sends the same domain inputs as every wired engine — a person/character
 * image + a reference motion video — to a self-hosted Wan 2.2 Animate endpoint
 * running on Azure Container Apps serverless GPU (see #97 for the hosting).
 * The endpoint URL and key live server-side (`AZURE_WAN_ENDPOINT`,
 * `AZURE_WAN_KEY`) and never reach the browser. Failures are classified onto
 * the shared error kinds (`unavailable` | `timeout` | `provider`) so the
 * wizard's error/retry states work unchanged.
 */

type ErrorKind = "unavailable" | "timeout" | "provider";
type AzureWanResult = { video_url?: string | null; error?: string | null };

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

function classifyAzureStatus(status: number, error: string): Response {
  if ([401, 402, 403, 429, 503].includes(status)) {
    return errorResponse("unavailable", error, status === 429 ? 503 : status);
  }
  if ([408, 504].includes(status)) {
    return errorResponse("timeout", error, status);
  }
  return errorResponse("provider", error, status);
}

async function azureJson(res: Response): Promise<AzureWanResult> {
  return res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
}

export async function POST(request: Request): Promise<Response> {
  const endpoint = process.env.AZURE_WAN_ENDPOINT;
  const key = process.env.AZURE_WAN_KEY;
  if (!endpoint) {
    return errorResponse("unavailable", "AZURE_WAN_ENDPOINT is not set", 503);
  }
  if (!key) {
    return errorResponse("unavailable", "AZURE_WAN_KEY is not set", 503);
  }

  const form = await request.formData();
  const photo = form.get("photo");
  if (!isBlobLike(photo)) {
    return errorResponse("provider", "photo file is required", 400);
  }

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

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        character_image: characterImage,
        video: motionReference,
        resolution: "720",
        frames_per_second: 24,
        merge_audio: true,
      }),
    });

    if (!res.ok) {
      const body = await azureJson(res);
      return classifyAzureStatus(res.status, body.error || res.statusText);
    }

    const result = await azureJson(res);
    if (!result.video_url) {
      throw new Error("Azure Wan endpoint finished but returned no video URL");
    }

    return Response.json({
      requestId: `az-${randomUUID()}`,
      videoUrl: result.video_url,
      referenceName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const timeout = message.includes("timed out");
    return errorResponse(timeout ? "timeout" : "provider", message, timeout ? 504 : 502);
  }
}
