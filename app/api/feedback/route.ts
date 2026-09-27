import { NextResponse } from "next/server";
import { addFeedback } from "@/db/repo/feedback";
import { requireMember } from "@/server/access";
import { requireUser } from "@/server/session";
import { feedbackBodySchema, parseBody, withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

/** A bug report, piece of feedback or feature request from the studio. */
export async function POST(request: Request) {
  return withValidation(async () => {
    const userId = await requireUser();
    const body = await parseBody(request, feedbackBodySchema);

    // Recorded against a project only if the sender can see it, so the admin
    // list never names a project on someone's say-so.
    let projectId: string | null = null;
    if (body.projectId) {
      try {
        projectId = (await requireMember(userId, body.projectId)).projectId;
      } catch {
        projectId = null;
      }
    }

    await addFeedback(userId, projectId, body.body);
    return NextResponse.json({ ok: true });
  });
}
