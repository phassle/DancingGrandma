import { createHash } from "node:crypto";
import { authenticateRequest } from "@/lib/server/auth";
import {
  createSourcePhotoAsset,
  getWallet,
  InsufficientCreditsError,
  latestActiveGeneration,
  markGenerationSubmitted,
  releaseGeneration,
  reserveGeneration,
  type ReferenceSourceKind,
} from "@/lib/server/db";
import { saveSourcePhotoBytes } from "@/lib/server/blob";
import { purgeSourcePhotos } from "@/lib/server/retention";
import { submitToProvider, uploadToProvider } from "@/lib/server/provider";
import { failureKindOf, generationDto, refreshedDto } from "./dto";
import { ENGINES } from "@/lib/engines";

export const runtime = "nodejs";

/**
 * Durable paid generation (issue #57, PRD #54).
 *
 * POST — start a run. One transaction reserves the credit and creates the
 * job before any provider traffic; provider submission happens after, and
 * a submission failure releases the reservation. Validation failures are
 * rejected before the reservation, so they cost nothing.
 *
 * GET — the caller's latest non-terminal run (or null), so a reloaded tab
 * can resume tracking from the server instead of browser state.
 */

const REFERENCE_SOURCE_KINDS: ReferenceSourceKind[] = [
  "curated",
  "upload",
  "direct_url",
  "imported_url",
];

function isFileLike(value: unknown): value is File {
  return typeof value === "object" && value !== null && typeof (value as File).arrayBuffer === "function";
}

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

export async function POST(request: Request): Promise<Response> {
  const user = await authenticateRequest(request);
  if (!user) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  // --- Pre-reservation validation: rejections here cost nothing. ---
  const form = await request.formData().catch(() => null);
  if (!form) return badRequest("expected multipart form data");

  const engineId = form.get("engineId");
  const engine = ENGINES.find((e) => e.id === engineId);
  if (!engine || !engine.endpoint) return badRequest("unknown or unwired engine");
  if (engine.provider !== "fal") {
    return badRequest(`${engine.name} is not available for server-side generation yet`);
  }

  const photo = form.get("photo");
  if (!isFileLike(photo)) return badRequest("a person photo is required");

  const referenceUrl = form.get("referenceUrl");
  const referenceVideo = form.get("referenceVideo");
  const hasReferenceUrl = typeof referenceUrl === "string" && /^https?:\/\//.test(referenceUrl);
  if (!hasReferenceUrl && !isFileLike(referenceVideo)) {
    return badRequest("a reference motion video (file or https URL) is required");
  }

  const sourceKindRaw = form.get("referenceSourceKind");
  const referenceSourceKind: ReferenceSourceKind = REFERENCE_SOURCE_KINDS.includes(
    sourceKindRaw as ReferenceSourceKind,
  )
    ? (sourceKindRaw as ReferenceSourceKind)
    : hasReferenceUrl
      ? "direct_url"
      : "upload";

  // --- Reserve: lock the wallet, check credit, create the job. ---
  let generation;
  try {
    generation = await reserveGeneration(user.id, {
      engine: engine.id,
      provider: engine.provider,
      endpoint: engine.endpoint,
      referenceSourceKind,
    });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return Response.json(
        { error: "insufficient_credits", action: "checkout" },
        { status: 402 },
      );
    }
    throw err;
  }

  // --- Persist the source photo, then submit; failure releases the
  // reservation and purges the photo bytes (retention, issue #60). ---
  let phase: "storage" | "provider" = "storage";
  try {
    const photoBytes = Buffer.from(await photo.arrayBuffer());
    const blobPath = await saveSourcePhotoBytes(
      generation.id,
      photoBytes,
      photo.type || "application/octet-stream",
    );
    await createSourcePhotoAsset({
      userId: user.id,
      generationId: generation.id,
      blobPath,
      contentType: photo.type || "application/octet-stream",
      byteSize: photoBytes.byteLength,
      sha256: createHash("sha256").update(photoBytes).digest("hex"),
    });
    phase = "provider";
    const imageUrl = await uploadToProvider(photo);
    const videoUrl = hasReferenceUrl
      ? (referenceUrl as string)
      : await uploadToProvider(referenceVideo as File);
    const { requestId } = await submitToProvider(engine, imageUrl, videoUrl);
    generation = (await markGenerationSubmitted(generation.id, requestId)) ?? generation;
  } catch (err) {
    const kind = failureKindOf(err, phase === "storage" ? "storage" : "provider");
    const message = err instanceof Error ? err.message : String(err);
    await releaseGeneration(generation.id, kind, message);
    await purgeSourcePhotos(generation.id);
    return Response.json(
      { error: message, kind, generation: await refreshedDto(generation.id, user.id) },
      { status: 502 },
    );
  }

  return Response.json(
    { generation: generationDto(generation), wallet: await getWallet(user.id) },
    { status: 201 },
  );
}

export async function GET(request: Request): Promise<Response> {
  const user = await authenticateRequest(request);
  if (!user) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const generation = await latestActiveGeneration(user.id);
  return Response.json({ generation: generation ? generationDto(generation) : null });
}
