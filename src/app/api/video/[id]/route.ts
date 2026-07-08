import { authenticateRequest } from "@/lib/server/auth";
import { readVideoBytes } from "@/lib/server/blob";
import { getGenerationById, getSharedGeneration } from "@/lib/server/db";
import { isShareId } from "@/lib/share-id";

export const runtime = "nodejs";

/**
 * Video playback (issue #59, PRD #54). Blob containers are private; every
 * stream goes through this route, which decides access by what the id is:
 *
 * 1. A share slug of a video whose sharing is on — served without login.
 *    Turning sharing off clears the slug, so the same URL stops resolving.
 * 2. A generation id — the video is a private account asset: only its
 *    authenticated owner may play or download it, and never after deletion.
 * 3. Neither — a legacy finalize-era blob keyed by an unguessable random id
 *    with no database row; served as before.
 */

function isMissingBlob(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const known = err as { statusCode?: unknown; code?: unknown };
  return (
    (typeof known.statusCode === "number" && known.statusCode === 404) ||
    (typeof known.code === "string" && known.code === "BlobNotFound")
  );
}

function videoResponse(
  bytes: Buffer,
  id: string,
  opts: { cacheControl: string; download: boolean },
): Response {
  // Copy into a plain Uint8Array<ArrayBuffer> — Buffer's ArrayBufferLike
  // generic is not assignable to BodyInit under strict TS.
  return new Response(Uint8Array.from(bytes), {
    headers: {
      "Content-Type": "video/mp4",
      "Cache-Control": opts.cacheControl,
      "Content-Disposition": `${opts.download ? "attachment" : "inline"}; filename="dancing-grandma-${id}.mp4"`,
    },
  });
}

async function streamBlob(
  blobPath: string,
  id: string,
  opts: { cacheControl: string; download: boolean },
): Promise<Response> {
  try {
    return videoResponse(await readVideoBytes(blobPath), id, opts);
  } catch (err) {
    if (isMissingBlob(err)) {
      return new Response("Not Found", { status: 404 });
    }
    throw err;
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!isShareId(id)) {
    return new Response("Not Found", { status: 404 });
  }
  const download = new URL(request.url).searchParams.get("download") === "1";

  // Share-by-link: the slug resolves only while the owner keeps sharing on.
  const shared = await getSharedGeneration(id);
  if (shared?.blob_path) {
    // Kept out of shared caches so revoking the link takes effect promptly.
    return streamBlob(shared.blob_path, id, { cacheControl: "private, max-age=0", download });
  }

  // A generation id names a private account asset — owner only.
  const generation = await getGenerationById(id);
  if (generation) {
    const user = await authenticateRequest(request);
    if (!user) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (generation.user_id !== user.id || generation.deleted_at || !generation.blob_path) {
      return new Response("Not Found", { status: 404 });
    }
    return streamBlob(generation.blob_path, id, { cacheControl: "private, max-age=0", download });
  }

  // Legacy finalize-era blob: unguessable random id, no database row.
  return streamBlob(`${id}.mp4`, id, {
    cacheControl: "public, max-age=31536000, immutable",
    download,
  });
}
