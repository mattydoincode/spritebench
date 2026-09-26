import { getProjectKeyDefaults, getProjectSummary } from "@/db/repo/projects";
import { listProjectKeyOptions, listProviderKeys } from "@/db/repo/providerKeys";
import { readSettings } from "@/db/repo/users";
import type { StudioBootstrap } from "@/shared/studioBootstrap";
import { optionalUser } from "./session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Everything the studio's chrome needs for one project, or null when the
 * caller cannot open it: not signed in, not a member, no such project, or an
 * id that is not even a uuid. All four read the same to the caller.
 *
 * Membership is checked by `getProjectSummary` against the session, exactly
 * as `requireMember` does for the API; nothing here trusts the URL.
 */
export async function loadStudioBootstrap(projectId: string): Promise<StudioBootstrap | null> {
  if (!UUID.test(projectId)) return null;

  const userId = await optionalUser();
  if (!userId) return null;

  const project = await getProjectSummary(userId, projectId);
  if (!project) return null;

  const mayBill = project.isOwner || project.canGenerate;

  const [projectKeys, keyDefaults, settings, providerKeys] = await Promise.all([
    mayBill ? listProjectKeyOptions(projectId) : Promise.resolve([]),
    getProjectKeyDefaults(projectId),
    readSettings(userId),
    listProviderKeys(userId)
  ]);

  return { project, projectKeys, keyDefaults, settings, providerKeys };
}
