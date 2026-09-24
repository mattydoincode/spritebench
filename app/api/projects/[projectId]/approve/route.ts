import { NextResponse } from "next/server";
import { ApproveError, approveAsset } from "@/server/approve";
import { projectContext } from "@/server/access";
import { approveBodySchema, parseBody, withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

/**
 * Renders an asset at its current settings and files the PNG under an export
 * key, with a sidecar recording how it was made.
 */
export async function POST(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "edit");
    const body = await parseBody(request, approveBodySchema);

    try {
      const exported = await approveAsset(projectId, body.assetId, {
        name: body.name,
        subfolder: body.subfolder
      });

      return NextResponse.json({
        asset: exported.asset,
        exported: { path: exported.path, width: exported.width, height: exported.height }
      });
    } catch (error) {
      if (error instanceof ApproveError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  });
}
