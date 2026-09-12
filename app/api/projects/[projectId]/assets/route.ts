import { NextResponse } from "next/server";
import { listAssets } from "@/db/repo/assets";
import { projectContext } from "@/server/access";
import { withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "view");
    return NextResponse.json({ assets: await listAssets(projectId) });
  });
}
