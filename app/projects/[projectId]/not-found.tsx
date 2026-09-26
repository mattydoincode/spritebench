import Link from "next/link";

export default function ProjectNotFound() {
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-3 text-sm">
      <p className="text-slate-400">That project does not exist, or is not shared with you.</p>
      <Link href="/projects" className="text-[var(--color-accent)] hover:underline">
        back to your projects
      </Link>
    </main>
  );
}
