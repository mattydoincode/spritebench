import { clearSource, listExpiredSources } from "@/db/repo/assets";
import { compactDoc, projectsNeedingCompaction } from "@/db/repo/projectDoc";
import { assetRetentionDays } from "@/server/config";
import { storage } from "@/storage";

const BATCH = 500;

/**
 * How many pending updates make a document worth compacting. Low enough that
 * a busy project does not accumulate a long replay, high enough that a quiet
 * one is never rewritten for the sake of three edits.
 */
const COMPACT_THRESHOLD = 200;

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

/**
 * Folds each busy project's update log into its compacted state.
 *
 * Without this the log grows without bound and every cold page load replays
 * the project's entire edit history. Runs on the same nightly cron as the
 * source roll-off rather than inline on a request, because compaction rewrites
 * the whole document and nobody should wait for it.
 */
export async function compactProjectDocs(): Promise<number> {
  const projectIds = await projectsNeedingCompaction(COMPACT_THRESHOLD);
  let compacted = 0;

  for (const projectId of projectIds) {
    try {
      const { folded } = await compactDoc(projectId);
      if (folded > 0) compacted++;
    } catch (error) {
      console.error(`[prune] could not compact the document for project ${projectId}`, error);
    }
  }

  return compacted;
}
