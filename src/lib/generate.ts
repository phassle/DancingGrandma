"use client";

export type GenerationUpdate = (message: string) => void;

/**
 * How a generation run can fail, so the wizard can react differently:
 * - "unavailable" — the provider account can't serve anyone right now
 *   (fal 403 "User is locked. Reason: Exhausted balance").
 * - "timeout" — the run was accepted but didn't finish in time.
 * - "provider" — any other provider-side failure; worth a retry.
 * - "moderation" — the uploaded photo was rejected by server-side moderation.
 */
export type GenerationFailureKind = "unavailable" | "timeout" | "provider" | "moderation";

export type GenerationErrorMeta = {
  status?: number;
  requestId?: string;
  code?: string;
  providerDetail?: unknown;
};

export class GenerationError extends Error {
  readonly kind: GenerationFailureKind;
  readonly status?: number;
  readonly requestId?: string;
  readonly code?: string;
  readonly providerDetail?: unknown;

  constructor(kind: GenerationFailureKind, message: string, meta: GenerationErrorMeta = {}) {
    super(message);
    this.name = "GenerationError";
    this.kind = kind;
    this.status = meta.status;
    this.requestId = meta.requestId;
    this.code = meta.code;
    this.providerDetail = meta.providerDetail;
  }
}

/**
 * Call the server-side moderation endpoint. Throws a GenerationError with
 * kind "moderation" if the photo is rejected.
 */
export async function moderatePhoto(photo: File): Promise<void> {
  const form = new FormData();
  form.set("photo", photo);
  let res: Response;
  try {
    res = await fetch("/api/moderate", { method: "POST", body: form });
  } catch (err) {
    // Network error — treat as accepted so a connectivity blip doesn't block
    // all runs. Real rejections come from a healthy server response.
    console.warn("[dg:moderation-fetch-error]", err instanceof Error ? err.message : err);
    return;
  }
  if (!res.ok) {
    // Server error on moderation side — treat as accepted (best-effort).
    console.warn("[dg:moderation-error]", { status: res.status });
    return;
  }
  const body = (await res.json().catch(() => ({ accepted: true }))) as {
    accepted: boolean;
    reason?: string;
  };
  if (!body.accepted) {
    throw new GenerationError(
      "moderation",
      body.reason ?? "This photo can't be used. Please choose a different one.",
    );
  }
}
