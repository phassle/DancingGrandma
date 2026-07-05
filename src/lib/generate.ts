"use client";

import { fal } from "@fal-ai/client";
import type { Engine } from "./engines";

fal.config({ proxyUrl: "/api/fal/proxy" });

export type GenerationUpdate = (message: string) => void;

/**
 * The single generation seam: photo + reference dance video + engine → video URL.
 * Everything above (the wizard) and below (engine adapters) varies independently.
 */
export async function generateDanceVideo(
  photo: File,
  referenceVideo: File,
  engine: Engine,
  onUpdate: GenerationUpdate,
): Promise<string> {
  if (!engine.endpoint) {
    throw new Error(`${engine.name} has no wired adapter yet`);
  }

  onUpdate("Uploading the star…");
  const imageUrl = await fal.storage.upload(photo);
  onUpdate("Uploading the choreography…");
  const videoUrl = await fal.storage.upload(referenceVideo);

  // Per-engine input mapping. Both current adapters take image+video URLs;
  // Kling additionally carries the reference audio through on its own.
  const input =
    engine.id === "kling-motion-control"
      ? { image_url: imageUrl, video_url: videoUrl, keep_original_sound: true }
      : { image_url: imageUrl, video_url: videoUrl, resolution: "580p" };

  onUpdate("Teaching her the moves…");
  const result = await fal.subscribe(engine.endpoint, {
    input,
    logs: false,
    onQueueUpdate: (update) => {
      if (update.status === "IN_QUEUE") onUpdate("Waiting for a spot on the dance floor…");
      if (update.status === "IN_PROGRESS") onUpdate("Rendering, frame by frame…");
    },
  });

  const url = (result.data as { video?: { url?: string } })?.video?.url;
  if (!url) {
    throw new Error("The engine finished but returned no video");
  }
  return url;
}
