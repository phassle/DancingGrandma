/**
 * Video generation engine registry.
 *
 * Every engine here performs the same core task — one photo + one reference
 * dance video → a video of that person doing the dance. The facts (pricing,
 * licensing, audio behavior, duration caps) come from the verified deep-research
 * pass of 2026-07-05; update them when providers change their terms.
 */

export type EngineStatus = "recommended" | "available" | "coming-soon";
export type EngineProvider = "fal" | "replicate" | "huggingface" | "azure";

export type Engine = {
  id: string;
  name: string;
  vendor: string;
  provider: EngineProvider;
  status: EngineStatus;
  tagline: string;
  pricing: string;
  carriesAudio: boolean;
  maxDuration: string;
  docsUrl: string;
  howWired: string;
  goldenClip?: string;
  /** Provider-specific model path, deployment name, or endpoint id. */
  endpoint?: string;
  /**
   * Name of a server-side env var whose presence makes this engine selectable.
   * When set, {@link resolveEngines} flips the engine between `available`
   * (configured) and `coming-soon` (not configured). Keeps the endpoint/key
   * server-side while letting the picker gate selection honestly.
   */
  requiresEnv?: string;
};

export const ENGINES: Engine[] = [
  {
    id: "kling-motion-control",
    name: "Kling 2.6 Motion Control",
    vendor: "Kuaishou · via fal.ai / Replicate",
    provider: "fal",
    status: "recommended",
    tagline: "Keeps the original music automatically — zero audio plumbing.",
    pricing: "$0.07 / video-second (standard)",
    carriesAudio: true,
    maxDuration: "10 s (photo framing) / 30 s (video framing)",
    docsUrl: "https://fal.ai/models/fal-ai/kling-video/v2.6/standard/motion-control",
    howWired: "fal.ai queue API · Kling motion-control",
    goldenClip: "/dances/renegade.mp4",
    endpoint: "fal-ai/kling-video/v2.6/standard/motion-control",
  },
  {
    id: "wan-animate-fal",
    name: "Wan 2.2 Animate 14B",
    vendor: "Alibaba · via fal.ai",
    provider: "fal",
    status: "available",
    tagline: "Open source (Apache 2.0), beat Runway & DreamActor in user studies.",
    pricing: "$0.08 / video-second at 720p",
    carriesAudio: false,
    maxDuration: "Follows the reference clip",
    docsUrl: "https://fal.ai/models/fal-ai/wan/v2.2-14b/animate/move",
    howWired: "fal.ai queue API · Wan animate/move",
    goldenClip: "/dances/griddy.mp4",
    endpoint: "fal-ai/wan/v2.2-14b/animate/move",
  },
  {
    id: "wan-animate-replicate",
    name: "Wan 2.2 Animate · Replicate",
    vendor: "Tongyi Lab · Replicate (HF weights)",
    provider: "replicate",
    status: "available",
    tagline: "Character animation: transfers motion from the reference dance video.",
    pricing: "Billed by Replicate",
    carriesAudio: true,
    maxDuration: "Provider limit",
    docsUrl: "https://replicate.com/wan-video/wan-2.2-animate-animation",
    howWired: "Replicate official Wan Animate · character image + motion reference video",
    goldenClip: "/dances/macarena.mp4",
    endpoint: "wan-video/wan-2.2-animate-animation",
  },
  {
    id: "sora-2-azure",
    name: "Sora 2 · Azure AI Foundry",
    vendor: "Azure AI Foundry",
    provider: "azure",
    status: "coming-soon",
    tagline: "Not wired until Azure exposes the required character-animation contract.",
    pricing: "Azure model deployment pricing",
    carriesAudio: true,
    maxDuration: "Azure deployment limit",
    docsUrl: "https://learn.microsoft.com/azure/foundry/openai/concepts/video-generation",
    howWired: "Blocked: current Sora route is not character animation / replacement",
    goldenClip: "/dances/disco.mp4",
  },
  {
    id: "wan-animate-azure",
    name: "Wan 2.2 Animate · Azure",
    vendor: "Self-hosted on Azure · Container Apps GPU",
    provider: "azure",
    // Default off; resolveEngines() flips this to "available" when the
    // AZURE_WAN_ENDPOINT is configured server-side (issue #17).
    status: "coming-soon",
    tagline: "Same Wan Animate motion transfer, running on your own Azure GPU.",
    pricing: "Azure GPU time (scale-to-zero)",
    carriesAudio: true,
    maxDuration: "Follows the reference clip",
    docsUrl: "https://learn.microsoft.com/azure/container-apps/gpu-serverless-overview",
    howWired: "Azure Container Apps serverless GPU · self-hosted Wan Animate",
    goldenClip: "/dances/woah.mp4",
    endpoint: "wan-2.2-animate",
    requiresEnv: "AZURE_WAN_ENDPOINT",
  },
  {
    id: "wan-animate-selfhosted",
    name: "Wan 2.2 Animate 14B · self-hosted",
    vendor: "Your GPUs · ComfyUI / Diffusers",
    provider: "huggingface",
    status: "coming-soon",
    tagline: "Same model, no per-video fee — bring your own GPU fleet.",
    pricing: "GPU time only",
    carriesAudio: false,
    maxDuration: "Follows the reference clip",
    docsUrl: "https://github.com/Wan-Video/Wan2.2",
    howWired: "Self-hosted Wan weights",
  },
  {
    id: "runway-act-two",
    name: "Runway Act-Two",
    vendor: "Runway · official API",
    provider: "azure",
    status: "coming-soon",
    tagline: "Closed-source contender — strongest on facial performance.",
    pricing: "Credit-based",
    carriesAudio: false,
    maxDuration: "Per Runway plan",
    docsUrl: "https://runwayml.com",
    howWired: "Future provider adapter",
  },
  {
    id: "viggle",
    name: "Viggle AI",
    vendor: "Viggle",
    provider: "fal",
    status: "coming-soon",
    tagline: "The app that made this meme format famous.",
    pricing: "Credit-based",
    carriesAudio: false,
    maxDuration: "Per Viggle plan",
    docsUrl: "https://viggle.ai",
    howWired: "Future provider adapter",
  },
];

export const DEFAULT_ENGINE = ENGINES[0];

/**
 * Resolve the registry against the server-side environment: an engine that
 * declares `requiresEnv` is selectable (`available`) only when that env var is
 * set, otherwise it stays `coming-soon`. Called in a server component so the
 * endpoint/key never reach the browser (issue #17); every other engine is
 * returned unchanged.
 */
export function resolveEngines(env: Record<string, string | undefined>): Engine[] {
  return ENGINES.map((engine) => {
    if (!engine.requiresEnv) return engine;
    const configured = Boolean(env[engine.requiresEnv]);
    return { ...engine, status: configured ? "available" : "coming-soon" };
  });
}
