import { readDoc } from "@/db/repo/projectDoc";
import { docFromState, readProjectSettings } from "@/shared/doc";
import type { ProjectSettings } from "@/shared/projectSettings";

export async function loadProjectSettings(projectId: string): Promise<ProjectSettings> {
  const snapshot = await readDoc(projectId);
  return readProjectSettings(docFromState(snapshot.state));
}
