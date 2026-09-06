import { clearSource, listExpiredSources } from "@/db/repo/assets";
import { assetRetentionDays } from "@/server/config";
import { storage } from "@/storage";

const BATCH = 500;

/**
 * Deletes full-resolution sources past their retention window, keeping the
 * asset row and its thumbnail.
 *
 * The user keeps their library, prompts, and previews; what they lose is the
 * ability to re-process the original. Deleting the row instead would be
 * simpler but would destroy their history, and storage is the only cost that
 * compounds with a free tier.
 */
export async function pruneExpiredSources(): Promise<number> {
  const expired = await listExpiredSources(BATCH);
  let pruned = 0;

  for (const asset of expired) {
    try {
      await storage().delete(asset.sourceKey);
      // Only clear the key once the object is actually gone, so a failure
      // leaves the row pointing at bytes that still exist.
      await clearSource(asset.id);
      pruned++;
    } catch (error) {
      console.error(`[prune] could not roll off ${asset.sourceKey}`, error);
    }
  }

  if (expired.length === BATCH) {
    console.log(
      `[prune] hit the ${BATCH} batch limit after ${assetRetentionDays()} day retention; more remain for the next run`
    );
  }

  return pruned;
}
