/**
 * Best-effort cleanup of a photo that was uploaded to fal storage.
 *
 * The client calls this route after a generation run finishes (success or
 * failure) to honour the "used once, deleted" FAQ promise.  Deletion is
 * best-effort — if fal's REST API returns an error we log it and return 200
 * so the client's generation flow is never blocked.
 *
 * Photos are also uploaded with a 1-hour TTL so they auto-expire even when
 * this cleanup route is not reachable.
 */
export const runtime = "nodejs";

function isFalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "fal.media" || hostname.endsWith(".fal.media");
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url : null;

  if (!url || !isFalUrl(url)) {
    return Response.json({ error: "A valid fal.media URL is required" }, { status: 400 });
  }

  const falKey = process.env.FAL_KEY;
  if (!falKey) {
    // No key available server-side; fal's TTL will clean up the file.
    return Response.json({ deleted: false, reason: "no-key" });
  }

  try {
    // fal CDN v3 files can be deleted via the REST API.
    // The file path is the everything after "fal.media/".
    const parsedUrl = new URL(url);
    const filePath = parsedUrl.pathname.replace(/^\//, "");
    const deleteUrl = `https://rest.alpha.fal.ai/storage/objects/${encodeURIComponent(filePath)}`;

    const res = await fetch(deleteUrl, {
      method: "DELETE",
      headers: { Authorization: `Key ${falKey}` },
    });

    if (!res.ok) {
      console.warn("[dg:photo-cleanup]", { url, status: res.status, statusText: res.statusText });
      return Response.json({ deleted: false, reason: `provider-${res.status}` });
    }
    return Response.json({ deleted: true });
  } catch (err) {
    console.warn("[dg:photo-cleanup]", { url, error: err instanceof Error ? err.message : String(err) });
    return Response.json({ deleted: false, reason: "network-error" });
  }
}
