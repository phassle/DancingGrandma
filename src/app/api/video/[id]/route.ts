import { readVideoBytes } from "@/lib/server/blob";
import { isShareId } from "@/lib/share-id";

export const runtime = "nodejs";

function isMissingBlob(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const known = err as { statusCode?: unknown; code?: unknown };
  return (
    (typeof known.statusCode === "number" && known.statusCode === 404) ||
    (typeof known.code === "string" && known.code === "BlobNotFound")
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!isShareId(id)) {
    return new Response("Not Found", { status: 404 });
  }

  try {
    const output = await readVideoBytes(`${id}.mp4`);
    return new Response(output, {
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="dancing-grandma-${id}.mp4"`,
      },
    });
  } catch (err) {
    if (isMissingBlob(err)) {
      return new Response("Not Found", { status: 404 });
    }
    throw err;
  }
}
