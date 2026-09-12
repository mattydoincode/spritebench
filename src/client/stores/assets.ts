"use client";

import { useMemo } from "react";
import { attachSet, setByAssetId } from "@/shared/assetSet";
import { resolveAsset } from "@/shared/doc";
import type { Scene, ResolvedAsset } from "@/shared/model";
import { useDoc } from "./doc";
import { useServer } from "./server";
import { useUi } from "./ui";

/**
 * The seam between the two halves of an asset.
 *
 * Components want one object with a name, a folder and processing settings on
 * it. The server owns half of that and the shared document owns the other
 * half, and merging them here rather than in twelve components is what keeps
 * the split from leaking into the UI.
 */
function resolveAll(
  records: ReturnType<typeof useServer.getState>["assets"],
  edits: ReturnType<typeof useDoc.getState>["edits"],
  sets: ReturnType<typeof useDoc.getState>["sets"]
): ResolvedAsset[] {
  const sizes = Object.fromEntries(
    records.map((record) => [record.id, { width: record.sourceWidth, height: record.sourceHeight }])
  );

  return records.map((record) =>
    attachSet(
      resolveAsset(record, edits[record.id] ?? null),
      setByAssetId(sets, record.id),
      sizes
    )
  );
}

export function resolveAssetsNow(): ResolvedAsset[] {
  const records = useServer.getState().assets;
  const { edits, sets } = useDoc.getState();
  return resolveAll(records, edits, sets);
}

export function useAssets(): ResolvedAsset[] {
  const records = useServer((state) => state.assets);
  const edits = useDoc((state) => state.edits);
  const sets = useDoc((state) => state.sets);

  return useMemo(() => resolveAll(records, edits, sets), [records, edits, sets]);
}

export function useAsset(assetId: string | null): ResolvedAsset | null {
  const assets = useAssets();
  return useMemo(
    () => (assetId ? assets.find((asset) => asset.id === assetId) ?? null : null),
    [assets, assetId]
  );
}

/** The asset the inspector is looking at: the most recently selected one. */
export function useSelectedAsset(): ResolvedAsset | null {
  const selectedIds = useUi((state) => state.selectedIds);
  return useAsset(selectedIds[selectedIds.length - 1] ?? null);
}

/**
 * The scene this user is looking at. Which one that is comes from
 * localStorage, so two collaborators in the same project can work on
 * different scenes without fighting over a shared "active" field.
 */
export function useActiveScene(): Scene | null {
  const projectId = useServer((state) => state.project?.id ?? null);
  const activeIds = useUi((state) => state.activeSceneId);
  const scenes = useDoc((state) => state.scenes);

  return useMemo(() => {
    if (!projectId) return null;

    const wanted = activeIds[projectId];
    return scenes.find((entry) => entry.id === wanted) ?? scenes[0] ?? null;
  }, [projectId, activeIds, scenes]);
}

/**
 * The same resolution outside React, for event handlers and store actions.
 *
 * Every scene mutation targets whichever one is on screen, so resolving
 * it here saves threading the id through a dozen callbacks -- and keeps a
 * handler from mutating a scene the user is not looking at.
 */
export function activeSceneId(): string | null {
  const projectId = useServer.getState().project?.id;
  if (!projectId) return null;

  const { scenes } = useDoc.getState();
  const wanted = useUi.getState().activeSceneId[projectId];

  return (
    scenes.find((entry) => entry.id === wanted)?.id ?? scenes[0]?.id ?? null
  );
}
