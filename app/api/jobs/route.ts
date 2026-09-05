import { NextResponse } from "next/server";
import { clearFinishedJobs, listJobs } from "@/server/queue";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ jobs: listJobs() });
}

export async function DELETE() {
  clearFinishedJobs();
  return NextResponse.json({ jobs: listJobs() });
}
