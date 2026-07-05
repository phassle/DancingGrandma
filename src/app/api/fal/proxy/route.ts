import { route } from "@fal-ai/server-proxy/nextjs";

/**
 * Server-side proxy for fal.ai — the browser calls this route and the
 * FAL_KEY (from .env.local) never leaves the server.
 */
export const { GET, POST, PUT } = route;
