import "server-only";

/**
 * Azure AI Foundry Sora client — the API recipe verified in
 * scripts/generate-grandma.sh, as server-side TypeScript. The endpoint,
 * key, and deployment arrive from the apphost as SORA_* env vars.
 */

type SoraJob = {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed" | string;
  progress?: number;
  error?: unknown;
};

const API_VERSION = "preview";

function soraConfig() {
  const endpoint = process.env.SORA_ENDPOINT;
  const apiKey = process.env.SORA_API_KEY;
  const model = process.env.SORA_DEPLOYMENT ?? "sora-2";
  if (!endpoint || !apiKey) {
    throw new Error("SORA_ENDPOINT / SORA_API_KEY not set — fill in appsettings.Development.json");
  }
  return { base: endpoint.replace(/\/?$/, "/"), apiKey, model };
}

async function soraFetch(path: string, init?: RequestInit): Promise<Response> {
  const { base, apiKey } = soraConfig();
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${base}openai/v1/${path}${sep}api-version=${API_VERSION}`, {
    ...init,
    headers: { "api-key": apiKey, "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    throw new Error(`Sora API ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res;
}

export async function createSoraVideo(prompt: string, size = "1280x720", seconds = 4): Promise<string> {
  const { model } = soraConfig();
  const res = await soraFetch("videos", {
    method: "POST",
    body: JSON.stringify({ model, prompt, size, seconds: String(seconds) }),
  });
  const job = (await res.json()) as SoraJob;
  if (!job.id) throw new Error("Sora returned no job id");
  return job.id;
}

export async function getSoraJob(id: string): Promise<SoraJob> {
  const res = await soraFetch(`videos/${id}`);
  return (await res.json()) as SoraJob;
}

/** Download the finished MP4 (call once status is "completed"). */
export async function downloadSoraVideo(id: string): Promise<Buffer> {
  const res = await soraFetch(`videos/${id}/content`);
  return Buffer.from(await res.arrayBuffer());
}
