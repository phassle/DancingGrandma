import "server-only";
import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";

/**
 * Blob storage for generated videos. The apphost passes the `videos`
 * container connection as ConnectionStrings__videos — an Azurite
 * account-key connection string locally, a plain service URI (managed
 * identity) in the cloud. Both end with a ContainerName segment.
 */

let container: ContainerClient | undefined;

export function getVideosContainer(): ContainerClient {
  if (container) return container;
  const raw = process.env.ConnectionStrings__videos;
  if (!raw) {
    throw new Error("ConnectionStrings__videos is not set — run the app via `aspire run`");
  }

  // Split off ContainerName=...; the rest is the service connection.
  let containerName = "videos";
  const parts = raw.split(";").filter((p) => {
    const [k, v] = [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)];
    if (k.trim().toLowerCase() === "containername") {
      containerName = v.trim();
      return false;
    }
    return Boolean(p.trim());
  });
  const service = parts.join(";");

  const client = service.includes("=")
    ? BlobServiceClient.fromConnectionString(service)
    : new BlobServiceClient(service, new DefaultAzureCredential());
  container = client.getContainerClient(containerName);
  return container;
}

/**
 * Copy a provider-hosted video (fal/Sora URLs expire) into durable storage.
 * Returns the blob path recorded on the generation row.
 */
export async function saveVideoFromUrl(videoId: string, url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetching video failed: ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  return saveVideoBytes(videoId, bytes);
}

export async function saveVideoBytes(videoId: string, bytes: Buffer): Promise<string> {
  const blobPath = `${videoId}.mp4`;
  await getVideosContainer()
    .getBlockBlobClient(blobPath)
    .uploadData(bytes, { blobHTTPHeaders: { blobContentType: "video/mp4" } });
  return blobPath;
}

export async function readVideoBytes(blobPath: string): Promise<Buffer> {
  // Callers decide how to map storage failures (missing blob vs transient error).
  return getVideosContainer().getBlockBlobClient(blobPath).downloadToBuffer();
}

/** Remove a stored video, e.g. when its owner deletes it from their library. */
export async function deleteVideoBlob(blobPath: string): Promise<void> {
  await getVideosContainer().getBlockBlobClient(blobPath).deleteIfExists();
}
