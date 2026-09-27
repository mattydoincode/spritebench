import { NextResponse } from "next/server";
import { revokeShareLink } from "@/db/repo/members";
import { projectContext } from "@/server/access";
import { withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string; linkId: string }> };

/** Owner only: turn a link off. People who already joined stay. */
export async function DELETE(_request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "own");
    const { linkId } = await params;

    await revokeShareLink(projectId, linkId);
    return NextResponse.json({ ok: true });
  });
}
