import "server-only";
import { deleteBlob } from "./blob";
import {
  expireStaleCredits,
  markMediaAssetPurged,
  unpurgedSourcePhotoAssets,
  unpurgedTerminalSourcePhotoAssets,
  type MediaAsset,
} from "./db";

/**
 * Retention and expiration policies (PRD #54, issue #60).
 *
 * Source photos are personal data: their blob bytes are deleted the moment
 * a generation reaches a terminal state, keeping only the media record's
 * hash and metadata. Purging is event-driven (called after capture/release)
 * with the periodic sweep as the safety net for anything left behind, e.g.
 * when a blob delete failed at transition time.
 */

async function purgeAssets(assets: MediaAsset[]): Promise<number> {
  let purged = 0;
  for (const asset of assets) {
    try {
      if (asset.blob_path) await deleteBlob(asset.blob_path);
      await markMediaAssetPurged(asset.id);
      purged++;
    } catch {
      // Leave the asset unpurged; the retention sweep retries it later.
    }
  }
  return purged;
}

/** Delete the source-photo bytes of one (terminal) generation. Idempotent. */
export async function purgeSourcePhotos(generationId: string): Promise<number> {
  return purgeAssets(await unpurgedSourcePhotoAssets(generationId));
}

/**
 * The periodic maintenance sweep: expire unused credits of 90+ day inactive
 * users (explicit credit_expiration ledger entries; reserved balances are
 * never touched) and purge source photos left behind on terminal runs.
 */
export async function runRetentionSweep(): Promise<{
  expiredWallets: number;
  expiredCredits: number;
  purgedPhotos: number;
}> {
  const { expiredWallets, expiredCredits } = await expireStaleCredits();
  const purgedPhotos = await purgeAssets(await unpurgedTerminalSourcePhotoAssets());
  return { expiredWallets, expiredCredits, purgedPhotos };
}
