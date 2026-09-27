import { compactDoc, projectsNeedingCompaction } from "@/db/repo/projectDoc";

/**
 * How many pending updates make a document worth compacting. Low enough that
 * a busy project does not accumulate a long replay, high enough that a quiet
 * one is never rewritten for the sake of three edits.
 */
const COMPACT_THRESHOLD = 200;

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
