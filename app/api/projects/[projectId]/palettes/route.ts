import { NextResponse } from "next/server";
import { projectContext } from "@/server/access";
import { deletePalette, listPalettes, loadPalette, savePalette } from "@/server/palettes";
import { withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "view");
    const requested = new URL(request.url).searchParams.get("id");

    if (requested) {
      return NextResponse.json({
        id: requested,
        colors: await loadPalette(projectId, requested)
      });
    }

    return NextResponse.json({ palettes: await listPalettes(projectId) });
  });
}

export async function POST(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "edit");

    const form = await request.formData();
    const uploads = form.getAll("palette").filter((entry): entry is File => entry instanceof File);

    if (uploads.length === 0) {
      return NextResponse.json({ error: "no palette files supplied" }, { status: 400 });
    }

    const added: string[] = [];
    const failed: string[] = [];

    for (const upload of uploads) {
      try {
        const saved = await savePalette(
          projectId,
          upload.name,
          new Uint8Array(await upload.arrayBuffer())
        );
        added.push(saved.id);
      } catch (error) {
        failed.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (added.length === 0) {
      return NextResponse.json({ error: failed.join("; ") }, { status: 400 });
    }

    return NextResponse.json({ added, failed, palettes: await listPalettes(projectId) });
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "edit");
    const id = new URL(request.url).searchParams.get("id");

    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    await deletePalette(projectId, id);
    return NextResponse.json({ palettes: await listPalettes(projectId) });
  });
}
