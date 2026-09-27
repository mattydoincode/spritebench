import { NextResponse } from "next/server";
import { createShareLink } from "@/db/repo/members";
import { projectContext } from "@/server/access";
import { memberAccessSchema, parseBody, withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

/** Owner only: a link anyone signed in can use to join with this access, for a week. */
export async function POST(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId, userId } = await projectContext(params, "own");
    const body = await parseBody(request, memberAccessSchema);

    return NextResponse.json({ link: await createShareLink(projectId, userId, body) });
  });
}
