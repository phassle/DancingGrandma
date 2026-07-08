import { randomUUID } from "crypto";
import { requireUser } from "@/lib/server/auth";
import { getGenerationForUser, setGenerationSharing } from "@/lib/server/db";
import { SHARE_ID_PATTERN, shareUrlOf } from "@/lib/share-id";

export const runtime = "nodejs";

/**
 * Share-by-link toggle (issue #59, PRD #54). Enabling mints a fresh
 * unguessable slug — never the generation id — so the private id never
 * leaks and links from a previous sharing round stay dead. Disabling clears
 * the slug, which is what makes the share page and stream stop resolving.
 */

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await requireUser(request);
  if (user instanceof Response) return user;

  const { id } = await context.params;
  if (!SHARE_ID_PATTERN.test(id)) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { shared?: unknown } | null;
  if (typeof body?.shared !== "boolean") {
    return Response.json({ error: "expected { shared: boolean }" }, { status: 400 });
  }

  const existing = await getGenerationForUser(id, user.id);
  if (!existing) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  if (existing.status !== "completed") {
    return Response.json({ error: "only a delivered video can be shared" }, { status: 409 });
  }

  const updated = await setGenerationSharing(id, user.id, body.shared ? randomUUID() : null);
  if (!updated) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json({
    shared: updated.visibility === "shared",
    shareUrl: updated.share_slug ? shareUrlOf(updated.share_slug) : null,
  });
}
