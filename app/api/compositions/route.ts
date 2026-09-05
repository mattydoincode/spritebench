import { NextResponse } from "next/server";
import { deleteComposition, readCompositions, serialize, writeComposition } from "@/server/library";
import type { Composition } from "@/shared/model";

export const dynamic = "force-dynamic";

export async function GET() {
  const compositions = await serialize(() => readCompositions());
  return NextResponse.json({ compositions });
}

export async function PUT(request: Request) {
  const body = (await request.json()) as Composition;

  if (!body.id) return NextResponse.json({ error: "composition id required" }, { status: 400 });

  const saved = await serialize(() =>
    writeComposition({ ...body, updatedAt: new Date().toISOString() })
  );

  return NextResponse.json({ composition: saved });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "composition id required" }, { status: 400 });

  await serialize(() => deleteComposition(id));
  return NextResponse.json({ ok: true });
}
