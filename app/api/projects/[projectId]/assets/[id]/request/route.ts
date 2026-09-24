import { NextResponse } from "next/server";
import { getAsset } from "@/db/repo/assets";
import { projectContext } from "@/server/access";
import { requestPartResponse } from "@/server/requestParts";
import { withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string; id: string }> };

/**
 * What this asset's generation actually sent: prompt parts plus any
 * reference / mask / layout-guide images, reconstructed from the stored
 * inputs or sheet plan.
 */
export async function GET(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "view");
    const { id } = await params;
    const asset = await getAsset(projectId, id);
    if (!asset) return NextResponse.json({ error: "asset not found" }, { status: 404 });

    return requestPartResponse(projectId, asset, new URL(request.url).searchParams.get("part"));
  });
}
