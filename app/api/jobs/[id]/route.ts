import { NextResponse } from "next/server";
import { cancelJob } from "@/db/repo/jobs";
import { currentUserId } from "@/db/repo/users";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();

  if (!(await cancelJob(userId, id))) {
    return NextResponse.json({ error: "only queued jobs can be cancelled" }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
