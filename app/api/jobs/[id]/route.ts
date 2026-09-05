import { NextResponse } from "next/server";
import { cancelJob } from "@/server/queue";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cancelled = cancelJob(id);

  if (!cancelled) {
    return NextResponse.json({ error: "only queued jobs can be cancelled" }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
