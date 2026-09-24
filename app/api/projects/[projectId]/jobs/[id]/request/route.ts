import { NextResponse } from "next/server";
import { getJob } from "@/db/repo/jobs";
import { projectContext } from "@/server/access";
import { requestPartResponse } from "@/server/requestParts";
import { withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string; id: string }> };

/**
 * What this job sent (or will send): prompt parts plus any
 * reference / mask / layout-guide images, reconstructed from stored inputs.
 */
export async function GET(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "view");
    const { id } = await params;
    const job = await getJob(projectId, id);
    if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });

    return requestPartResponse(projectId, job, new URL(request.url).searchParams.get("part"));
  });
}
