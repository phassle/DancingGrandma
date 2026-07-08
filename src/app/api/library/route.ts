import { authenticateRequest } from "@/lib/server/auth";
import { listLibraryGenerations } from "@/lib/server/db";
import { libraryVideoDto } from "./dto";

export const runtime = "nodejs";

/**
 * The private library (issue #59, PRD #54): a signed-in user's delivered
 * Generated Dance Videos — private account assets they can rewatch, download,
 * share by link, and delete. Playback and download URLs point at the
 * authenticated video route; a share URL exists only while sharing is on.
 */

export async function GET(request: Request): Promise<Response> {
  const user = await authenticateRequest(request);
  if (!user) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const videos = await listLibraryGenerations(user.id);
  return Response.json({ videos: videos.map(libraryVideoDto) });
}
