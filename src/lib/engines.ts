/**
 * Video generation engine registry.
 *
 * Every engine here performs the same core task — one photo + one reference
 * dance video → a video of that person doing the dance. The facts (pricing,
 * licensing, audio behavior, duration caps) come from the verified deep-research
 * pass of 2026-07-05; update them when providers change their terms.
 */

export type EngineStatus = "recommended" | "available" | "coming-soon";

export type Engine = {
  id: string;
  name: string;
  vendor: string;
  status: EngineStatus;
  tagline: string;
  pricing: string;
  audio: string;
  maxDuration: string;
  docsUrl: string;
  /** fal.ai / Replicate model path used once real generation is wired up. */
  endpoint?: string;
};

export const ENGINES: Engine[] = [
  {
    id: "wan-animate-fal",
    name: "Wan 2.2 Animate 14B",
    vendor: "Alibaba · via fal.ai",
    status: "recommended",
    tagline: "Open source (Apache 2.0), beat Runway & DreamActor in user studies.",
    pricing: "$0.08 / video-second at 720p",
    audio: "Reference music muxed on after generation",
    maxDuration: "Follows the reference clip",
    docsUrl: "https://fal.ai/models/fal-ai/wan/v2.2-14b/animate/move",
    endpoint: "fal-ai/wan/v2.2-14b/animate/move",
  },
  {
    id: "kling-motion-control",
    name: "Kling 2.6 Motion Control",
    vendor: "Kuaishou · via fal.ai / Replicate",
    status: "available",
    tagline: "Keeps the original music automatically — zero audio plumbing.",
    pricing: "$0.07 / video-second (standard)",
    audio: "keep_original_sound built in",
    maxDuration: "10 s (photo framing) / 30 s (video framing)",
    docsUrl: "https://fal.ai/models/fal-ai/kling-video/v2.6/standard/motion-control",
    endpoint: "fal-ai/kling-video/v2.6/standard/motion-control",
  },
  {
    id: "wan-animate-selfhosted",
    name: "Wan 2.2 Animate 14B · self-hosted",
    vendor: "Your GPUs · ComfyUI / Diffusers",
    status: "coming-soon",
    tagline: "Same model, no per-video fee — bring your own GPU fleet.",
    pricing: "GPU time only",
    audio: "Reference music muxed on after generation",
    maxDuration: "Follows the reference clip",
    docsUrl: "https://github.com/Wan-Video/Wan2.2",
  },
  {
    id: "runway-act-two",
    name: "Runway Act-Two",
    vendor: "Runway · official API",
    status: "coming-soon",
    tagline: "Closed-source contender — strongest on facial performance.",
    pricing: "Credit-based",
    audio: "Muxed on after generation",
    maxDuration: "Per Runway plan",
    docsUrl: "https://runwayml.com",
  },
  {
    id: "viggle",
    name: "Viggle AI",
    vendor: "Viggle",
    status: "coming-soon",
    tagline: "The app that made this meme format famous.",
    pricing: "Credit-based",
    audio: "Varies by export",
    maxDuration: "Per Viggle plan",
    docsUrl: "https://viggle.ai",
  },
];

export const DEFAULT_ENGINE = ENGINES[0];
