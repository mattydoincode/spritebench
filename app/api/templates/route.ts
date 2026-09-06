import { NextResponse } from "next/server";
import { currentUserId, readSettings } from "@/db/repo/users";
import { sanitizeName, timestamp } from "@/server/naming";
import { deleteTemplate, listTemplates, saveTemplate } from "@/server/templates";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await currentUserId();
  return NextResponse.json({ templates: await listTemplates(userId) });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const upload = form.get("image");
  const cutBackground = form.get("cutBackground") !== "false";

  if (!(upload instanceof File)) {
    return NextResponse.json({ error: "no image supplied" }, { status: 400 });
  }

  const userId = await currentUserId();
  const settings = await readSettings(userId);
  const filename = `${sanitizeName(settings.assetSlug, "prop")}_template_${timestamp()}.png`;

  try {
    const template = await saveTemplate(
      userId,
      filename,
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
}

export async function DELETE(request: Request) {
  const file = new URL(request.url).searchParams.get("file");
  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });

  await deleteTemplate(await currentUserId(), file);
  return NextResponse.json({ ok: true });
}
