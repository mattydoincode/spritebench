import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { ensureBootstrap } from "@/db/repo/users";

/**
 * Sign-in. Google is the only provider wired up, but nothing here is
 * Google-specific past the one entry in `providers` -- adding GitHub or email
 * magic links is a second entry plus its credentials in `.env`.
 *
 * Database sessions rather than JWTs. A JWT would save a query per request,
 * but it also means a revoked account keeps working until its token expires,
 * and every request that touches a project hits the database anyway.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens
  }),
  session: { strategy: "database" },
  providers: [
    Google({
      // Google refuses to re-issue a refresh token on a repeat consent unless
      // asked, and we need one to keep the account linked over time.
      authorization: {
        params: { prompt: "consent", access_type: "offline", response_type: "code" }
      }
    })
  ],
  pages: { signIn: "/sign-in" },
  events: {
    /**
     * Fires after the adapter has written the row, so this is the first point
     * where the id is ours rather than Google's. Deliberately an event and
     * not the `signIn` callback: that callback is the authorization gate and
     * runs before the user exists, so bootstrapping there fails the foreign
     * key and surfaces as `AccessDenied`.
     *
     * An event cannot refuse a sign-in, which is the right trade. If this
     * throws, the account still works and `GET /api/projects` fills in what
     * is missing on the next request.
     */
    async createUser({ user }) {
      if (user.id) await ensureBootstrap(user.id);
    }
  },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    }
  }
});
