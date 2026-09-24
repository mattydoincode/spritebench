import { NextResponse } from "next/server";
import { revokeApiToken } from "@/db/repo/apiTokens";
import { requireUser } from "@/server/session";
import { withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params) {
  return withValidation(async () => {
    const userId = await requireUser();
    const { id } = await params;
    const revoked = await revokeApiToken(userId, id);

    if (!revoked) return NextResponse.json({ error: "token not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  });
}
