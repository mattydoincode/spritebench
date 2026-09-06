import { NextResponse } from "next/server";
import { currentUserId } from "@/db/repo/users";
import { deletePalette, listPalettes, loadPalette, savePalette } from "@/server/palettes";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("file");
  const userId = await currentUserId();

  if (requested) {
    return NextResponse.json({ file: requested, colors: await loadPalette(userId, requested) });
  }

  return NextResponse.json({ palettes: await listPalettes(userId) });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const uploads = form.getAll("palette").filter((entry): entry is File => entry instanceof File);

  if (uploads.length === 0) {
    return NextResponse.json({ error: "no palette files supplied" }, { status: 400 });
  }

  const userId = await currentUserId();
  const added: string[] = [];
  const failed: string[] = [];

  for (const upload of uploads) {
    try {
      const saved = await savePalette(
        userId,
        upload.name,
        new Uint8Array(await upload.arrayBuffer())
      );
      added.push(saved.file);
    } catch (error) {
      failed.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (added.length === 0) {
    return NextResponse.json({ error: failed.join("; ") }, { status: 400 });
  }

  return NextResponse.json({ added, failed, palettes: await listPalettes(userId) });
}

export async function DELETE(request: Request) {
  const file = new URL(request.url).searchParams.get("file");
  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });

  const userId = await currentUserId();
  await deletePalette(userId, file);

  return NextResponse.json({ palettes: await listPalettes(userId) });
}
