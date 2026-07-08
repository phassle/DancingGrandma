import { requireUser } from "@/lib/server/auth";
import {
  captureGeneration,
  getGenerationForUser,
  markGenerationFinalizing,
  markGenerationRunning,
  releaseGeneration,
  softDeleteGeneration,
  TERMINAL_GENERATION_STATUSES,
  type VideoGeneration,
} from "@/lib/server/db";
import { deleteBlob, saveVideoFromUrl } from "@/lib/server/blob";
import { purgeSourcePhotos } from "@/lib/server/retention";
import { providerResult, providerStatus } from "@/lib/server/provider";
import { failureKindOf, generationDto, refreshedDto } from "../dto";
import { SHARE_ID_PATTERN } from "@/lib/share-id";

export const runtime = "nodejs";

/**
 * Poll a paid run (issue #57, PRD #54). Each poll advances the job one step:
 * provider still queued/running → reflect that; provider completed → copy the
 * output to Azure Blob Storage FIRST, then mark completed and capture the
 * reservation; provider or storage failure → fail the job with an error kind
 * and release the reservation. Capture and release are idempotent, so
 * concurrent polls settle the credit exactly once.
 */

const POLLABLE: VideoGeneration["status"][] = ["submitted", "running", "finalizing"];

async function advance(generation: VideoGeneration): Promise<void> {
  const { id, endpoint, provider_request_id: requestId } = generation;
  if (!endpoint || !requestId) return;

  let phase: "provider" | "storage" = "provider";
  try {
    const status = await providerStatus(endpoint, requestId);
    if (status === "queued") return;
    if (status === "running") {
      await markGenerationRunning(id);
      return;
    }
    await markGenerationFinalizing(id);
    const videoUrl = await providerResult(endpoint, requestId);
    phase = "storage";
    const blobPath = await saveVideoFromUrl(id, videoUrl);
    if (await captureGeneration(id, videoUrl, blobPath)) {
      // Terminal state reached: the source photo's retention ends here.
      await purgeSourcePhotos(id);
    }
  } catch (err) {
    const kind = failureKindOf(err, phase === "storage" ? "storage" : "provider");
    const message = err instanceof Error ? err.message : String(err);
    if (await releaseGeneration(id, kind, message)) {
      await purgeSourcePhotos(id);
    }
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const { id } = await context.params;
  if (!SHARE_ID_PATTERN.test(id)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const generation = await getGenerationForUser(id, user.id);
  if (!generation) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  // Only a poll that actually advanced the job can have changed the row.
  if (!POLLABLE.includes(generation.status)) {
    return Response.json({ generation: generationDto(generation) });
  }
  await advance(generation);
  return Response.json({ generation: await refreshedDto(id, user.id) });
}

/**
 * Delete a video from the library (issue #59): soft-delete the row (the
 * ledger trail must survive), revoke any share link, and remove the stored
 * blob. Only the owner's terminal runs qualify — an in-flight run still
 * holds its credit reservation and must settle before it can be deleted.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const { id } = await context.params;
  if (!SHARE_ID_PATTERN.test(id)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const generation = await getGenerationForUser(id, user.id);
  if (!generation) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  if (!TERMINAL_GENERATION_STATUSES.includes(generation.status)) {
    return Response.json({ error: "generation is still in progress" }, { status: 409 });
  }

  const deleted = await softDeleteGeneration(id, user.id);
  if (!deleted) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  if (deleted.blob_path) {
    await deleteBlob(deleted.blob_path);
  }
  return Response.json({ deleted: true });
}
