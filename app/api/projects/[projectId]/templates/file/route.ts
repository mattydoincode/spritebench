import { NextResponse } from "next/server";
import { buildAlphaVisualization } from "@/core/mask";
import {
  DEFAULT_PIXEL_WINDOW,
  PIXEL_CONSTRAINT_PREVIEW_SIZE,
  buildPixelConstraintTemplate,
  buildSheetPixelConstraintTemplate,
  isPixelConstraintTemplate
} from "@/core/pixelMask";
import { projectContext } from "@/server/access";
import { decodePng, encodePng } from "@/server/png";
import { loadTemplate } from "@/server/templates";
import { withValidation } from "@/server/validation";
import { asBytes } from "@/storage/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "view");

    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const alpha = url.searchParams.get("alpha") === "true";

    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const canvas = {
      width: Number(url.searchParams.get("cw")) || PIXEL_CONSTRAINT_PREVIEW_SIZE.width,
      height: Number(url.searchParams.get("ch")) || PIXEL_CONSTRAINT_PREVIEW_SIZE.height
    };
    const window = {
      width: Number(url.searchParams.get("ww")) || DEFAULT_PIXEL_WINDOW.width,
      height: Number(url.searchParams.get("wh")) || DEFAULT_PIXEL_WINDOW.height
    };
    const sheetColumns = Number(url.searchParams.get("sc"));
    const sheetRows = Number(url.searchParams.get("sr"));
    const sheet =
      Number.isFinite(sheetColumns) &&
      sheetColumns >= 1 &&
      Number.isFinite(sheetRows) &&
      sheetRows >= 1
        ? {
            columns: Math.min(32, Math.floor(sheetColumns)),
            rows: Math.min(32, Math.floor(sheetRows)),
            actions: (() => {
              const columns = Math.min(32, Math.floor(sheetColumns));
              const rows = Math.min(32, Math.floor(sheetRows));
              const used = (url.searchParams.get("used") ?? "")
                .split(",")
                .map((part) => Math.max(0, Math.min(32, Math.floor(Number(part) || 0))));
              return Array.from({ length: rows }, (_, index) => ({
                name: `row ${index + 1}`,
                frames: used[index] > 0 ? used[index] : columns
              }));
            })()
          }
        : null;

    const bytes = isPixelConstraintTemplate(id)
      ? asBytes(
          encodePng(
            sheet
              ? buildSheetPixelConstraintTemplate(canvas, window, sheet)
              : buildPixelConstraintTemplate(canvas, window)
          )
        )
      : await loadTemplate(projectId, id);
    if (!bytes) return NextResponse.json({ error: "template not found" }, { status: 404 });

    const payload = alpha
      ? asBytes(encodePng(buildAlphaVisualization(decodePng(Buffer.from(bytes)))))
      : bytes;

    return new NextResponse(payload, {
      headers: {
        "Content-Type": "image/png",
        // Keyed by id and never rewritten, so this could cache forever -- but
        // the alpha variant is computed per request and cheap to redo.
        "Cache-Control": "private, max-age=300"
      }
    });
  });
}
