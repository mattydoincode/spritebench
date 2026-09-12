import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/db/repo/projects";
import { ensureBootstrap } from "@/db/repo/users";
import { requireUser } from "@/server/session";
import { parseBody, projectBodySchema, withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

/**
 * Bootstraps before listing rather than trusting sign-in to have done it. The
 * client needs at least one project to have anywhere to render, and an
 * account that reaches this route with none -- because the `createUser` event
 * failed, or because the row was made some other way -- would otherwise land
 * on an empty screen with no way out.
 */
export async function GET() {
  return withValidation(async () => {
    const userId = await requireUser();
    await ensureBootstrap(userId);

    return NextResponse.json({ projects: await listProjects(userId) });
  });
}

export async function POST(request: Request) {
  return withValidation(async () => {
    const userId = await requireUser();
    const body = await parseBody(request, projectBodySchema);
    const project = await createProject(userId, body.name);

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        role: "owner",
        canGenerate: true,
        isOwner: true,
        createdAt: project.createdAt.toISOString()
      }
    });
  });
}
