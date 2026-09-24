import { NextResponse } from "next/server";
import { createApiToken, listApiTokens } from "@/db/repo/apiTokens";
import { requireUser } from "@/server/session";
import { apiTokenBodySchema, parseBody, withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  return withValidation(async () => {
    const userId = await requireUser();
    return NextResponse.json({ tokens: await listApiTokens(userId) });
  });
}

export async function POST(request: Request) {
  return withValidation(async () => {
    const userId = await requireUser();
    const body = await parseBody(request, apiTokenBodySchema);
    const created = await createApiToken(userId, body.name);

    return NextResponse.json({
      token: created.token,
      record: created.record
    });
  });
}
