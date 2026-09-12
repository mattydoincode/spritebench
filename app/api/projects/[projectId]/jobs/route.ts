import { NextResponse } from "next/server";
import { clearFinishedJobs, listJobs } from "@/db/repo/jobs";
import { projectContext } from "@/server/access";
import { withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "view");
    return NextResponse.json({ jobs: await listJobs(projectId) });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "edit");
    await clearFinishedJobs(projectId);

    return NextResponse.json({ jobs: await listJobs(projectId) });
  });
}
