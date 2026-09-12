import { NextResponse } from "next/server";
import { renameProject, softDeleteProject } from "@/db/repo/projects";
import { projectContext } from "@/server/access";
import { parseBody, projectBodySchema, withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "own");
    const body = await parseBody(request, projectBodySchema);

    await renameProject(projectId, body.name);
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "own");

    // Soft delete: membership, assets and the document all stay, so an
    // accidental delete is recoverable and a support request is a one-line
    // update rather than an archaeology project.
    await softDeleteProject(projectId);
    return NextResponse.json({ ok: true });
  });
}
