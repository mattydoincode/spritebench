import type { ProjectRole } from "@/db/schema";

/**
 * The authorization policy, on its own.
 *
 * Kept apart from `access.ts` because that module reaches for the session and
 * the database, which drags the whole auth stack into anything that only
 * wants to ask "may an editor generate?" -- including the tests that check
 * this table exhaustively.
 */

/**
 * What a member is allowed to do.
 *
 * `generate` is separate from `edit` because generation spends the owner's
 * money: someone you trust to rearrange the scene is not necessarily
 * someone you trust with your OpenAI bill.
 *
 * `own` covers the things only the owner may do -- change which key the
 * project bills, invite people, delete the project.
 */
export type Capability = "view" | "edit" | "generate" | "own";

export interface Membership {
  projectId: string;
  userId: string;
  role: ProjectRole;
  canGenerate: boolean;
  /**
   * Read off the project row rather than inferred from `role`, so a
   * transferred project cannot leave two members both believing they own it.
   */
  isOwner: boolean;
}

export function permits(membership: Membership, capability: Capability): boolean {
  switch (capability) {
    case "view":
      return true;
    case "edit":
      return membership.role !== "viewer";
    case "generate":
      return membership.role !== "viewer" && (membership.isOwner || membership.canGenerate);
    case "own":
      return membership.isOwner;
  }
}
