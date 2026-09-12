import { NextResponse } from "next/server";
import { cancelBlockedInBatch, cancelJob, getJobRow } from "@/db/repo/jobs";
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
    if (!(await cancelJob(projectId, id))) {
      return NextResponse.json({ error: "only queued or blocked jobs can be cancelled" }, { status: 409 });
    }

    if (job?.batchId && isLoopSpec(job.inputs?.loop)) {
      await cancelBlockedInBatch(projectId, job.batchId);
    }

    return NextResponse.json({ ok: true });
  });
}
