import type { ProviderKeyStatus } from "@/db/repo/providerKeys";
import type { ProjectSummary, StudioSettings } from "./model";

/**
 * What the project page resolves on the server before it sends the studio,
 * so the first paint already knows the project's name, your role, and whether
 * there is a key -- none of which should wait on a client round trip.
 *
 * The rows (assets, jobs, slots) are not in here. They are large, and the
 * studio shows skeletons for them; the point is the chrome, not the data.
 */
export interface StudioBootstrap {
  project: ProjectSummary;
  /** The keys this project can bill. Empty when you may not generate in it. */
  projectKeys: ProviderKeyStatus[];
  /** Provider id → key id this project bills, when it overrides the owner's default. */
  keyDefaults: Record<string, string>;
  /** Your own settings and keys, as `/api/settings` returns them. */
  settings: StudioSettings;
  providerKeys: ProviderKeyStatus[];
}
