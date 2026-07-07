/**
 * Server-side image moderation gate.
 *
 * Accepts a photo upload and returns { accepted: boolean, reason?: string }.
 * The current implementation validates the file type — plug in a real
 * content-moderation service (e.g. Azure Content Safety, AWS Rekognition) by
 * replacing the body of `moderateImage`.
 */
export const runtime = "nodejs";

const ACCEPTED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB server-side limit

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

async function moderateImage(
  _photo: Blob,
  contentType: string,
): Promise<{ accepted: boolean; reason?: string }> {
  if (!ACCEPTED_TYPES.has(contentType.toLowerCase().split(";")[0].trim())) {
    return { accepted: false, reason: "That file doesn't look like a photo. Try a JPG, PNG or WebP." };
  }
  // TODO: plug in Azure Content Safety / AWS Rekognition / similar here.
  return { accepted: true };
}

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("Expected multipart/form-data with a 'photo' field", 400);
  }

  const photo = form.get("photo");
  if (!(photo instanceof Blob)) {
    return errorResponse("'photo' field is required and must be a file", 400);
  }

  if (photo.size > MAX_BYTES) {
    return errorResponse("Photo is too large for moderation (20 MB limit)", 413);
  }

  const contentType = photo.type || "application/octet-stream";
  const result = await moderateImage(photo, contentType);
  return Response.json(result);
}
