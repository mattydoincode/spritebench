import { NextResponse } from "next/server";
import { listProjects } from "@/db/repo/projects";
import { requireV1User } from "@/server/v1";
import { withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withValidation(async () => {
    const userId = await requireV1User(request);
    return NextResponse.json({ projects: await listProjects(userId) });
  });
}
