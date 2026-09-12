import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  /**
   * The session callback in `src/server/auth.ts` copies the user id across.
   * Without this the id is invisible to the type system and every caller
   * casts.
   */
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
