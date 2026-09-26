import { NextResponse } from "next/server";
import {
  CollectionError,
  deleteEngineRecord,
  listEngineCollections,
  renameEngineRecord
} from "@/db/repo/engineCollections";
import { v1ProjectContext } from "@/server/v1";
import { parseBody, recordPatchBodySchema, withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ projectId: string; collectionId: string; recordId: string }>;
};

async function collectionResponse(projectId: string, change: () => Promise<void>) {
  try {
    await change();
    return NextResponse.json({ collections: await listEngineCollections(projectId) });
  } catch (error) {
    if (error instanceof CollectionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function PATCH(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await v1ProjectContext(request, params, "edit");
    const { collectionId, recordId } = await params;
    const body = await parseBody(request, recordPatchBodySchema);
    return collectionResponse(projectId, () =>
      renameEngineRecord(projectId, collectionId, recordId, body.key)
    );
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return withValidation(async () => {
    const { projectId } = await v1ProjectContext(request, params, "edit");
    const { collectionId, recordId } = await params;
    return collectionResponse(projectId, () =>
      deleteEngineRecord(projectId, collectionId, recordId)
    );
  });
}
