import { NextResponse } from "next/server";
import { listPalettes, loadPalette, savePalette } from "@/server/palettes";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("file");

  if (requested) {
    return NextResponse.json({ file: requested, colors: loadPalette(requested) });
  }

  return NextResponse.json({ palettes: listPalettes() });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const uploads = form.getAll("palette").filter((entry): entry is File => entry instanceof File);

  if (uploads.length === 0) {
    return NextResponse.json({ error: "no palette files supplied" }, { status: 400 });
  }

  const added: string[] = [];
  const failed: string[] = [];

  for (const upload of uploads) {
    try {
      const saved = savePalette(upload.name, Buffer.from(await upload.arrayBuffer()));
      added.push(saved.file);
    } catch (error) {
      failed.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (added.length === 0) {
    return NextResponse.json({ error: failed.join("; ") }, { status: 400 });
  }

  return NextResponse.json({ added, failed, palettes: listPalettes() });
}
