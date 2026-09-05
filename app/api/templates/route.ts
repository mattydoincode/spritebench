import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { cut } from "@/core/cutout";
import { hexToRgb } from "@/core/pixels";
import { readSettings, sanitizeName, serialize, timestamp } from "@/server/library";
import { ensureFolders, paths } from "@/server/paths";
import { decodePng, encodePng } from "@/server/png";

export const dynamic = "force-dynamic";

export async function GET() {
  ensureFolders();

  const files = fs
    .readdirSync(paths.templates)
    .filter((file) => file.toLowerCase().endsWith(".png") && !file.startsWith("_edit_"))
    .sort()
    .reverse();

  const templates = files.map((file) => {
    const decoded = decodePng(fs.readFileSync(path.join(paths.templates, file)));
    return { file, width: decoded.width, height: decoded.height };
  });

  return NextResponse.json({ templates });
}

export async function POST(request: Request) {
  ensureFolders();

  const form = await request.formData();
  const upload = form.get("image");
  const cutBackground = form.get("cutBackground") !== "false";

  if (!(upload instanceof File)) {
    return NextResponse.json({ error: "no image supplied" }, { status: 400 });
  }

  const settings = await serialize(() => readSettings());
  const bytes = Buffer.from(await upload.arrayBuffer());

  let decoded;
  try {
    decoded = decodePng(bytes);
  } catch {
    return NextResponse.json(
      { error: "template must be a PNG. Re-copy the image or paste a screenshot." },
      { status: 400 }
    );
  }

  if (cutBackground) {
    decoded = cut(
      decoded,
      "edgeFloodFill",
      hexToRgb("#ffffff"),
      settings.templateCutTolerance,
      settings.templateCutTolerance,
      0.85,
      false
    );
  }

  const filename = `${sanitizeName(settings.assetSlug, "prop")}_template_${timestamp()}.png`;
  fs.writeFileSync(path.join(paths.templates, filename), encodePng(decoded));

  return NextResponse.json({
    template: { file: filename, width: decoded.width, height: decoded.height }
  });
}

export async function DELETE(request: Request) {
  const file = new URL(request.url).searchParams.get("file");
  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });

  const target = path.join(paths.templates, path.basename(file));
  if (fs.existsSync(target)) fs.unlinkSync(target);

  return NextResponse.json({ ok: true });
}
