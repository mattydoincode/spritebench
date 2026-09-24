import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireV1User } from "@/server/v1";
import { withValidation } from "@/server/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withValidation(async () => {
    const userId = await requireV1User(request);
    const [user] = await db()
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return NextResponse.json({ error: "sign in to continue" }, { status: 401 });

    return NextResponse.json({ user });
  });
}
