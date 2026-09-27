import { NextResponse } from "next/server";
import { removeMember, setMemberAccess } from "@/db/repo/members";
import { projectContext } from "@/server/access";
import { memberAccessSchema, parseBody, withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string; userId: string }> };

/** Owner only: change what a collaborator may do. */
export async function PATCH(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "own");
    const { userId } = await params;
    const body = await parseBody(request, memberAccessSchema);

    await setMemberAccess(projectId, userId, body);
    return NextResponse.json({ ok: true });
  });
}

/** The owner removes someone, or a collaborator leaves. The owner cannot be removed. */
export async function DELETE(_request: Request, { params }: Params) {
  return withValidation(async () => {
    const membership = await projectContext(params, "view");
    const { userId } = await params;

    if (!membership.isOwner && membership.userId !== userId) {
      return NextResponse.json({ error: "only the owner can remove other people" }, { status: 403 });
    }

    await removeMember(membership.projectId, userId);
    return NextResponse.json({ ok: true });
  });
}
