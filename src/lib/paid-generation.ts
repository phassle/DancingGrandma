"use client";

/**
 * Browser seam for durable paid generation (issue #57, PRD #54). Unlike the
 * free flow in generate.ts, the browser never talks to the provider here —
 * it starts a server-side job, polls it, and can resume the latest
 * non-terminal job after a reload. The generation gate (#58) builds on this.
 */

export type PaidGenerationStatus =
  | "draft"
  | "awaiting_credit"
  | "reserved"
  | "submitted"
  | "running"
  | "finalizing"
  | "completed"
  | "failed"
  | "cancelled";

export type PaidGeneration = {
  id: string;
  engineId: string;
  status: PaidGenerationStatus;
  requestId: string | null;
  blobPath: string | null;
  errorKind: string | null;
  error: string | null;
};

const TERMINAL: PaidGenerationStatus[] = ["completed", "failed", "cancelled"];

/**
 * Why a paid run could not start or finish:
 * - "unauthenticated" — sign in first (the gate handles this).
 * - "insufficient_credits" — `action` is "checkout"; route the user there.
 * - anything else — the job's error kind (provider, timeout, storage, …).
 */
export class PaidGenerationError extends Error {
  readonly kind: string;
  readonly action?: "checkout";

  constructor(kind: string, message: string, action?: "checkout") {
    super(message);
    this.name = "PaidGenerationError";
    this.kind = kind;
    this.action = action;
  }
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function throwFromResponse(status: number, body: Record<string, unknown>): never {
  const error = typeof body.error === "string" ? body.error : `request failed (${status})`;
  if (status === 401) throw new PaidGenerationError("unauthenticated", error);
  if (status === 402) {
    throw new PaidGenerationError(
      "insufficient_credits",
      error,
      body.action === "checkout" ? "checkout" : undefined,
    );
  }
  const kind = typeof body.kind === "string" ? body.kind : "provider";
  throw new PaidGenerationError(kind, error);
}

/** Start a durable server-side run from the prepared draft. */
export async function startPaidGeneration(
  photo: File,
  referenceVideo: File | string,
  engineId: string,
  referenceSourceKind?: "curated" | "upload" | "direct_url" | "imported_url",
): Promise<PaidGeneration> {
  const form = new FormData();
  form.set("photo", photo);
  form.set("engineId", engineId);
  if (typeof referenceVideo === "string") {
    form.set("referenceUrl", referenceVideo);
  } else {
    form.set("referenceVideo", referenceVideo);
  }
  if (referenceSourceKind) form.set("referenceSourceKind", referenceSourceKind);

  const res = await fetch("/api/generations", { method: "POST", body: form });
  const body = await bodyOf(res);
  if (!res.ok) throwFromResponse(res.status, body);
  return body.generation as PaidGeneration;
}

async function fetchGeneration(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  const body = await bodyOf(res);
  if (!res.ok) throwFromResponse(res.status, body);
  return body;
}

/**
 * Poll a job until it reaches a terminal state. Progress statuses stream
 * through `onUpdate`; a completed job resolves, a failed one throws with
 * the job's recorded error kind and message.
 */
export async function trackPaidGeneration(
  id: string,
  onUpdate: (status: PaidGenerationStatus) => void,
  { pollMs = 2000 }: { pollMs?: number } = {},
): Promise<PaidGeneration> {
  for (;;) {
    const body = await fetchGeneration(`/api/generations/${id}`);
    const generation = body.generation as PaidGeneration | null;
    if (!generation) throw new PaidGenerationError("provider", "generation disappeared");
    if (generation.status === "completed") return generation;
    if (TERMINAL.includes(generation.status)) {
      throw new PaidGenerationError(
        generation.errorKind ?? "provider",
        generation.error ?? `generation ${generation.status}`,
      );
    }
    onUpdate(generation.status);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/** The signed-in user's latest non-terminal run, for resume after reload. */
export async function fetchActivePaidGeneration(): Promise<PaidGeneration | null> {
  const body = await fetchGeneration("/api/generations");
  return (body.generation as PaidGeneration | null) ?? null;
}
