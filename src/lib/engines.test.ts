import { expect, test } from "vitest";
import { ENGINES, resolveEngines } from "./engines";

test("Azure Wan Animate engine is registered as a character-animation azure provider", () => {
  const azure = ENGINES.find((e) => e.id === "wan-animate-azure");
  expect(azure).toBeDefined();
  expect(azure?.provider).toBe("azure");
  // The picker's "how it's wired" note must name the real Azure hosting path.
  expect(azure?.howWired).toMatch(/Azure Container Apps|serverless GPU/i);
  // A golden clip backs the unavailable-provider fallback.
  expect(azure?.goldenClip).toBeTruthy();
});

test("Azure Wan engine stays coming-soon when AZURE_WAN_ENDPOINT is not configured", () => {
  const azure = resolveEngines({}).find((e) => e.id === "wan-animate-azure");
  expect(azure?.status).toBe("coming-soon");
});

test("Azure Wan engine becomes selectable (available) when AZURE_WAN_ENDPOINT is configured", () => {
  const azure = resolveEngines({
    AZURE_WAN_ENDPOINT: "https://wan.internal.azurecontainerapps.io/animate",
  }).find((e) => e.id === "wan-animate-azure");
  expect(azure?.status).toBe("available");
});

test("resolveEngines leaves non-env-gated engines unchanged and preserves the roster", () => {
  const resolved = resolveEngines({ AZURE_WAN_ENDPOINT: "https://x" });
  expect(resolved).toHaveLength(ENGINES.length);
  // Sora stays honestly coming-soon; the default engine is untouched.
  expect(resolved.find((e) => e.id === "sora-2-azure")?.status).toBe("coming-soon");
  expect(resolved.find((e) => e.id === "kling-motion-control")?.status).toBe("recommended");
});
