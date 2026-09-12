import { NextResponse } from "next/server";
import { readSettings } from "@/db/repo/users";
import { projectContext } from "@/server/access";
import { deleteTemplate, listTemplates, saveTemplate } from "@/server/templates";
import { withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "view");
    return NextResponse.json({ templates: await listTemplates(projectId) });
  });
}

export async function POST(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId, userId } = await projectContext(params, "edit");

    const form = await request.formData();
    const upload = form.get("image");
    const cutBackground = form.get("cutBackground") !== "false";

    if (!(upload instanceof File)) {
      return NextResponse.json({ error: "no image supplied" }, { status: 400 });
    }

    // The cut tolerance is the uploader's preference, not the project's.
    const settings = await readSettings(userId);

    try {
      const template = await saveTemplate(
        projectId,
        upload.name || "template.png",
        new Uint8Array(await upload.arrayBuffer()),
        cutBackground,
        settings.templateCutTolerance
      );

      return NextResponse.json({ template });
    } catch {
      return NextResponse.json(
        { error: "template must be a PNG. Re-copy the image or paste a screenshot." },
        { status: 400 }
      );
    }
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "edit");
    const id = new URL(request.url).searchParams.get("id");

    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    await deleteTemplate(projectId, id);
    return NextResponse.json({ ok: true });
  });
}
