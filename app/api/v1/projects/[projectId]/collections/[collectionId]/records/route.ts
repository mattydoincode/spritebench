import { NextResponse } from "next/server";
import {
  CollectionError,
  createEngineRecord,
  listEngineCollections
} from "@/db/repo/engineCollections";
import { v1ProjectContext } from "@/server/v1";
import { parseBody, recordCreateBodySchema, withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ projectId: string; collectionId: string }> };

export async function POST(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await v1ProjectContext(request, params, "edit");
    const { collectionId } = await params;
    const body = await parseBody(request, recordCreateBodySchema);

    try {
      const id = await createEngineRecord(projectId, collectionId, body.key);
      return NextResponse.json({ id, collections: await listEngineCollections(projectId) });
    } catch (error) {
      if (error instanceof CollectionError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  });
}
