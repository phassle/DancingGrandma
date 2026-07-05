export const runtime = "nodejs";

type ClientLog = {
  phase?: unknown;
  error?: unknown;
};

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as ClientLog;
  console.error("[dg:client-error]", {
    phase: typeof body.phase === "string" ? body.phase : "unknown",
    url: request.headers.get("referer") ?? undefined,
    userAgent: request.headers.get("user-agent") ?? undefined,
    ...body,
  });
  return Response.json({ ok: true });
}
