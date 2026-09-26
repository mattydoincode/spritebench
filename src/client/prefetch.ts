"use client";

import { useEffect, useRef } from "react";
import { isProcessCancelled, PROCESS_PRIORITY, processor } from "@/client/processor";
import { useAssets } from "@/client/stores/assets";
import { EMPTY_PALETTE, useServer } from "@/client/stores/server";
import type { ResolvedAsset } from "@/shared/model";
import { takeNewArrivals } from "@/shared/prefetch";

async function warm(projectId: string, asset: ResolvedAsset): Promise<void> {
  const paletteId = asset.processing.paletteId;
  const palette = paletteId
    ? await useServer.getState().ensurePalette(paletteId)
    : EMPTY_PALETTE;

  // Same key the inspector asks for (full source, source bitmap included), so
  // opening the asset later is a cache hit or an upgrade of this very job.
  await processor.process(
    projectId,
    asset.id,
    asset.processing,
    palette,
    true,
    "source",
    { width: asset.sourceWidth, height: asset.sourceHeight },
    PROCESS_PRIORITY.prefetch
  );
}

/**
 * Processes images as they come back from a prompt instead of on first
 * click. Assets already in the project when it opens are left alone.
 */
export function usePrefetchNewAssets(): void {
  const projectId = useServer((state) => state.project?.id ?? null);
  const ready = useServer((state) => state.ready);
  const assets = useAssets();
  const seen = useRef<{ projectId: string | null; ids: Set<string> } | null>(null);

  useEffect(() => {
    if (!projectId || !ready) return;

    if (!seen.current || seen.current.projectId !== projectId) {
      seen.current = { projectId, ids: new Set(assets.map((asset) => asset.id)) };
      return;
    }

    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    for (const id of takeNewArrivals(seen.current.ids, assets)) {
      const asset = byId.get(id);
      if (!asset) continue;
      warm(projectId, asset).catch((error: unknown) => {
        if (!isProcessCancelled(error)) console.warn("prefetch failed", id, error);
      });
    }
  }, [projectId, ready, assets]);
}
