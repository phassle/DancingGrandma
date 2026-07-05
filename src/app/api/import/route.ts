import { importClip } from "@/lib/import-clip";

/**
 * Import a reference clip from a page URL (YouTube, TikTok, …). Runs yt-dlp +
 * ffmpeg, so it needs the Node.js runtime. Responds with the transcoded MP4
 * bytes; the clip's name rides along in the X-Clip-Name header.
 */
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const { url } = await request.json().catch(() => ({}) as { url?: unknown });
  if (typeof url !== "string" || !url.trim()) {
    return Response.json({ error: "No URL provided" }, { status: 400 });
  }

  try {
    const { name, bytes } = await importClip(url.trim());
    return new Response(bytes, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(bytes.byteLength),
        "X-Clip-Name": encodeURIComponent(name),
        "Content-Disposition": `inline; filename="${name}"`,
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 502 },
    );
  }
}
