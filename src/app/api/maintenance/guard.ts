/**
 * Shared guard for operator-only maintenance routes (issue #60, PRD #54).
 * These are not user routes: they are called by an operator or a scheduled
 * job holding the MAINTENANCE_TOKEN shared secret. With no token configured
 * the routes do not exist (404); with a wrong bearer token they refuse (401).
 */
export function maintenanceGuard(request: Request): Response | null {
  const token = process.env.MAINTENANCE_TOKEN;
  if (!token) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  if (request.headers.get("authorization") !== `Bearer ${token}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
