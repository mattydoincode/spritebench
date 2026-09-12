import {
  cancelBlockedInBatch,
  findBlockedLoopStep,
  setQueueJobId,
  unblockJob
} from "@/db/repo/jobs";
import { dispatchJob } from "@/queue/dispatch";
import { loopFollowUp } from "@/shared/loop";
import type { JobInputs } from "@/shared/model";

export async function applyLoopFollowUp(
  projectId: string,
  batchId: string | null,
  inputs: JobInputs | null,
  outcome: { ok: true; assetId: string } | { ok: false }
): Promise<void> {
  const follow = loopFollowUp(inputs, batchId, outcome);
  if (follow.action === "none" || !batchId) return;

  if (follow.action === "cancel-rest") {
    await cancelBlockedInBatch(projectId, batchId);
    return;
  }

  const next = await findBlockedLoopStep(projectId, batchId, follow.index);
  if (!next) return;

  const unblocked = await unblockJob(next.id, {
    ...next.inputs,
    base: follow.inputs.base
  });
  if (!unblocked) return;

  const queueJobId = await dispatchJob(unblocked.id);
  if (queueJobId) await setQueueJobId(unblocked.id, queueJobId);
}
