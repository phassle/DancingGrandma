import type { VideoGeneration } from "@/lib/server/db";

/** Wire shape of one private-library video (issue #59, PRD #54). */
export type LibraryVideoDto = {
  id: string;
  engineId: string;
  createdAt: string;
  completedAt: string | null;
  videoUrl: string;
  downloadUrl: string;
  shared: boolean;
  shareUrl: string | null;
};

export function libraryVideoDto(row: VideoGeneration): LibraryVideoDto {
  return {
    id: row.id,
    engineId: row.engine,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    videoUrl: `/api/video/${row.id}`,
    downloadUrl: `/api/video/${row.id}?download=1`,
    shared: row.visibility === "shared",
    shareUrl: row.share_slug ? `/v/${row.share_slug}` : null,
  };
}
