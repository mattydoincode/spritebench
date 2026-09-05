"use client";

import { useEffect, useState } from "react";
import { GeneratePanel } from "@/client/components/GeneratePanel";
import { ImageEditModal } from "@/client/components/ImageEditModal";
import { InspectorPanel } from "@/client/components/InspectorPanel";
import { JobsBar } from "@/client/components/JobsBar";
import { LibraryPanel } from "@/client/components/LibraryPanel";
import { Playground } from "@/client/components/Playground";
import { ResizeHandle } from "@/client/components/ResizeHandle";
import { useStudio } from "@/client/store";

const LAYOUT_KEY = "art-studio.layout";

interface Layout {
  left: number;
  right: number;
  library: number;
}

const DEFAULT_LAYOUT: Layout = { left: 320, right: 330, library: 380 };

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export default function StudioPage() {
  const ready = useStudio((state) => state.ready);
  const jobs = useStudio((state) => state.jobs);
  const editingAssetId = useStudio((state) => state.editingAssetId);

  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT);

  useEffect(() => {
    const stored = window.localStorage.getItem(LAYOUT_KEY);
    if (!stored) return;

    try {
      setLayout({ ...DEFAULT_LAYOUT, ...(JSON.parse(stored) as Partial<Layout>) });
    } catch {
      window.localStorage.removeItem(LAYOUT_KEY);
    }
  }, []);

  const resize = (patch: Partial<Layout>) => {
    setLayout((previous) => {
      const next = {
        left: clamp(patch.left ?? previous.left, 200, 900),
        right: clamp(patch.right ?? previous.right, 200, 900),
        library: clamp(patch.library ?? previous.library, 60, 1600)
      };

      window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
      return next;
    });
  };

  useEffect(() => {
    void useStudio.getState().load();
  }, []);

  const hasActiveJobs = jobs.some((job) => job.status === "queued" || job.status === "running");

  useEffect(() => {
    const interval = setInterval(
      () => void useStudio.getState().refreshJobs(),
      hasActiveJobs ? 750 : 5000
    );

    return () => clearInterval(interval);
  }, [hasActiveJobs]);

  if (!ready) {
    return (
      <main className="flex h-screen items-center justify-center text-sm text-slate-500">
        loading studio...
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="flex shrink-0 flex-col" style={{ width: layout.left }}>
          <GeneratePanel />
        </div>

        <ResizeHandle
          orientation="vertical"
          onDrag={(delta) => resize({ left: layout.left + delta })}
          onReset={() => resize({ left: DEFAULT_LAYOUT.left })}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <Playground />

          <ResizeHandle
            orientation="horizontal"
            onDrag={(delta) => resize({ library: layout.library - delta })}
            onReset={() => resize({ library: DEFAULT_LAYOUT.library })}
          />

          <div className="min-h-0 shrink-0" style={{ height: layout.library }}>
            <LibraryPanel />
          </div>
        </div>

        <ResizeHandle
          orientation="vertical"
          onDrag={(delta) => resize({ right: layout.right - delta })}
          onReset={() => resize({ right: DEFAULT_LAYOUT.right })}
        />

        <div className="flex shrink-0 flex-col" style={{ width: layout.right }}>
          <InspectorPanel />
        </div>
      </div>

      <JobsBar />

      {editingAssetId ? <ImageEditModal /> : null}
    </main>
  );
}
