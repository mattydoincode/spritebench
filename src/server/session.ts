import { auth } from "./auth";

export { ForbiddenError, UnauthorizedError } from "./errors";
import { UnauthorizedError } from "./errors";

/**
 * The signed-in user's id, or a 401.
 *
 * Deliberately not cached. The module-global cache this replaced was correct
 * only while the app had exactly one user; in a server that handles two
 * requests it hands the second caller the first caller's library.
 */
export async function requireUser(): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new UnauthorizedError();

  return userId;
}

/** The signed-in user's id, or null. For routes that serve both states. */
export async function optionalUser(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}
