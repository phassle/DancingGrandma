import { getGenerationForUser, type VideoGeneration } from "@/lib/server/db";

/** Wire shape of a generation job, shared by the start/status/resume routes. */
export type GenerationDto = {
  id: string;
  engineId: string;
  status: VideoGeneration["status"];
  requestId: string | null;
  referenceSourceKind: VideoGeneration["reference_source_kind"];
  creditPrice: number;
  blobPath: string | null;
  errorKind: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

export function generationDto(row: VideoGeneration): GenerationDto {
  return {
    id: row.id,
    engineId: row.engine,
    status: row.status,
    requestId: row.provider_request_id,
    referenceSourceKind: row.reference_source_kind,
    creditPrice: row.credit_price,
    blobPath: row.blob_path,
    errorKind: row.error_kind,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

/** Re-read a job after a state transition so the response reflects the row. */
export async function refreshedDto(id: string, userId: string): Promise<GenerationDto | null> {
  const row = await getGenerationForUser(id, userId);
  return row ? generationDto(row) : null;
}

/** Structural error-kind extraction — provider failures carry a `kind`. */
export function failureKindOf(err: unknown, fallback: string): string {
  if (typeof err === "object" && err !== null && "kind" in err) {
    const kind = (err as { kind?: unknown }).kind;
    if (typeof kind === "string") return kind;
  }
  return fallback;
}
