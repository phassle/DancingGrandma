import { readVideoBytes } from "@/lib/server/blob";

export const runtime = "nodejs";

function isValidShareId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!isValidShareId(id)) {
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
    const statusCode = typeof err === "object" && err !== null && "statusCode" in err ? (err as { statusCode?: unknown }).statusCode : undefined;
    if (statusCode === 404) {
      return new Response("Not Found", { status: 404 });
    }
    throw err;
  }
}
