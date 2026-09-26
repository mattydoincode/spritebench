import { NextResponse } from "next/server";
import { setProjectKeyDefault } from "@/db/repo/projects";
import { listProjectKeyOptions } from "@/db/repo/providerKeys";
import { projectContext } from "@/server/access";
import { keyDefaultBodySchema, parseBody, withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string }> };

/**
 * Which of the owner's keys this project bills for one provider. Owner only:
 * the keys are theirs, and so is the bill.
 */
export async function PUT(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await projectContext(params, "own");
    const body = await parseBody(request, keyDefaultBodySchema);

    if (body.keyId) {
      const options = await listProjectKeyOptions(projectId, body.provider);
      if (!options.some((option) => option.id === body.keyId)) {
        return NextResponse.json(
          { error: `that is not one of your ${body.provider} keys` },
          { status: 400 }
        );
      }
    }

    const keyDefaults = await setProjectKeyDefault(projectId, body.provider, body.keyId);
    return NextResponse.json({ keyDefaults });
  });
}
