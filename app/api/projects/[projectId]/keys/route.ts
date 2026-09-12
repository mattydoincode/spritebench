import { NextResponse } from "next/server";
import { listProjectKeyOptions } from "@/db/repo/providerKeys";
import { projectContext } from "@/server/access";
import { withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

/**
 * The keys this project can bill: the owner's.
 *
 * Gated on `generate` rather than `own`, because this is the dropdown a
 * collaborator picks from. They see a label, a provider and four characters --
 * enough to choose between "personal" and "studio", and not enough to use
 * either anywhere else. Which one a generation actually billed is fixed on the
 * job row at enqueue.
 */
export async function GET(_request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "generate");
    return NextResponse.json({ keys: await listProjectKeyOptions(projectId) });
  });
}
