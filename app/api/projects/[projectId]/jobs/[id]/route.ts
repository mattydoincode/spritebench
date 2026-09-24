import { NextResponse } from "next/server";
import { cancelBlockedInBatch, cancelJob, deleteFailedJob, getJobRow } from "@/db/repo/jobs";
import { projectContext } from "@/server/access";
import { isLoopSpec } from "@/shared/model";
import { withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string; id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "edit");
    const { id } = await params;

    const job = await getJobRow(id);
    if (!job || job.projectId !== projectId) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    if (job.status === "queued" || job.status === "blocked") {
      await cancelJob(projectId, id);

      if (job.batchId && isLoopSpec(job.inputs?.loop)) {
        await cancelBlockedInBatch(projectId, job.batchId);
      }

      return NextResponse.json({ ok: true });
    }

    if (job.status === "error" || job.status === "cancelled") {
      await deleteFailedJob(projectId, id);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { error: "only queued, blocked, failed, or cancelled jobs can be removed" },
      { status: 409 }
    );
  });
}
