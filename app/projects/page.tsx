import { PageShell } from "@/client/components/AppHeader";
import { ProjectsDashboard } from "@/client/components/ProjectsDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects — SpriteBench" };

export default function ProjectsPage() {
  return (
    <PageShell active="projects">
      <ProjectsDashboard />
    </PageShell>
  );
}
