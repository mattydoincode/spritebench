import { NextResponse } from "next/server";
import { clearFinishedJobs, listJobs } from "@/db/repo/jobs";
import { currentUserId } from "@/db/repo/users";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await currentUserId();
  return NextResponse.json({ jobs: await listJobs(userId) });
}

export async function DELETE() {
  const userId = await currentUserId();
  await clearFinishedJobs(userId);

  return NextResponse.json({ jobs: await listJobs(userId) });
}
