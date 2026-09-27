import { snapPointToGrid } from "@/client/grid";
import { activeSceneId, resolveAssetsNow } from "@/client/stores/assets";
import { useDoc } from "@/client/stores/doc";
import { useUi } from "@/client/stores/ui";
import { isoProjectionFromSource } from "@/core/isoMask";
import { isSetAsset } from "@/shared/repeaterMix";

/**
 * Puts library images into the active scene, centred on `at` and staggered
 * so several dropped together do not sit exactly on top of each other.
 */
export function stageAssets(
  assetIds: string[],
  at: { x: number; y: number },
  stagger = 8
): void {
  const sceneId = activeSceneId();
  if (!sceneId) return;

  // One transaction for the whole drop: ten sprites dragged in together are
  // one Ctrl+Z and one network update rather than ten of each.
  const resolved = resolveAssetsNow();

  useDoc.getState().batch(() => {
    for (const [index, assetId] of assetIds.entries()) {
      const asset = resolved.find((entry) => entry.id === assetId) ?? null;

      useDoc.getState().addItem(sceneId, {
        id: crypto.randomUUID(),
        assetId,
        x: at.x + index * stagger,
        y: at.y + index * stagger,
        footprint: { width: 0, height: 0 },
        flipHorizontal: false,
        flipVertical: false,
        isoTurn: 0,
        isoProjection: isoProjectionFromSource(useUi.getState().mask?.source),
        showSource: false,
        opacity: 1,
        paused: false,
        sequenceId: "",
        heldFrame: 0,
        rotation: 0,
        display: isSetAsset(asset ?? { sequences: [] }) ? "sheet" : "cell"
      });
    }
  });
}

/**
 * Stages images in the middle of what the scene is showing right now, snapped
 * to the grid when snapping is on -- where you are looking, not the origin.
 */
export function stageAtCamera(assetIds: string[]): void {
  const sceneId = activeSceneId();
  if (!sceneId) return;

  const ui = useUi.getState();
  const camera = ui.cameraFor(sceneId);
  const unitsPerCell = useDoc.getState().scenes.find((entry) => entry.id === sceneId)?.unitsPerCell ?? 1;
  const at = ui.snapToGrid ? snapPointToGrid(camera, unitsPerCell) : { x: camera.x, y: camera.y };

  stageAssets(assetIds, at, ui.snapToGrid ? unitsPerCell : 8);
}
