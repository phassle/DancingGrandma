"use client";

// Type-only import — erased at compile time, so no server code is bundled.
import type { ReferenceSourceKind } from "@/lib/server/db";
import {
  GenerationError,
  moderatePhoto,
  type GenerationFailureKind,
  type GenerationUpdate,
} from "./generate";

/**
 * Client seam to the durable paid-generation workflow (issue #58, PRD #54).
 *
 * The generation gate flows through here: check who's asking and what they
 * can spend, kick off Stripe Checkout when the wallet is empty, recreate the
 * browser draft as a server-side generation (inputs become private media
 * only now — after authentication), and track the run by polling the status
 * route, which is also what advances capture/release on the server.
 */

export type Account = { status: "anonymous" } | { status: "signed-in"; credits: number };

/** The wallet can't cover the run — send the user to Stripe Checkout. */
export class CheckoutRequiredError extends Error {
  constructor() {
    super("checkout required");
    this.name = "CheckoutRequiredError";
  }
}

/** No valid session — send the user back through the gate. */
export class AuthRequiredError extends Error {
  constructor() {
    super("sign-in required");
    this.name = "AuthRequiredError";
  }
}

/** Full-page navigation seam (Keycloak, Stripe) — mockable in component tests. */
export function redirectTo(url: string): void {
  window.location.assign(url);
}

export async function fetchAccount(): Promise<Account> {
  try {
    const res = await fetch("/api/me");
    if (!res.ok) return { status: "anonymous" };
    const body = (await res.json()) as { wallet: { available: number } };
    return { status: "signed-in", credits: body.wallet.available };
  } catch {
    return { status: "anonymous" };
  }
}

export async function startCheckout(): Promise<string> {
  const res = await fetch("/api/billing/checkout", { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) {
    throw new Error(body.error ?? `checkout failed (${res.status})`);
  }
  return body.url;
}

export type ServerGenerationInput = {
  photo: File;
  /** A File is uploaded as private media; a string URL is handed through. */
  reference: File | string;
  sourceKind: ReferenceSourceKind;
  engineId: string;
};

const KNOWN_KINDS: GenerationFailureKind[] = ["unavailable", "timeout", "provider", "moderation"];

function toFailureKind(kind: unknown): GenerationFailureKind {
  return KNOWN_KINDS.includes(kind as GenerationFailureKind)
    ? (kind as GenerationFailureKind)
    : "provider";
}

export async function createServerGeneration(
  input: ServerGenerationInput,
): Promise<{ id: string }> {
  // Moderation runs first so a rejected photo costs nothing (PRD story 25).
  await moderatePhoto(input.photo);

  const form = new FormData();
  form.set("photo", input.photo);
  form.set("engineId", input.engineId);
  form.set("referenceSourceKind", input.sourceKind);
  if (typeof input.reference === "string") {
    form.set("referenceUrl", input.reference);
  } else {
    form.set("referenceVideo", input.reference);
  }

  const res = await fetch("/api/generations", { method: "POST", body: form });
  if (res.status === 401) throw new AuthRequiredError();
  if (res.status === 402) throw new CheckoutRequiredError();
  const body = (await res.json().catch(() => ({}))) as {
    generation?: { id: string };
    error?: string;
    kind?: string;
  };
  if (!res.ok || !body.generation) {
    throw new GenerationError(
      toFailureKind(body.kind),
      body.error ?? `generation start failed (${res.status})`,
    );
  }
  return { id: body.generation.id };
}

type GenerationStatusDto = {
  id: string;
  status: "draft" | "reserved" | "submitted" | "running" | "finalizing" | "completed" | "failed" | "cancelled";
  errorKind?: string | null;
  error?: string | null;
};

const STATUS_MESSAGES: Partial<Record<GenerationStatusDto["status"], string>> = {
  submitted: "Waiting in the render queue…",
  running: "Rendering the dance…",
  finalizing: "Finalizing audio and watermark…",
};

export type ServerTrackOptions = { pollMs?: number };

/**
 * Poll the run until it settles. Resolves to the durable stored-video URL;
 * a failed job throws a GenerationError carrying the recorded error kind.
 * Transient poll errors are swallowed — the server job is durable, so the
 * client just keeps asking.
 */
export async function trackServerGeneration(
  generationId: string,
  onUpdate: GenerationUpdate,
  { pollMs = 3000 }: ServerTrackOptions = {},
): Promise<string> {
  for (;;) {
    let generation: GenerationStatusDto | undefined;
    try {
      const res = await fetch(`/api/generations/${generationId}`);
      if (res.status === 401) throw new AuthRequiredError();
      if (res.ok) {
        generation = ((await res.json()) as { generation?: GenerationStatusDto }).generation;
      }
    } catch (err) {
      if (err instanceof AuthRequiredError) throw err;
      // Transient network failure — keep polling.
    }

    if (generation) {
      if (generation.status === "completed") return `/api/video/${generationId}`;
      if (generation.status === "failed" || generation.status === "cancelled") {
        throw new GenerationError(
          toFailureKind(generation.errorKind),
          generation.error ?? "The generation failed",
        );
      }
      const message = STATUS_MESSAGES[generation.status];
      if (message) onUpdate(message);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
