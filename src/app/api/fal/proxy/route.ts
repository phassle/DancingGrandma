import { createRouteHandler } from "@fal-ai/server-proxy/nextjs";
import type { NextRequest } from "next/server";

/**
 * Server-side proxy for fal.ai — the browser calls this route and the
 * FAL_KEY (from .env.local) never leaves the server.
 */
const falRoute = createRouteHandler();

async function responseDetail(response: Response): Promise<unknown> {
  const clone = response.clone();
  return clone
    .json()
    .catch(async () => clone.text().catch(() => undefined));
}

async function withFalLogging(
  method: "GET" | "POST" | "PUT",
  request: NextRequest,
): Promise<Response> {
  const response = await falRoute[method](request);
  if (!response.ok) {
    console.error("[dg:fal-proxy-error]", {
      method,
      status: response.status,
      statusText: response.statusText,
      requestUrl: request.url,
      detail: await responseDetail(response),
    });
  }
  return response;
}

export function GET(request: NextRequest): Promise<Response> {
  return withFalLogging("GET", request);
}

export function POST(request: NextRequest): Promise<Response> {
  return withFalLogging("POST", request);
}

export function PUT(request: NextRequest): Promise<Response> {
  return withFalLogging("PUT", request);
}
