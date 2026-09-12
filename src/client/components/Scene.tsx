"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAssetDrag, readAssetDrag } from "@/client/dragAssets";
import { centerOf, resizeFromCorner, snapPointToGrid, type ResizeCorner } from "@/client/grid";
import {
  MAX_TERRAIN_DETAIL,
  MAX_TERRAIN_TILES,
  TERRAIN_GRADIENT_LABELS,
  TERRAIN_GRADIENTS,
  clampTerrainCount,
  clampTerrainSamples,
  terrainExtent,
  type TerrainGradientId
} from "@/core/terrain";
import { clampIsoTurn, spriteFacingCss } from "@/core/isoTurn";
import {
  isoDiamondOrigin,
  isoLattice,
  listIsoCells,
  planRepeater,
  rotateFromCenter,
  type PlannedStamp
} from "@/core/repeater";
import {
  activeSceneId,
  resolveAssetsNow,
  useActiveScene,
  useAssets
} from "@/client/stores/assets";
import { useDoc } from "@/client/stores/doc";
import { EMPTY_PALETTE, useServer } from "@/client/stores/server";
import { DEFAULT_CAMERA, useUi } from "@/client/stores/ui";
import { DITHER_MODES, type Size } from "@/core/types";
// Aliased because the exported component in this file is also called `Scene`:
// one is the canvas you look at, the other is the document entity it draws.
import {
  DEFAULT_REPEATER,
  REPEATER_PLACEMENT_LABELS,
  REPEATER_PLACEMENTS,
  REPEATER_ROTATE_LABELS,
  REPEATER_ROTATES,
  defaultTerrain,
  type RepeatGroup,
  type RepeaterRotate,
  type ResolvedAsset,
  type Scene as SceneModel,
  type StagedItem,
  type TerrainGroup
} from "@/shared/model";
import { nextSceneName } from "@/shared/naming";
import { previewFrameSettings, useSequencePlayback } from "@/client/sequence";
import { expandRepeaterMix, isSetAsset } from "@/shared/repeaterMix";
import { frameSettings, frameSourceAssetId, type Sequence, type SequenceFrame } from "@/shared/sequence";
import { AssetThumb, BitmapCanvas, useAssetPalette, useProcessed } from "./AssetBitmap";
import { TerrainView } from "./TerrainView";
import {
  anyModalOpen,
  Bubble,
  Button,
  ColorInput,
  Divider,
  Modal,
  NumberInput,
  Row,
  Select,
  Slider,
  TextButton,
  Toggle
} from "./ui";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 64;
const HANDLE = 8;
const CORNERS: Array<{ corner: ResizeCorner; cursor: string; left: boolean; top: boolean }> = [
  { corner: "nw", cursor: "nwse-resize", left: true, top: true },
  { corner: "ne", cursor: "nesw-resize", left: false, top: true },
  { corner: "sw", cursor: "nesw-resize", left: true, top: false },
  { corner: "se", cursor: "nwse-resize", left: false, top: false }
];
const MAX_TILES = 900;
const MAX_TILES_PER_AXIS = 300;

/**
 * Mutations against the scene on screen.
 *
 * Every edit here goes into the shared Yjs document, so a collaborator sees
 * it on their next poll and it lands on the undo stack as one step. The
 * scene id is resolved rather than threaded because everything in this
 * file, by construction, edits the one the user is looking at.
 */
function patchItem(itemId: string, patch: Partial<StagedItem>): void {
  const sceneId = activeSceneId();
  if (sceneId) useDoc.getState().patchItem(sceneId, itemId, patch);
}

function patchGroup(groupId: string, patch: Partial<RepeatGroup>): void {
  const sceneId = activeSceneId();
  if (sceneId) useDoc.getState().patchGroup(sceneId, groupId, patch);
}

function convertToRepeater(itemId: string): void {
  const sceneId = activeSceneId();
  if (!sceneId) return;

  const groupId = useDoc.getState().convertItemToRepeater(sceneId, itemId);
  if (groupId) useUi.getState().setActiveGroup(groupId);
}

function addToGroup(groupId: string, assetIds: string[]): void {
  const sceneId = activeSceneId();
  if (!sceneId || assetIds.length === 0) return;

  useDoc.getState().addGroupAssets(sceneId, groupId, assetIds);
  useUi.getState().setActiveGroup(groupId);
}

function patchTerrain(terrainId: string, patch: Partial<TerrainGroup>): void {
  const sceneId = activeSceneId();
  if (sceneId) useDoc.getState().patchTerrain(sceneId, terrainId, patch);
}

function setTerrainTile(
  terrainId: string,
  index: number,
  patch: { heightAssetId?: string; colorAssetId?: string }
): void {
  const sceneId = activeSceneId();
  if (sceneId) useDoc.getState().setTerrainTile(sceneId, terrainId, index, patch);
}

function terrainLabel(terrain: TerrainGroup): string {
  if (terrain.name.trim()) return terrain.name;
  return `terrain ${clampTerrainCount(terrain.countX)}x${clampTerrainCount(terrain.countY)}`;
}

function stageAssets(
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

function tileIndices(
  step: number,
  count: number,
  fill: boolean,
  origin: number,
  size: number,
  viewMin: number,
  viewMax: number
): number[] {
  if (!fill) {
    const total = Math.min(MAX_TILES_PER_AXIS, Math.max(1, Math.floor(count)));
    return Array.from({ length: total }, (_, index) => index);
  }

  if (step < 1) return [0];

  const first = Math.floor((viewMin - origin - size) / step);
  const last = Math.ceil((viewMax - origin) / step);
  const total = Math.min(MAX_TILES_PER_AXIS, Math.max(1, last - first + 1));

  return Array.from({ length: total }, (_, index) => first + index);
}

const IGNORE_SIZE = () => undefined;

function resolveCell(cell: Size, natural: Size): Size {
  if (cell.width > 0 && cell.height > 0) return cell;

  const ratio =
    natural.width > 0 && natural.height > 0 ? natural.width / natural.height : 1;

  if (cell.width > 0) return { width: cell.width, height: cell.width / ratio };
  if (cell.height > 0) return { width: cell.height * ratio, height: cell.height };

  return natural;
}

interface Viewport {
  width: number;
  height: number;
}

function useSceneAsset(asset: ResolvedAsset): ResolvedAsset {
  const scene = useActiveScene();

  const palette = scene?.palette ?? "";
  const dither = scene?.paletteDither ?? "none";
  const strength = scene?.paletteDitherStrength ?? 1;

  return useMemo(() => {
    if (palette === "" || asset.processing.paletteId !== "") return asset;

    return {
      ...asset,
      processing: {
        ...asset.processing,
        paletteId: palette,
        dither,
        ditherStrength: strength
      }
    };
  }, [asset, dither, palette, strength]);
}

function StagedSprite({
  item,
  asset,
  viewport,
  camera,
  active,
  onPointerDown,
  onResizePointerDown,
  onRotatePointerDown
}: {
  item: StagedItem;
  asset: ResolvedAsset;
  viewport: Viewport;
  camera: { x: number; y: number; zoom: number };
  active: boolean;
  onPointerDown: (event: React.PointerEvent, item: StagedItem) => void;
  onResizePointerDown: (
    event: React.PointerEvent,
    item: StagedItem,
    corner: ResizeCorner,
    size: Size
  ) => void;
  onRotatePointerDown: (
    event: React.PointerEvent,
    item: StagedItem,
    size: Size
  ) => void;
}) {
  const staged = useSceneAsset(asset);
  const palette = useAssetPalette(staged);

  const sequences = staged.sequences.filter((entry) => entry.frames.length > 0);
  const sequence =
    sequences.find((entry) => entry.id === item.sequenceId) ?? sequences[0] ?? null;

  const playback = useSequencePlayback(item.paused ? null : sequence, true);

  const frameCount = sequence?.frames.length ?? 0;
  const showSheet = item.display === "sheet";
  const frameIndex = !sequence
    ? 0
    : item.paused
      ? Math.min(Math.max(0, item.heldFrame), frameCount - 1)
      : playback.index;
  const frame = sequence?.frames[frameIndex];

  // Sheet view is the whole processed image. Cell view plays or holds one
  // frame. Missing a sequence still falls back to frame 0 of the first one
  // so an unsliced animation does not draw the contact sheet as a sprite.
  const { preview } = useProcessed(
    staged,
    palette,
    item.showSource,
    "source",
    showSheet
      ? undefined
      : frame && sequence
        ? frameSettings(staged.processing, sequence, frame)
        : previewFrameSettings(staged, "source"),
    showSheet ? undefined : frame ? frameSourceAssetId(staged.id, frame) : undefined
  );

  const bitmap = item.showSource ? preview?.sourceBitmap : preview?.processed;
  const naturalWidth = item.showSource ? preview?.sourceWidth ?? 0 : preview?.width ?? 0;
  const naturalHeight = item.showSource ? preview?.sourceHeight ?? 0 : preview?.height ?? 0;

  const autoFootprint = item.footprint.width <= 0 || item.footprint.height <= 0;

  useEffect(() => {
    if (!autoFootprint || preview === null || preview.width <= 0) return;

    patchItem(item.id, {
      footprint: { width: preview.width, height: preview.height }
    });
  }, [autoFootprint, item.id, preview]);

  const footprintWidth = autoFootprint ? naturalWidth : item.footprint.width;
  const footprintHeight = autoFootprint ? naturalHeight : item.footprint.height;

  const screenWidth = footprintWidth * camera.zoom;
  const screenHeight = footprintHeight * camera.zoom;
  const left = (item.x - camera.x) * camera.zoom + viewport.width / 2;
  const top = (item.y - camera.y) * camera.zoom + viewport.height / 2;

  const effectiveScale = naturalWidth > 0 ? screenWidth / naturalWidth : 1;

  return (
    <div
      onPointerDown={(event) => onPointerDown(event, item)}
      style={{
        position: "absolute",
        left,
        top,
        width: screenWidth,
        height: screenHeight,
        zIndex: item.zIndex,
        opacity: item.opacity,
        outline: active ? "1px solid var(--color-accent)" : "none",
        outlineOffset: 1,
        overflow: "visible",
        transform: `rotate(${item.rotation}deg)`,
        transformOrigin: "center",
        cursor: "grab",
        touchAction: "none"
      }}
    >
      {bitmap ? (
        <BitmapCanvas
          bitmap={bitmap}
          width={naturalWidth}
          height={naturalHeight}
          pixelated={effectiveScale >= 1}
          style={{
            width: "100%",
            height: "100%",
            transform: spriteFacingCss(item.flipHorizontal, item.flipVertical, item.isoTurn),
            pointerEvents: "none"
          }}
        />
      ) : (
        <div className="h-full w-full rounded border border-dashed border-slate-600" />
      )}

      {active ? (
        <>
          <div
            style={{
              position: "absolute",
              left: screenWidth / 2 - 1,
              top: -22,
              width: 2,
              height: 22,
              background: "var(--color-accent)",
              pointerEvents: "none"
            }}
          />
          <div
            role="button"
            title="Drag to rotate"
            onPointerDown={(event) => {
              event.stopPropagation();
              onRotatePointerDown(event, item, {
                width: footprintWidth,
                height: footprintHeight
              });
            }}
            style={{
              position: "absolute",
              left: screenWidth / 2 - HANDLE / 2,
              top: -22 - HANDLE / 2,
              width: HANDLE,
              height: HANDLE,
              borderRadius: "50%",
              cursor: "grab",
              zIndex: 2,
              border: "1px solid var(--color-ink-900)",
              background: "var(--color-accent)",
              boxSizing: "border-box"
            }}
          />
          {CORNERS.map(({ corner, cursor, left: atLeft, top: atTop }) => (
            <div
              key={corner}
              role="button"
              title="Drag to resize"
              onPointerDown={(event) => {
                event.stopPropagation();
                onResizePointerDown(event, item, corner, {
                  width: footprintWidth,
                  height: footprintHeight
                });
              }}
              style={{
                position: "absolute",
                left: atLeft ? -HANDLE / 2 : undefined,
                right: atLeft ? undefined : -HANDLE / 2,
                top: atTop ? -HANDLE / 2 : undefined,
                bottom: atTop ? undefined : -HANDLE / 2,
                width: HANDLE,
                height: HANDLE,
                cursor,
                zIndex: 2,
                border: "1px solid var(--color-ink-900)",
                background: "var(--color-accent)",
                boxSizing: "border-box"
              }}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

function GroupAssetTiles({
  group,
  asset,
  sequence,
  frame,
  stamps,
  viewport,
  camera,
  onReady,
  onPointerDown
}: {
  group: RepeatGroup;
  asset: ResolvedAsset;
  sequence: Sequence | null;
  frame: SequenceFrame | null;
  stamps: PlannedStamp[];
  viewport: Viewport;
  camera: { x: number; y: number; zoom: number };
  onReady: (width: number, height: number) => void;
  onPointerDown: (event: React.PointerEvent, group: RepeatGroup) => void;
}) {
  const staged = useSceneAsset(asset);
  const palette = useAssetPalette(staged);
  const { preview } = useProcessed(
    staged,
    palette,
    false,
    "source",
    sequence && frame
      ? frameSettings(staged.processing, sequence, frame)
      : previewFrameSettings(staged, "source"),
    frame ? frameSourceAssetId(staged.id, frame) : undefined
  );

  useEffect(() => {
    if (preview && preview.width > 0) onReady(preview.width, preview.height);
  }, [onReady, preview]);

  if (!preview) return null;

  const rectFor = (stamp: PlannedStamp) => {
    const cellLeft = (stamp.x - camera.x) * camera.zoom + viewport.width / 2;
    const cellTop = (stamp.y - camera.y) * camera.zoom + viewport.height / 2;

    const left = Math.round(cellLeft);
    const top = Math.round(cellTop);
    const boxWidth = Math.round(cellLeft + stamp.width * camera.zoom) - left;
    const boxHeight = Math.round(cellTop + stamp.height * camera.zoom) - top;

    const quarter = stamp.rotation === 90 || stamp.rotation === 270;
    const fit = quarter
      ? Math.min(boxWidth / preview.height, boxHeight / preview.width)
      : Math.min(boxWidth / preview.width, boxHeight / preview.height);

    const width = preview.width * fit;
    const height = preview.height * fit;

    return {
      left: left + (boxWidth - width) / 2,
      top: top + (boxHeight - height) / 2,
      width,
      height,
      rotation: stamp.rotation,
      flipH: stamp.flipH,
      flipV: stamp.flipV
    };
  };

  return (
    <>
      {stamps.map((stamp) => {
        const draw = rectFor(stamp);

        return (
        <div
          key={stamp.key}
          onPointerDown={(event) => onPointerDown(event, group)}
          onDragOver={(event) => {
            if (!isAssetDrag(event)) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(event) => {
            if (!isAssetDrag(event)) return;
            event.preventDefault();
            event.stopPropagation();
            addToGroup(group.id, readAssetDrag(event));
          }}
          style={{
            position: "absolute",
            left: draw.left,
            top: draw.top,
            width: draw.width,
            height: draw.height,
            zIndex: group.zIndex,
            opacity: group.opacity,
            transform: `rotate(${draw.rotation}deg) scale(${draw.flipH ? -1 : 1}, ${draw.flipV ? -1 : 1})`,
            cursor: "grab",
            touchAction: "none"
          }}
        >
          <BitmapCanvas
            bitmap={preview.processed}
            width={preview.width}
            height={preview.height}
            pixelated={draw.width / preview.width >= 1}
            style={{ width: "100%", height: "100%", pointerEvents: "none" }}
          />
        </div>
        );
      })}
    </>
  );
}

function GroupLayer({
  group,
  assets,
  viewport,
  camera,
  active,
  onPointerDown
}: {
  group: RepeatGroup;
  assets: ResolvedAsset[];
  viewport: Viewport;
  camera: { x: number; y: number; zoom: number };
  active: boolean;
  onPointerDown: (event: React.PointerEvent, group: RepeatGroup) => void;
}) {
  const members = group.assetIds
    .map((id) => assets.find((asset) => asset.id === id))
    .filter((asset): asset is ResolvedAsset => asset !== undefined);

  const [natural, setNatural] = useState({ width: 0, height: 0 });

  const onReady = useCallback((width: number, height: number) => {
    setNatural((previous) =>
      previous.width === width && previous.height === height ? previous : { width, height }
    );
  }, []);

  const { width: cellWidth, height: cellHeight } = resolveCell(group.cell, natural);

  const originLeft = (group.x - camera.x) * camera.zoom + viewport.width / 2;
  const originTop = (group.y - camera.y) * camera.zoom + viewport.height / 2;

  if (members.length === 0) {
    const empty =
      group.placement === "scatter"
        ? {
            width: Math.max(80, group.areaWidth * camera.zoom),
            height: Math.max(80, group.areaHeight * camera.zoom)
          }
        : group.placement === "iso"
          ? {
              width: Math.max(64, (cellWidth || 64) * camera.zoom),
              height: Math.max(32, ((cellWidth || 64) / 2) * camera.zoom)
            }
          : { width: Math.max(80, 48 * camera.zoom), height: Math.max(80, 48 * camera.zoom) };

    return (
      <div
        onPointerDown={(event) => onPointerDown(event, group)}
        onDragOver={(event) => {
          if (!isAssetDrag(event)) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          if (!isAssetDrag(event)) return;
          event.preventDefault();
          event.stopPropagation();
          addToGroup(group.id, readAssetDrag(event));
        }}
        className="flex items-center justify-center text-center text-[10px] leading-tight text-slate-400"
        style={{
          position: "absolute",
          left: originLeft,
          top: originTop,
          width: empty.width,
          height: empty.height,
          border:
            group.placement === "iso"
              ? "none"
              : `1px dashed ${active ? "var(--color-accent)" : "#4a5565"}`,
          zIndex: group.zIndex,
          cursor: "grab",
          touchAction: "none"
        }}
      >
        {group.placement === "iso" ? (
          <svg
            viewBox="0 0 64 32"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0"
          >
            <polygon
              points="32,0 64,16 32,32 0,16"
              fill="none"
              stroke={active ? "var(--color-accent)" : "#4a5565"}
              strokeWidth="1"
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : null}
        <span className="relative px-1">drop art here</span>
      </div>
    );
  }

  const stepX = cellWidth + group.marginX;
  const stepY = cellHeight + group.marginY;
  const scatter = group.placement === "scatter";
  const iso = group.placement === "iso";
  const view = {
    minX: camera.x - viewport.width / (2 * camera.zoom),
    maxX: camera.x + viewport.width / (2 * camera.zoom),
    minY: camera.y - viewport.height / (2 * camera.zoom),
    maxY: camera.y + viewport.height / (2 * camera.zoom)
  };

  const columns = scatter || iso
    ? [0]
    : tileIndices(stepX, group.countX, group.fillX, group.x, cellWidth, view.minX, view.maxX);

  const rowBudget = Math.max(1, Math.floor(MAX_TILES / Math.max(1, columns.length)));
  const rows = scatter || iso
    ? [0]
    : tileIndices(stepY, group.countY, group.fillY, group.y, cellHeight, view.minY, view.maxY).slice(
        0,
        rowBudget
      );

  const lattice = isoLattice({ width: cellWidth, height: cellHeight }, group.marginX, group.marginY);
  const isoCells = iso
    ? listIsoCells({
        origin: { x: group.x, y: group.y },
        lattice,
        cell: { width: cellWidth, height: cellHeight },
        countX: group.countX,
        countY: group.countY,
        fillX: group.fillX,
        fillY: group.fillY,
        view,
        maxTiles: MAX_TILES,
        maxPerAxis: MAX_TILES_PER_AXIS
      })
    : [];

  const mix = expandRepeaterMix(members);
  const stamps = planRepeater(group, { width: cellWidth, height: cellHeight }, mix.length, {
    columns,
    rows,
    stepX,
    stepY,
    cells: isoCells
  });
  const buckets = mix.map<PlannedStamp[]>(() => []);
  for (const stamp of stamps) buckets[stamp.mixIndex]?.push(stamp);

  const stampBounds = (items: PlannedStamp[]) => {
    if (items.length === 0) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const stamp of items) {
      minX = Math.min(minX, stamp.x);
      maxX = Math.max(maxX, stamp.x + stamp.width);
      minY = Math.min(minY, stamp.y);
      maxY = Math.max(maxY, stamp.y + stamp.height);
    }
    return {
      left: (minX - camera.x) * camera.zoom + viewport.width / 2,
      top: (minY - camera.y) * camera.zoom + viewport.height / 2,
      width: (maxX - minX) * camera.zoom,
      height: (maxY - minY) * camera.zoom
    };
  };

  const backdrop = !group.background
    ? null
    : scatter
      ? {
          left: originLeft,
          top: originTop,
          width: Math.max(1, group.areaWidth) * camera.zoom,
          height: Math.max(1, group.areaHeight) * camera.zoom
        }
      : iso
        ? stampBounds(stamps)
        : columns.length > 0 && rows.length > 0
          ? {
              left: (group.x + columns[0] * stepX - camera.x) * camera.zoom + viewport.width / 2,
              top: (group.y + rows[0] * stepY - camera.y) * camera.zoom + viewport.height / 2,
              width: ((columns[columns.length - 1] - columns[0]) * stepX + cellWidth) * camera.zoom,
              height: ((rows[rows.length - 1] - rows[0]) * stepY + cellHeight) * camera.zoom
            }
          : null;

  const outline = scatter
    ? {
        left: originLeft - 2,
        top: originTop - 2,
        width: Math.max(1, group.areaWidth) * camera.zoom + 4,
        height: Math.max(1, group.areaHeight) * camera.zoom + 4
      }
    : iso
      ? null
      : cellWidth > 0
        ? {
            left: originLeft - 2,
            top: originTop - 2,
            width: cellWidth * camera.zoom + 4,
            height: cellHeight * camera.zoom + 4
          }
        : null;

  return (
    <>
      {backdrop ? (
        <div
          onPointerDown={(event) => onPointerDown(event, group)}
          onDragOver={(event) => {
            if (!isAssetDrag(event)) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(event) => {
            if (!isAssetDrag(event)) return;
            event.preventDefault();
            event.stopPropagation();
            addToGroup(group.id, readAssetDrag(event));
          }}
          style={{
            position: "absolute",
            left: backdrop.left,
            top: backdrop.top,
            width: backdrop.width,
            height: backdrop.height,
            background: group.background,
            zIndex: group.zIndex,
            opacity: group.opacity,
            cursor: "grab",
            touchAction: "none"
          }}
        />
      ) : null}

      {active && outline ? (
        <div
          style={{
            position: "absolute",
            left: outline.left,
            top: outline.top,
            width: outline.width,
            height: outline.height,
            border: "1px dashed var(--color-accent)",
            zIndex: group.zIndex,
            pointerEvents: "none"
          }}
        />
      ) : null}

      {mix.map((entry, index) => (
        <GroupAssetTiles
          key={`${entry.asset.id}:${entry.frame?.id ?? "asset"}`}
          group={group}
          asset={entry.asset}
          sequence={entry.sequence}
          frame={entry.frame}
          stamps={buckets[index]}
          viewport={viewport}
          camera={camera}
          onReady={index === 0 ? onReady : IGNORE_SIZE}
          onPointerDown={onPointerDown}
        />
      ))}

      {active && iso && lattice.diamondW > 0
        ? isoCells.map(({ col, row }) => {
            const diamond = isoDiamondOrigin(col, row, { x: group.x, y: group.y }, lattice);
            const left = (diamond.x - camera.x) * camera.zoom + viewport.width / 2;
            const top = (diamond.y - camera.y) * camera.zoom + viewport.height / 2;
            const width = lattice.diamondW * camera.zoom;
            const height = lattice.diamondH * camera.zoom;

            return (
              <svg
                key={`iso:${col}:${row}`}
                viewBox={`0 0 ${lattice.diamondW} ${lattice.diamondH}`}
                preserveAspectRatio="none"
                style={{
                  position: "absolute",
                  left,
                  top,
                  width,
                  height,
                  zIndex: group.zIndex,
                  pointerEvents: "none"
                }}
              >
                <polygon
                  points={`${lattice.diamondW / 2},0 ${lattice.diamondW},${lattice.diamondH / 2} ${lattice.diamondW / 2},${lattice.diamondH} 0,${lattice.diamondH / 2}`}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth="1"
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            );
          })
        : null}
    </>
  );
}

function PaletteChip({
  label,
  colours,
  active,
  onSelect,
  onRemove
}: {
  label: string;
  colours: Array<{ r: number; g: number; b: number }>;
  active: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  return (
    <span
      className={`flex items-center gap-1 rounded border px-1 py-0.5 text-[10px] transition ${
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent-dim)] text-white"
          : "border-[var(--color-edge)] bg-[var(--color-ink-600)] text-slate-300 hover:bg-[var(--color-ink-500)]"
      }`}
    >
      <button type="button" onClick={onSelect} className="flex items-center gap-1">
        {colours.length > 0 ? (
          <span className="flex overflow-hidden rounded-sm">
            {colours.slice(0, 8).map((colour, index) => (
              <span
                key={index}
                className="h-3 w-1.5"
                style={{ background: `rgb(${colour.r},${colour.g},${colour.b})` }}
              />
            ))}
          </span>
        ) : null}
        <span className="max-w-[9rem] truncate">{label}</span>
      </button>

      {onRemove ? (
        <TextButton danger title="Take this palette out of this scene's set" onClick={onRemove}>
          &times;
        </TextButton>
      ) : null}
    </span>
  );
}

/** The palette row inside the view bubble. Chrome-free; the bubble frames it. */
function PaletteControls() {
  const scene = useActiveScene();
  const palettes = useServer((state) => state.palettes);
  const paletteColors = useServer((state) => state.paletteColors);
  const busy = useUi((state) => state.busy);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [showDither, setShowDither] = useState(false);

  if (!scene) return null;

  const pool = scene.palettePool;
  const palette = scene.palette;
  const unpooled = palettes.filter((entry) => !pool.includes(entry.id));

  const nameFor = (paletteId: string) =>
    palettes.find((entry) => entry.id === paletteId)?.name ?? paletteId;

  const previewFor = (paletteId: string) =>
    paletteColors[paletteId] ??
    palettes.find((entry) => entry.id === paletteId)?.preview ??
    [];

  const setPalette = (paletteId: string) =>
    useDoc.getState().patchScene(scene.id, { palette: paletteId });

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <PaletteChip
        label="off"
        colours={[]}
        active={palette === ""}
        onSelect={() => setPalette("")}
      />

      {pool.map((paletteId) => (
        <PaletteChip
          key={paletteId}
          label={nameFor(paletteId).replace(/\.[^.]+$/, "")}
          colours={previewFor(paletteId)}
          active={palette === paletteId}
          onSelect={() => setPalette(paletteId)}
          onRemove={() =>
            useDoc.getState().removePaletteFromPool(scene.id, paletteId)
          }
        />
      ))}

      {unpooled.length > 0 ? (
        <select
          value=""
          title="Add a palette already uploaded to this project"
          onChange={(event) =>
            useDoc.getState().addPaletteToPool(scene.id, event.target.value)
          }
          style={{ width: 130 }}
        >
          <option value="">add palette...</option>
          {unpooled.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name} ({entry.count})
            </option>
          ))}
        </select>
      ) : null}

      <Button
        variant="ghost"
        disabled={busy !== null}
        title="Upload .hex, .gpl, .pal, or .png palette files"
        onClick={() => fileRef.current?.click()}
      >
        upload
      </Button>

      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".hex,.txt,.gpl,.pal,.png"
        className="hidden"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          void useServer.getState().addPalettes(files);
        }}
      />

      {palette !== "" ? (
        <Button
          variant={showDither ? "primary" : "ghost"}
          onClick={() => setShowDither(!showDither)}
        >
          dither
        </Button>
      ) : null}

      <span className="flex-1" />

      {palette !== "" ? (
        <Button
          title="Write this palette into every asset on the scene so exports use it too"
          onClick={() => {
            const changed = useDoc.getState().commitPaletteToScene(scene.id);
            useUi.getState().setNotice(`baked the palette into ${changed} asset(s)`);
          }}
        >
          bake into scene
        </Button>
      ) : null}

      {showDither && palette !== "" ? (
        <div className="flex w-full items-center gap-2 pt-1">
          <span className="w-24 shrink-0">
            <Select
              value={scene.paletteDither}
              options={DITHER_MODES}
              onChange={(value) =>
                useDoc.getState().patchScene(scene.id, { paletteDither: value })
              }
            />
          </span>
          {scene.paletteDither !== "none" ? (
            <span className="w-48">
              <Slider
                min={0}
                max={1}
                value={scene.paletteDitherStrength}
                onChange={(value) =>
                  useDoc
                    .getState()
                    .patchScene(scene.id, { paletteDitherStrength: value })
                }
              />
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * View controls: how you are looking at the scene, and what it is made
 * of. Nothing here changes the art, which is why it can be rolled up.
 */
function ViewBubble() {
  const scene = useActiveScene();
  const snapToGrid = useUi((state) => state.snapToGrid);
  const showGrid = useUi((state) => state.showGrid);
  const collapsed = useUi((state) => state.collapsedBubbles.view);

  const sceneId = scene?.id ?? "";
  const camera = useUi((state) => state.camera[sceneId] ?? DEFAULT_CAMERA);

  if (!scene) return null;

  const zoomLabel =
    camera.zoom >= 1 ? `${camera.zoom.toFixed(2)}x` : `1/${(1 / camera.zoom).toFixed(1)}x`;

  return (
    <Bubble
      title="View"
      width={300}
      collapsed={collapsed}
      onToggle={() => useUi.getState().toggleBubble("view")}
      actions={<span className="text-[10px] tabular-nums text-slate-500">{zoomLabel}</span>}
    >
      <Row className="mb-2 flex-wrap">
        <Button
          variant="ghost"
          title="Zoom so one asset pixel is one screen pixel"
          onClick={() => useUi.getState().setCamera(sceneId, { zoom: 1 })}
        >
          1:1
        </Button>

        <Button
          variant="ghost"
          title="Pan back to the origin, keeping the current zoom"
          onClick={() => useUi.getState().setCamera(sceneId, { x: 0, y: 0 })}
        >
          center
        </Button>

        <span className="flex-1" />

        <Button variant={showGrid ? "primary" : "ghost"} onClick={() => useUi.getState().toggleGrid()}>
          grid
        </Button>
        <Button
          variant={snapToGrid ? "primary" : "ghost"}
          onClick={() => useUi.getState().toggleSnap()}
        >
          snap
        </Button>
      </Row>

      <Row className="mb-2">
        <span className="text-[10px] text-slate-400">cell</span>
        <NumberInput
          integer
          min={1}
          width={64}
          value={scene.unitsPerCell}
          onChange={(value) =>
            useDoc.getState().patchScene(scene.id, { unitsPerCell: value })
          }
        />
        <span className="text-[10px] text-slate-600">units per grid square</span>
      </Row>

      <Divider label="palette" />

      <PaletteControls />
    </Bubble>
  );
}

/**
 * What you can put on the scene.
 *
 * Parallax and animation are shown disabled rather than omitted: knowing the
 * scene is meant to hold more than repeaters is worth a greyed button,
 * and it keeps the grouping honest once they land.
 */
function ElementsBubble() {
  const scene = useActiveScene();
  const snapToGrid = useUi((state) => state.snapToGrid);
  const collapsed = useUi((state) => state.collapsedBubbles.elements);

  const sceneId = scene?.id ?? "";
  const camera = useUi((state) => state.camera[sceneId] ?? DEFAULT_CAMERA);

  if (!scene) return null;

  const staged = scene.items.length + scene.groups.length + scene.terrains.length;

  const addRepeater = () => {
    const id = crypto.randomUUID();
    const position = snapToGrid
      ? snapPointToGrid(camera, scene.unitsPerCell)
      : { x: camera.x, y: camera.y };

    useDoc.getState().addGroup(scene.id, {
      id,
      name: "",
      assetIds: [],
      x: position.x,
      y: position.y,
      cell: { width: 0, height: 0 },
      marginX: 0,
      marginY: 0,
      countX: 3,
      countY: 3,
      fillX: false,
      fillY: false,
      ...DEFAULT_REPEATER,
      background: "",
      opacity: 1,
      seed: Math.floor(Math.random() * 0xffffffff)
    });

    useUi.getState().setActiveGroup(id);
  };

  const addTerrain = () => {
    const id = crypto.randomUUID();
    const position = snapToGrid
      ? snapPointToGrid(camera, scene.unitsPerCell)
      : { x: camera.x, y: camera.y };

    useDoc.getState().addTerrain(scene.id, defaultTerrain(id, position.x, position.y));
    useUi.getState().setActiveTerrain(id);
    useUi.getState().setSceneView(scene.id, "terrain");
  };

  return (
    <Bubble
      title="Elements"
      width={196}
      collapsed={collapsed}
      onToggle={() => useUi.getState().toggleBubble("elements")}
    >
      <div className="mb-2 flex flex-col gap-1">
        <Button
          title="Add a repeater, then drag library art onto it. Grid tiles, an isometric diamond map, or scatter trash and grass in a rectangle"
          onClick={addRepeater}
        >
          + repeater
        </Button>
        <Button
          title="Add a terrain, then drag heightmaps onto its cells. The Terrain tab shows the assembled mesh"
          onClick={addTerrain}
        >
          + terrain
        </Button>
        <Button disabled title="Not built yet: layered backgrounds that scroll at different rates">
          + parallax
        </Button>
        <Button disabled title="Not built yet: a frame sequence played on the scene">
          + animation
        </Button>
      </div>

      <Row>
        <span className="text-[10px] text-slate-500">{staged} staged</span>
        <span className="flex-1" />
        <Button
          variant="danger"
          disabled={staged === 0}
          onClick={() => {
            if (confirm("Remove everything from the scene?")) {
              useDoc.getState().clearScene(scene.id);
            }
          }}
        >
          clear
        </Button>
      </Row>
    </Bubble>
  );
}

/**
 * One row of the scenes bubble: pick it, rename it, delete it.
 *
 * Rename is inline rather than a modal because a scene name is a label
 * you fix in passing, and a dialog for it would cost more attention than the
 * edit is worth.
 */
function SceneRow({
  entry,
  active,
  deletable,
  onSelect,
  onDelete
}: {
  entry: { id: string; name: string };
  active: boolean;
  deletable: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const rename = useInlineRename(entry.name, (name) =>
    useDoc.getState().patchScene(entry.id, { name })
  );

  if (rename.editing) return rename.field;

  return (
    <div
      onClick={onSelect}
      onDoubleClick={rename.start}
      title={`${entry.name} -- double-click to rename`}
      className={`group flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-[11px] transition ${
        active
          ? "bg-[var(--color-accent-dim)] text-white"
          : "text-slate-300 hover:bg-[var(--color-ink-600)]"
      }`}
    >
      <span className="flex-1 truncate">{entry.name}</span>

      <TextButton
        title="Rename"
        className="opacity-0 group-hover:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
          rename.start();
        }}
      >
        {"\u270e"}
      </TextButton>

      {deletable ? (
        <TextButton
          danger
          title="Delete this scene and everything on it"
          className="opacity-0 group-hover:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          &times;
        </TextButton>
      ) : null}
    </div>
  );
}

/**
 * Deleting a scene throws away an arrangement that took real work to make and
 * that undo will not fully bring back once the tab closes, so it asks first.
 *
 * A dialog rather than `confirm()` because the browser's own is modal to the
 * whole tab, unstyled, and says "localhost:4300 says" -- which reads like the
 * page has gone wrong rather than like the app is checking.
 */
function DeleteSceneModal({ scene, onClose }: { scene: SceneModel; onClose: () => void }) {
  const sprites = scene.items.length;
  const repeaters = scene.groups.length;
  const terrains = scene.terrains.length;

  const contents = [
    sprites > 0 ? `${sprites} sprite${sprites === 1 ? "" : "s"}` : null,
    repeaters > 0 ? `${repeaters} repeater${repeaters === 1 ? "" : "s"}` : null,
    terrains > 0 ? `${terrains} terrain${terrains === 1 ? "" : "s"}` : null
  ].filter(Boolean);

  return (
    <Modal title="Delete scene" variant="plain" width={420} onClose={onClose}>
      <p className="text-slate-300">
        Delete <span className="font-medium text-white">{scene.name}</span>?{" "}
        {contents.length > 0
          ? `The ${contents.join(" and ")} on it go too.`
          : "It is empty, so nothing else goes with it."}
      </p>

      <p className="mt-2 text-sm text-slate-500">
        The art itself stays in your library. Only this arrangement of it is removed.
      </p>

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-[var(--color-edge)] px-4 py-2 text-sm text-slate-300 hover:bg-[var(--color-ink-700)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            useDoc.getState().deleteScene(scene.id);
            onClose();
          }}
          className="rounded-md bg-rose-800 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
        >
          Delete
        </button>
      </div>
    </Modal>
  );
}

/**
 * What to call a repeater that has not been named: the grid it lays out.
 *
 * A description rather than a number, because "repeater 3x3" tells you which
 * one you are looking at on a busy scene and "repeater 2" does not.
 */
function repeaterLabel(group: RepeatGroup): string {
  if (group.name.trim()) return group.name.trim();
  if (group.placement === "scatter") {
    return `scatter ${group.scatterCount} in ${Math.round(group.areaWidth)}×${Math.round(group.areaHeight)}`;
  }
  if (group.placement === "iso") {
    return `iso ${group.countX}x${group.countY}`;
  }
  return `repeater ${group.countX}x${group.countY}`;
}

/**
 * A name you can fix in passing: double-click to edit, Enter or blur to keep,
 * Escape to abandon.
 *
 * Inline rather than a dialog because a label is worth less attention than a
 * dialog costs. Blank commits are dropped rather than stored, so there is no
 * way to end up with a nameless row.
 */
function useInlineRename(value: string, onCommit: (name: string) => void) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    const name = draft.trim();
    if (name && name !== value) onCommit(name);
    setEditing(false);
  };

  return {
    editing,
    start: () => {
      setDraft(value);
      setEditing(true);
    },
    field: (
      <input
        autoFocus
        value={draft}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className="w-full"
      />
    )
  };
}

/**
 * One row of the scene tree.
 *
 * Ordered by depth rather than by when it was added, so the row order matches
 * what covers what on the canvas.
 */
function TreeRow({
  label,
  detail,
  active,
  onSelect,
  onDuplicate,
  onConvert,
  onRemove,
  onRename
}: {
  label: string;
  detail: string;
  active: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  /** Sprites only: turn the one copy into a 3×3 repeater. */
  onConvert?: () => void;
  onRemove: () => void;
  /** Omitted for sprites, whose name belongs to the asset and not the scene. */
  onRename?: (name: string) => void;
}) {
  const rename = useInlineRename(label, onRename ?? (() => {}));

  const action = (run: () => void) => (event: React.MouseEvent) => {
    event.stopPropagation();
    run();
  };

  if (onRename && rename.editing) return rename.field;

  return (
    <div
      onClick={onSelect}
      onDoubleClick={onRename ? rename.start : undefined}
      title={
        onRename
          ? `${label} -- click to centre the view on it, double-click to rename`
          : `${label} -- click to select and centre the view on it`
      }
      className={`group flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-[11px] transition ${
        active
          ? "bg-[var(--color-accent-dim)] text-white"
          : "text-slate-300 hover:bg-[var(--color-ink-600)]"
      }`}
    >
      <span className="flex-1 truncate">{label}</span>
      <span className="shrink-0 text-[10px] text-slate-500 group-hover:hidden">{detail}</span>

      {onRename ? (
        <TextButton
          title="Rename"
          className="hidden group-hover:block"
          onClick={action(rename.start)}
        >
          {"\u270e"}
        </TextButton>
      ) : null}

      {onConvert ? (
        <TextButton
          title="Convert to a 3×3 repeater"
          className="hidden group-hover:block"
          onClick={action(onConvert)}
        >
          {"\u25a6"}
        </TextButton>
      ) : null}

      <TextButton
        title="Duplicate, offset by one cell"
        className="hidden group-hover:block"
        onClick={action(onDuplicate)}
      >
        {"\u29c9"}
      </TextButton>
      <TextButton
        danger
        title="Take this off the scene. The art stays in your library"
        className="hidden group-hover:block"
        onClick={action(onRemove)}
      >
        &times;
      </TextButton>
    </div>
  );
}

/**
 * Everything on the scene, as a list.
 *
 * The canvas is unbounded, so anything you pan away from is effectively lost:
 * there is no edge to scroll back to and nothing to tell you it is out there.
 * This is the index that makes the scene navigable rather than just explorable.
 */
function SceneTreeBubble() {
  const scene = useActiveScene();
  const assets = useAssets();
  const activeItemId = useUi((state) => state.activeItemId);
  const activeGroupId = useUi((state) => state.activeGroupId);
  const activeTerrainId = useUi((state) => state.activeTerrainId);
  const collapsed = useUi((state) => state.collapsedBubbles.tree);

  if (!scene) return null;

  const doc = () => useDoc.getState();
  const step = scene.unitsPerCell;

  const focus = (entry: StagedItem | RepeatGroup | TerrainGroup) =>
    useUi.getState().setCamera(scene.id, centerOf(entry));

  // One list, deepest last, so reading top to bottom matches front to back.
  const rows = [
    ...scene.terrains.map((terrain) => ({ kind: "terrain" as const, entry: terrain })),
    ...scene.groups.map((group) => ({ kind: "group" as const, entry: group })),
    ...scene.items.map((item) => ({ kind: "item" as const, entry: item }))
  ].sort((a, b) => b.entry.zIndex - a.entry.zIndex);

  return (
    <Bubble
      title="Scene tree"
      width={228}
      collapsed={collapsed}
      onToggle={() => useUi.getState().toggleBubble("tree")}
      actions={<span className="text-[10px] text-slate-500">{rows.length}</span>}
    >
      {rows.length === 0 ? (
        <p className="px-1.5 py-1 text-[10px] text-slate-500">
          Nothing here yet. Drag art from the library onto the scene.
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {rows.map((row) =>
            row.kind === "item" ? (
              <TreeRow
                key={row.entry.id}
                label={assets.find((asset) => asset.id === row.entry.assetId)?.label ?? "missing art"}
                detail={`${Math.round(row.entry.x)}, ${Math.round(row.entry.y)}`}
                active={row.entry.id === activeItemId}
                onSelect={() => {
                  useUi.getState().setActiveItem(row.entry.id);
                  focus(row.entry);
                }}
                onDuplicate={() => {
                  const { id: _id, zIndex: _zIndex, ...rest } = row.entry;
                  const id = crypto.randomUUID();

                  doc().addItem(scene.id, { ...rest, id, x: row.entry.x + step, y: row.entry.y + step });
                  useUi.getState().setActiveItem(id);
                }}
                onConvert={() => convertToRepeater(row.entry.id)}
                onRemove={() => doc().removeItem(scene.id, row.entry.id)}
              />
            ) : row.kind === "group" ? (
              <TreeRow
                key={row.entry.id}
                label={repeaterLabel(row.entry)}
                detail={`${row.entry.assetIds.length} art`}
                active={row.entry.id === activeGroupId}
                onRename={(name) => doc().patchGroup(scene.id, row.entry.id, { name })}
                onSelect={() => {
                  useUi.getState().setActiveGroup(row.entry.id);
                  focus(row.entry);
                }}
                onDuplicate={() => {
                  const { id: _id, zIndex: _zIndex, ...rest } = row.entry;
                  const id = crypto.randomUUID();

                  doc().addGroup(scene.id, {
                    ...rest,
                    id,
                    x: row.entry.x + step,
                    y: row.entry.y + step,
                    seed: Math.floor(Math.random() * 0xffffffff)
                  });
                  useUi.getState().setActiveGroup(id);
                }}
                onRemove={() => doc().removeGroup(scene.id, row.entry.id)}
              />
            ) : (
              <TreeRow
                key={row.entry.id}
                label={terrainLabel(row.entry)}
                detail={`${row.entry.tiles.filter((tile) => tile.heightAssetId).length} maps`}
                active={row.entry.id === activeTerrainId}
                onRename={(name) => doc().patchTerrain(scene.id, row.entry.id, { name })}
                onSelect={() => {
                  useUi.getState().setActiveTerrain(row.entry.id);
                  focus(row.entry);
                }}
                onDuplicate={() => {
                  const { id: _id, zIndex: _zIndex, ...rest } = row.entry;
                  const id = crypto.randomUUID();

                  doc().addTerrain(scene.id, {
                    ...rest,
                    id,
                    x: row.entry.x + step,
                    y: row.entry.y + step
                  });
                  useUi.getState().setActiveTerrain(id);
                }}
                onRemove={() => doc().removeTerrain(scene.id, row.entry.id)}
              />
            )
          )}
        </div>
      )}

      {rows.length > 0 ? (
        <Row className="mt-1.5">
          <span className="flex-1" />
          <Button
            variant="danger"
            title="Remove every item, repeater, and terrain from this scene"
            onClick={() => {
              if (!confirm("Remove everything from the scene?")) return;
              useDoc.getState().clearScene(scene.id);
              const ui = useUi.getState();
              ui.setActiveItem(null);
              ui.setActiveGroup(null);
              ui.setActiveTerrain(null);
            }}
          >
            clear scene
          </Button>
        </Row>
      ) : null}
    </Bubble>
  );
}

/**
 * The scenes in this project, and which one you are looking at.
 *
 * The list is shared but the selection is not: two collaborators can sit in
 * the same project on different scenes, so which one is open lives in
 * localStorage rather than in the document.
 */
function ScenesBubble() {
  const scenes = useDoc((state) => state.scenes);
  const project = useServer((state) => state.project);
  const collapsed = useUi((state) => state.collapsedBubbles.scenes);
  const active = useActiveScene();

  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (!project) return null;

  const select = (id: string) => useUi.getState().setActiveScene(project.id, id);

  // Looked up by id rather than held as an object, so a collaborator deleting
  // the same scene closes the dialog instead of leaving it open over nothing.
  const deleting = scenes.find((entry) => entry.id === deletingId) ?? null;

  return (
    <>
      {deleting ? (
        <DeleteSceneModal scene={deleting} onClose={() => setDeletingId(null)} />
      ) : null}

      <Bubble
        title="Scenes"
        width={208}
        collapsed={collapsed}
        onToggle={() => useUi.getState().toggleBubble("scenes")}
        actions={<span className="text-[10px] text-slate-500">{scenes.length}</span>}
      >
        <div className="mb-1.5 flex flex-col gap-0.5">
          {scenes.map((entry) => (
            <SceneRow
              key={entry.id}
              entry={entry}
              active={entry.id === active?.id}
              deletable={scenes.length > 1}
              onSelect={() => select(entry.id)}
              onDelete={() => setDeletingId(entry.id)}
            />
          ))}
        </div>

        <Button
          variant="ghost"
          className="w-full"
          title="Add another scene to this project"
          onClick={() => {
            const id = useDoc.getState().createScene(nextSceneName(scenes));
            if (id) select(id);
          }}
        >
          + scene
        </Button>
      </Bubble>
    </>
  );
}

/** Where a drag has moved or resized something, before it is committed. */
interface DragPreview {
  targetId: string;
  x: number;
  y: number;
  footprint?: Size;
  rotation?: number;
}

export function Scene() {
  const scene = useActiveScene();
  const assets = useAssets();
  const activeItemId = useUi((state) => state.activeItemId);
  const activeGroupId = useUi((state) => state.activeGroupId);
  const activeTerrainId = useUi((state) => state.activeTerrainId);
  const snapToGrid = useUi((state) => state.snapToGrid);
  const showGrid = useUi((state) => state.showGrid);
  const sceneView = useUi((state) => state.sceneView[scene?.id ?? ""] ?? "2d");
  const paletteId = scene?.palette ?? "";
  const paletteColors = useServer((state) =>
    paletteId ? (state.paletteColors[paletteId] ?? EMPTY_PALETTE) : EMPTY_PALETTE
  );

  useEffect(() => {
    if (paletteId) void useServer.getState().ensurePalette(paletteId);
  }, [paletteId]);

  const sceneId = scene?.id ?? "";
  const unitsPerCell = scene?.unitsPerCell ?? 1;
  const camera = useUi((state) => state.camera[sceneId] ?? DEFAULT_CAMERA);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });
  const [dropping, setDropping] = useState(false);

  /**
   * A drag renders from here and writes to the document once, on pointerup.
   * Writing per pointermove made every pan a hundred undo steps and a hundred
   * network updates, and gave a collaborator a hundred merges to apply.
   */
  const [preview, setPreview] = useState<DragPreview | null>(null);

  const dragRef = useRef<{
    mode: "pan" | "item" | "group" | "terrain" | "resize" | "rotate";
    targetId?: string;
    corner?: ResizeCorner;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originWidth?: number;
    originHeight?: number;
    originRotation?: number;
    x: number;
    y: number;
    width?: number;
    height?: number;
    rotation?: number;
  } | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (anyModalOpen()) return;

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }

      const sceneId = activeSceneId();
      if (!sceneId) return;

      const { activeGroupId, activeItemId, activeTerrainId } = useUi.getState();

      if (activeTerrainId) {
        event.preventDefault();
        useDoc.getState().removeTerrain(sceneId, activeTerrainId);
        useUi.getState().setActiveTerrain(null);
        return;
      }

      if (activeGroupId) {
        event.preventDefault();
        useDoc.getState().removeGroup(sceneId, activeGroupId);
        useUi.getState().setActiveGroup(null);
        return;
      }

      if (activeItemId) {
        event.preventDefault();
        useDoc.getState().removeItem(sceneId, activeItemId);
        useUi.getState().setActiveItem(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const screenToWorld = useCallback(
    (screenX: number, screenY: number) => ({
      x: (screenX - viewport.width / 2) / camera.zoom + camera.x,
      y: (screenY - viewport.height / 2) / camera.zoom + camera.y
    }),
    [camera.x, camera.y, camera.zoom, viewport.height, viewport.width]
  );

  const onWheel = (event: React.WheelEvent) => {
    event.preventDefault();

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const before = screenToWorld(pointerX, pointerY);

    const factor = Math.exp(-event.deltaY * 0.0015);
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor));

    const afterX = (pointerX - viewport.width / 2) / zoom + camera.x;
    const afterY = (pointerY - viewport.height / 2) / zoom + camera.y;

    useUi.getState().setCamera(sceneId, {
      zoom,
      x: camera.x + (before.x - afterX),
      y: camera.y + (before.y - afterY)
    });
  };

  const onItemPointerDown = (event: React.PointerEvent, item: StagedItem) => {
    if (event.button !== 0 || event.altKey) return;

    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);

    useUi.getState().setActiveItem(item.id);
    dragRef.current = {
      mode: "item",
      targetId: item.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: item.x,
      originY: item.y,
      x: item.x,
      y: item.y
    };
  };

  const onResizePointerDown = (
    event: React.PointerEvent,
    item: StagedItem,
    corner: ResizeCorner,
    size: Size
  ) => {
    if (event.button !== 0 || event.altKey) return;

    event.preventDefault();
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);

    useUi.getState().setActiveItem(item.id);
    dragRef.current = {
      mode: "resize",
      targetId: item.id,
      corner,
      startX: event.clientX,
      startY: event.clientY,
      originX: item.x,
      originY: item.y,
      originWidth: Math.max(1, size.width),
      originHeight: Math.max(1, size.height),
      originRotation: item.rotation,
      x: item.x,
      y: item.y,
      width: Math.max(1, size.width),
      height: Math.max(1, size.height),
      rotation: item.rotation
    };
  };

  const onRotatePointerDown = (event: React.PointerEvent, item: StagedItem, size: Size) => {
    if (event.button !== 0 || event.altKey) return;

    event.preventDefault();
    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);

    useUi.getState().setActiveItem(item.id);
    dragRef.current = {
      mode: "rotate",
      targetId: item.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: item.x,
      originY: item.y,
      originWidth: Math.max(1, size.width),
      originHeight: Math.max(1, size.height),
      originRotation: item.rotation,
      x: item.x,
      y: item.y,
      rotation: item.rotation
    };
  };

  const onGroupPointerDown = (event: React.PointerEvent, group: RepeatGroup) => {
    if (event.button !== 0 || event.altKey) return;

    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);

    useUi.getState().setActiveGroup(group.id);
    dragRef.current = {
      mode: "group",
      targetId: group.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: group.x,
      originY: group.y,
      x: group.x,
      y: group.y
    };
  };

  const onTerrainPointerDown = (event: React.PointerEvent, terrain: TerrainGroup) => {
    if (event.button !== 0 || event.altKey) return;

    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);

    useUi.getState().setActiveTerrain(terrain.id);
    dragRef.current = {
      mode: "terrain",
      targetId: terrain.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: terrain.x,
      originY: terrain.y,
      x: terrain.x,
      y: terrain.y
    };
  };

  const onBackgroundPointerDown = (event: React.PointerEvent) => {
    if (event.button === 0 && !event.altKey) {
      useUi.getState().setActiveItem(null);
      useUi.getState().setActiveGroup(null);
      useUi.getState().setActiveTerrain(null);
    }

    dragRef.current = {
      mode: "pan",
      startX: event.clientX,
      startY: event.clientY,
      originX: camera.x,
      originY: camera.y,
      x: camera.x,
      y: camera.y
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    const deltaX = (event.clientX - drag.startX) / camera.zoom;
    const deltaY = (event.clientY - drag.startY) / camera.zoom;

    if (drag.mode === "pan") {
      useUi.getState().setCamera(sceneId, {
        x: drag.originX - deltaX,
        y: drag.originY - deltaY
      });
      return;
    }

    if (!drag.targetId) return;

    if (
      drag.mode === "rotate" &&
      drag.originWidth !== undefined &&
      drag.originHeight !== undefined
    ) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const pointer = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      const next = rotateFromCenter(
        {
          x: drag.originX + drag.originWidth / 2,
          y: drag.originY + drag.originHeight / 2
        },
        pointer,
        snapToGrid ? 15 : 0
      );

      drag.rotation = next;
      setPreview({ targetId: drag.targetId, x: drag.originX, y: drag.originY, rotation: next });
      return;
    }

    if (
      drag.mode === "resize" &&
      drag.corner &&
      drag.originWidth !== undefined &&
      drag.originHeight !== undefined
    ) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const pointer = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      const next = resizeFromCorner(
        {
          x: drag.originX,
          y: drag.originY,
          width: drag.originWidth,
          height: drag.originHeight
        },
        drag.corner,
        pointer,
        {
          lockAspect: useUi.getState().lockFootprintAspect,
          snap: snapToGrid ? unitsPerCell : undefined,
          rotation: drag.originRotation ?? 0
        }
      );

      drag.x = next.x;
      drag.y = next.y;
      drag.width = next.width;
      drag.height = next.height;
      setPreview({
        targetId: drag.targetId,
        x: next.x,
        y: next.y,
        footprint: { width: next.width, height: next.height },
        rotation: drag.originRotation
      });
      return;
    }

    const rawX = drag.originX + deltaX;
    const rawY = drag.originY + deltaY;
    const next = snapToGrid
      ? snapPointToGrid({ x: rawX, y: rawY }, unitsPerCell)
      : { x: rawX, y: rawY };

    drag.x = next.x;
    drag.y = next.y;

    setPreview({ targetId: drag.targetId, x: drag.x, y: drag.y });
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setPreview(null);

    if (!drag?.targetId || drag.mode === "pan") return;

    if (drag.mode === "rotate") {
      if (drag.rotation === drag.originRotation) return;
      patchItem(drag.targetId, { rotation: drag.rotation ?? 0 });
      return;
    }

    if (drag.mode === "resize") {
      if (
        drag.x === drag.originX &&
        drag.y === drag.originY &&
        drag.width === drag.originWidth &&
        drag.height === drag.originHeight
      ) {
        return;
      }

      patchItem(drag.targetId, {
        x: drag.x,
        y: drag.y,
        footprint: { width: drag.width ?? 1, height: drag.height ?? 1 }
      });
      return;
    }

    if (drag.x === drag.originX && drag.y === drag.originY) return;

    const moved = { x: drag.x, y: drag.y };

    if (drag.mode === "group") patchGroup(drag.targetId, moved);
    else if (drag.mode === "terrain") patchTerrain(drag.targetId, moved);
    else patchItem(drag.targetId, moved);
  };

  const onDrop = (event: React.DragEvent) => {
    if (!isAssetDrag(event)) return;

    event.preventDefault();
    setDropping(false);

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const at = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    const position = snapToGrid
      ? snapPointToGrid(at, unitsPerCell)
      : at;

    stageAssets(readAssetDrag(event), position, snapToGrid ? unitsPerCell : 8);
  };

  if (!scene) return null;

  const cellPixels = scene.unitsPerCell * camera.zoom;
  const gridOffsetX = (-camera.x * camera.zoom + viewport.width / 2) % cellPixels;
  const gridOffsetY = (-camera.y * camera.zoom + viewport.height / 2) % cellPixels;

  const activeItem = scene.items.find((item) => item.id === activeItemId) ?? null;
  const activeAsset = activeItem
    ? assets.find((entry) => entry.id === activeItem.assetId) ?? null
    : null;
  const activeGroup = scene.groups.find((group) => group.id === activeGroupId) ?? null;
  const activeTerrain = scene.terrains.find((terrain) => terrain.id === activeTerrainId) ?? null;

  /** Applies an in-flight drag on top of what the document says. */
  const dragged = <T extends { id: string; x: number; y: number }>(entry: T): T => {
    if (!preview || preview.targetId !== entry.id) return entry;
    return {
      ...entry,
      x: preview.x,
      y: preview.y,
      ...("footprint" in entry && preview.footprint ? { footprint: preview.footprint } : {}),
      ...("rotation" in entry && preview.rotation !== undefined ? { rotation: preview.rotation } : {})
    };
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        {sceneView === "terrain" ? (
          <TerrainView sceneId={scene.id} terrains={scene.terrains.map(dragged)} palette={paletteColors} />
        ) : (
          <div
            ref={containerRef}
            onWheel={onWheel}
            onPointerDown={onBackgroundPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDragOver={(event) => {
              if (!isAssetDrag(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setDropping(true);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(event.relatedTarget as Node)) return;
              setDropping(false);
            }}
            onDrop={onDrop}
            className="absolute inset-0 overflow-hidden"
            style={{
              background: "#0f1218",
              backgroundImage: showGrid
                ? `linear-gradient(to right, #1c2230 1px, transparent 1px), linear-gradient(to bottom, #1c2230 1px, transparent 1px)`
                : undefined,
              backgroundSize: showGrid ? `${cellPixels}px ${cellPixels}px` : undefined,
              backgroundPosition: showGrid ? `${gridOffsetX}px ${gridOffsetY}px` : undefined,
              cursor: "grab",
              touchAction: "none",
              zIndex: 0,
              boxShadow: dropping ? "inset 0 0 0 2px var(--color-accent)" : undefined
            }}
          >
            <div
              style={{
                position: "absolute",
                left: (0 - camera.x) * camera.zoom + viewport.width / 2,
                top: (0 - camera.y) * camera.zoom + viewport.height / 2,
                width: 1,
                height: 1,
                boxShadow: "0 0 0 1px #3c4657",
                pointerEvents: "none"
              }}
            />

            {scene.terrains.map((terrain) => (
              <TerrainLayer
                key={terrain.id}
                terrain={dragged(terrain)}
                assets={assets}
                viewport={viewport}
                camera={camera}
                active={terrain.id === activeTerrainId}
                onPointerDown={onTerrainPointerDown}
              />
            ))}

            {scene.groups.map((group) => (
              <GroupLayer
                key={group.id}
                group={dragged(group)}
                assets={assets}
                viewport={viewport}
                camera={camera}
                active={group.id === activeGroupId}
                onPointerDown={onGroupPointerDown}
              />
            ))}

            {scene.items.map((item) => {
              const asset = assets.find((entry) => entry.id === item.assetId);
              if (!asset) return null;

              return (
                <StagedSprite
                  key={item.id}
                  item={dragged(item)}
                  asset={asset}
                  viewport={viewport}
                  camera={camera}
                  active={item.id === activeItemId}
                  onPointerDown={onItemPointerDown}
                  onResizePointerDown={onResizePointerDown}
                  onRotatePointerDown={onRotatePointerDown}
                />
              );
            })}
          </div>
        )}

        {/*
          One overlay for all four corners rather than four self-positioning
          bubbles. Flex is what makes them share space: opening View pushes
          Scenes right instead of hiding under it, and each row has a definite
          height, so a bubble too tall for it scrolls rather than overflowing
          the canvas. Clicks fall through the gaps to the canvas beneath.
        */}
        <div className="pointer-events-none absolute inset-3 z-20 flex flex-col gap-2">
          <div className="flex min-h-0 flex-1 items-start gap-2">
            <ViewBubble />
            <ScenesBubble />
            <span className="flex-1" />
            <SceneViewTabs sceneId={scene.id} />
            <span className="flex-1" />
            <ElementsBubble />
          </div>

          <div className="flex min-h-0 flex-1 items-end gap-2">
            <SceneTreeBubble />
            <span className="flex-1" />

            {activeTerrain ? (
              <TerrainControls terrain={activeTerrain} assets={assets} />
            ) : activeGroup ? (
              <GroupControls group={activeGroup} assets={assets} />
            ) : activeItem && activeAsset ? (
              <StagedItemControls item={activeItem} asset={activeAsset} />
            ) : (
              <span className="self-end text-[10px] text-slate-600">
                {sceneView === "terrain"
                  ? "drag to orbit, wheel to zoom"
                  : "wheel to zoom, drag the background to pan, drag a sprite to move it"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SceneViewTabs({ sceneId }: { sceneId: string }) {
  const view = useUi((state) => state.sceneView[sceneId] ?? "2d");

  return (
    <div className="pointer-events-auto flex rounded-lg border border-[var(--color-edge)] bg-[var(--color-ink-800)]/95 p-0.5 shadow-xl backdrop-blur-sm">
      <Button
        variant={view === "2d" ? "primary" : "ghost"}
        title="The 2D scene grid"
        onClick={() => useUi.getState().setSceneView(sceneId, "2d")}
      >
        2D
      </Button>
      <Button
        variant={view === "terrain" ? "primary" : "ghost"}
        title="Full-canvas 3D terrain viewer"
        onClick={() => useUi.getState().setSceneView(sceneId, "terrain")}
      >
        Terrain
      </Button>
    </div>
  );
}

function StagedItemControls({ item, asset }: { item: StagedItem; asset: ResolvedAsset }) {
  const locked = useUi((state) => state.lockFootprintAspect);
  const editingAspect = useRef<number | null>(null);

  const sequences = asset.sequences.filter((entry) => entry.frames.length > 0);
  const sequence =
    sequences.find((entry) => entry.id === item.sequenceId) ?? sequences[0] ?? null;
  const sequenceLabels = Object.fromEntries(
    sequences.map((entry) => [entry.id, entry.name.trim() || "untitled"])
  );

  const currentAspect = () => {
    if (editingAspect.current !== null) return editingAspect.current;
    if (item.footprint.width > 0 && item.footprint.height > 0) {
      return item.footprint.width / item.footprint.height;
    }
    return 1;
  };

  const holdAspect = () => {
    editingAspect.current =
      item.footprint.width > 0 && item.footprint.height > 0
        ? item.footprint.width / item.footprint.height
        : 1;
  };

  const releaseAspect = () => {
    editingAspect.current = null;
  };

  const setFootprint = (edge: "width" | "height", raw: number) => {
    const value = Math.max(1, raw);
    const aspect = currentAspect();

    const footprint =
      edge === "width"
        ? {
            width: value,
            height: locked ? Math.max(1, Math.round(value / aspect)) : item.footprint.height
          }
        : {
            width: locked ? Math.max(1, Math.round(value * aspect)) : item.footprint.width,
            height: value
          };

    patchItem(item.id, { footprint });
  };

  return (
    <div
      className="pointer-events-auto max-h-full w-64 overflow-y-auto rounded-lg border border-[var(--color-edge)] bg-[var(--color-ink-800)]/95 p-2 shadow-xl backdrop-blur-sm"
      style={{ zIndex: 1 }}
    >
      <Row className="mb-2">
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-300">{asset.label}</span>
        <TextButton
          title="Select this asset in the inspector"
          onClick={() => {
            const ui = useUi.getState();
            ui.select(asset.id, false);
            if (item.sequenceId) ui.setActiveSequence(item.sequenceId);
            if (ui.layout.collapsed.right) ui.togglePane("right");
          }}
        >
          inspect
        </TextButton>
        <TextButton
          danger
          title="Take this off the scene. The art stays in your library"
          onClick={() => {
            const sceneId = activeSceneId();
            if (!sceneId) return;

            useDoc.getState().removeItem(sceneId, item.id);
            useUi.getState().setActiveItem(null);
          }}
        >
          remove
        </TextButton>
      </Row>

      <Button
        className="mb-2 w-full"
        title="Turn this sprite into a 3×3 repeater at the same spot. You can add more art to the mix after"
        onClick={() => convertToRepeater(item.id)}
      >
        convert to repeater
      </Button>

      {sequence && isSetAsset(asset) ? (
        <div className="mb-2">
          <Row className="mb-2">
            {(
              [
                ["sheet", "Sheet"],
                ["pick", "Pick"],
                ["cycle", "Cycle"]
              ] as const
            ).map(([mode, label]) => {
              const current =
                item.display === "sheet" ? "sheet" : item.paused ? "pick" : "cycle";

              return (
                <Button
                  key={mode}
                  variant={current === mode ? "primary" : "ghost"}
                  onClick={() =>
                    patchItem(item.id, {
                      display: mode === "sheet" ? "sheet" : "cell",
                      paused: mode !== "cycle"
                    })
                  }
                >
                  {label}
                </Button>
              );
            })}
          </Row>

          {item.display !== "sheet" && item.paused && sequence.frames.length > 0 ? (
            <label className="mb-2 block text-[10px] tracking-wide text-slate-400 uppercase">
              item
              <Select
                value={String(Math.min(item.heldFrame, sequence.frames.length - 1))}
                options={sequence.frames.map((_, index) => String(index))}
                labels={Object.fromEntries(
                  sequence.frames.map((_, index) => [String(index), String(index + 1)])
                )}
                onChange={(value) => patchItem(item.id, { heldFrame: Number(value) })}
              />
            </label>
          ) : null}
        </div>
      ) : sequence ? (
        <div className="mb-2">
          <Toggle
            label="play"
            checked={!item.paused}
            onChange={(play) => patchItem(item.id, { paused: !play })}
          />

          <label className="mb-2 block text-[10px] tracking-wide text-slate-400 uppercase">
            animation
            <Select
              value={sequence.id}
              options={sequences.map((entry) => entry.id)}
              labels={sequenceLabels}
              onChange={(sequenceId) => {
                const next = sequences.find((entry) => entry.id === sequenceId);
                const last = Math.max(0, (next?.frames.length ?? 1) - 1);
                patchItem(item.id, {
                  sequenceId,
                  heldFrame: Math.min(item.heldFrame, last)
                });
              }}
            />
          </label>

          {item.paused && sequence.frames.length > 0 ? (
            <label className="mb-2 block text-[10px] tracking-wide text-slate-400 uppercase">
              frame
              <Select
                value={String(Math.min(item.heldFrame, sequence.frames.length - 1))}
                options={sequence.frames.map((_, index) => String(index))}
                labels={Object.fromEntries(
                  sequence.frames.map((_, index) => [String(index), String(index + 1)])
                )}
                onChange={(value) => patchItem(item.id, { heldFrame: Number(value) })}
              />
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="mb-2 flex items-end gap-1">
        <label className="min-w-0 flex-1 text-[10px] tracking-wide text-slate-400 uppercase">
          footprint w
          <NumberInput
            min={1}
            value={item.footprint.width}
            onFocus={holdAspect}
            onBlur={releaseAspect}
            onChange={(value) => setFootprint("width", value)}
          />
        </label>

        <Button
          variant={locked ? "primary" : "ghost"}
          className="mb-[1px] shrink-0"
          title={
            locked
              ? "Proportions locked: editing one edge scales the other"
              : "Proportions free: edges move independently"
          }
          onClick={() => useUi.getState().toggleFootprintLock()}
        >
          {locked ? "\u{1F512}" : "\u{1F513}"}
        </Button>

        <label className="min-w-0 flex-1 text-[10px] tracking-wide text-slate-400 uppercase">
          footprint h
          <NumberInput
            min={1}
            value={item.footprint.height}
            onFocus={holdAspect}
            onBlur={releaseAspect}
            onChange={(value) => setFootprint("height", value)}
          />
        </label>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-2">
        <label className="text-[10px] tracking-wide text-slate-400 uppercase">
          x
          <NumberInput
            value={item.x}
            onChange={(value) => patchItem(item.id, { x: value })}
          />
        </label>
        <label className="text-[10px] tracking-wide text-slate-400 uppercase">
          y
          <NumberInput
            value={item.y}
            onChange={(value) => patchItem(item.id, { y: value })}
          />
        </label>
        <label className="text-[10px] tracking-wide text-slate-400 uppercase">
          rotation
          <NumberInput
            integer
            value={item.rotation}
            onChange={(value) => patchItem(item.id, { rotation: value })}
          />
        </label>
        <label className="text-[10px] tracking-wide text-slate-400 uppercase">
          z index
          <NumberInput
            integer
            value={item.zIndex}
            onChange={(value) => patchItem(item.id, { zIndex: value })}
          />
        </label>
        <label className="text-[10px] tracking-wide text-slate-400 uppercase">
          opacity
          <NumberInput
            min={0}
            max={1}
            step={0.1}
            value={item.opacity}
            onChange={(value) => patchItem(item.id, { opacity: value })}
          />
        </label>
      </div>

      <Row className="mb-2">
        {([0, 90, 180, 270] as const).map((deg) => (
          <Button
            key={deg}
            variant={item.rotation === deg ? "primary" : "ghost"}
            title={`Set rotation to ${deg}°`}
            onClick={() => patchItem(item.id, { rotation: deg })}
          >
            {deg}°
          </Button>
        ))}
      </Row>

      <Row className="mb-2 flex-wrap">
        <Button
          variant={item.flipHorizontal ? "primary" : "ghost"}
          onClick={() => patchItem(item.id, { flipHorizontal: !item.flipHorizontal })}
        >
          flip x
        </Button>
        <Button
          variant={item.flipVertical ? "primary" : "ghost"}
          onClick={() => patchItem(item.id, { flipVertical: !item.flipVertical })}
        >
          flip y
        </Button>
        <Button
          variant={item.isoTurn ? "primary" : "ghost"}
          title="Yaw 90° on the 2:1 diamond (SE → NE → NW → SW). Flip X is the other pair."
          onClick={() => patchItem(item.id, { isoTurn: clampIsoTurn(item.isoTurn + 1) })}
        >
          {item.isoTurn ? `iso ${item.isoTurn * 90}` : "iso turn"}
        </Button>
        <Button
          variant={item.showSource ? "primary" : "ghost"}
          onClick={() => patchItem(item.id, { showSource: !item.showSource })}
        >
          raw
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            const sceneId = activeSceneId();
            if (sceneId) useDoc.getState().bringToFront(sceneId, item.id);
          }}
        >
          front
        </Button>
      </Row>

      <Row className="flex-wrap">
        <Button
          variant="ghost"
          title="Match the box to the processed pixel size, so one play unit is one texture pixel"
          onClick={() => patchItem(item.id, { footprint: { width: 0, height: 0 } })}
        >
          reset box to pixels
        </Button>
        <Button
          variant="ghost"
          title="Bake this box into the asset so it downsamples and pixelizes to that size"
          disabled={item.footprint.width < 1 || item.footprint.height < 1}
          onClick={() =>
            useDoc.getState().patchProcessing(asset.id, {
              targetSize: {
                width: Math.round(item.footprint.width),
                height: Math.round(item.footprint.height)
              }
            })
          }
        >
          pixelize asset to box
        </Button>
      </Row>
    </div>
  );
}

function GroupControls({ group, assets }: { group: RepeatGroup; assets: ResolvedAsset[] }) {
  const [dropping, setDropping] = useState(false);

  const patch = (change: Partial<RepeatGroup>) => patchGroup(group.id, change);

  const members = group.assetIds
    .map((id) => assets.find((asset) => asset.id === id))
    .filter((asset): asset is ResolvedAsset => asset !== undefined);

  return (
    <div
      onDragOver={(event) => {
        if (!isAssetDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDropping(false);
      }}
      onDrop={(event) => {
        if (!isAssetDrag(event)) return;
        event.preventDefault();
        setDropping(false);
        addToGroup(group.id, readAssetDrag(event));
      }}
      className={`pointer-events-auto max-h-full w-72 overflow-y-auto rounded-lg border bg-[var(--color-ink-800)]/95 p-2 shadow-xl backdrop-blur-sm ${
        dropping ? "border-[var(--color-accent)]" : "border-[var(--color-edge)]"
      }`}
      style={{ zIndex: 1 }}
    >
      <Row className="mb-2 justify-between">
        <input
          value={group.name}
          placeholder={repeaterLabel({ ...group, name: "" })}
          title="What the scene tree calls this repeater"
          onChange={(event) => patch({ name: event.target.value })}
          className="min-w-0 flex-1"
        />
        <TextButton
          danger
          title="Take this repeater off the scene. The art stays in your library"
          onClick={() => {
            const sceneId = activeSceneId();
            if (!sceneId) return;

            useDoc.getState().removeGroup(sceneId, group.id);
            useUi.getState().setActiveGroup(null);
          }}
        >
          remove
        </TextButton>
      </Row>

      <p className="mb-2 text-[10px] leading-snug text-slate-500">
        {members.length} asset(s). Drag thumbnails from the library onto this panel or onto the
        tiles to add them to the mix.
      </p>

      <div className="mb-2 flex flex-wrap gap-1">
        {members.map((asset) => (
          <span
            key={asset.id}
            className="flex items-center gap-1 rounded border border-[var(--color-edge)] bg-[var(--color-ink-600)] px-1 py-0.5 text-[10px] text-slate-300"
          >
            <span className="max-w-[7rem] truncate">{asset.label}</span>
            {members.length > 1 ? (
              <TextButton
                danger
                title="Drop this asset from the mix"
                onClick={() => {
                  const sceneId = activeSceneId();
                  if (!sceneId) return;

                  useDoc
                    .getState()
                    .setGroupAssets(
                      sceneId,
                      group.id,
                      group.assetIds.filter((entry) => entry !== asset.id)
                    );
                }}
              >
                &times;
              </TextButton>
            ) : null}
          </span>
        ))}
      </div>

      <Row className="mb-2">
        <Button
          title="Shuffle which asset lands where, and re-roll scatter and spin"
          onClick={() => patch({ seed: Math.floor(Math.random() * 1e9) })}
        >
          reshuffle
        </Button>
      </Row>

      <Row className="mb-2">
        {REPEATER_PLACEMENTS.map((placement) => (
          <Button
            key={placement}
            variant={group.placement === placement ? "primary" : "ghost"}
            title={
              placement === "scatter"
                ? "Throw stamps at random inside a rectangle"
                : placement === "iso"
                  ? "Tile on a 2:1 isometric diamond lattice"
                  : "Tile on a regular grid"
            }
            onClick={() => {
              if (placement === group.placement) return;
              if (placement !== "scatter") {
                patch({ placement });
                return;
              }

              const width =
                group.cell.width > 0
                  ? (group.cell.width + group.marginX) * group.countX - group.marginX
                  : group.areaWidth;
              const height =
                group.cell.height > 0
                  ? (group.cell.height + group.marginY) * group.countY - group.marginY
                  : group.areaHeight;

              patch({
                placement,
                areaWidth: Math.max(1, width),
                areaHeight: Math.max(1, height),
                scatterCount: Math.max(1, group.countX * group.countY)
              });
            }}
          >
            {REPEATER_PLACEMENT_LABELS[placement]}
          </Button>
        ))}
      </Row>

      <label className="mb-2 block text-[10px] tracking-wide text-slate-400 uppercase">
        spin
        <Select
          value={group.rotate}
          options={REPEATER_ROTATES}
          labels={REPEATER_ROTATE_LABELS}
          onChange={(rotate: RepeaterRotate) => patch({ rotate })}
        />
      </label>

      <div className="mb-2">
        <span className="mb-1 block text-[10px] tracking-wide text-slate-400 uppercase">
          backdrop
        </span>
        <ColorInput
          allowEmpty
          value={group.background}
          title="Colour painted behind the tiles, so gaps and transparent pixels do not show the canvas"
          onChange={(value) => patch({ background: value })}
        />
      </div>

      {group.placement === "scatter" ? (
        <div className="mb-2 grid grid-cols-2 gap-2">
          <label className="text-[10px] tracking-wide text-slate-400 uppercase">
            count
            <NumberInput
              integer
              min={1}
              title="How many stamps to throw in the rectangle"
              value={group.scatterCount}
              onChange={(value) => patch({ scatterCount: Math.max(1, value) })}
            />
          </label>
          <label className="text-[10px] tracking-wide text-slate-400 uppercase">
            min gap
            <NumberInput
              min={0}
              title="Minimum distance between stamps. 0 allows overlap"
              value={group.minGap}
              onChange={(value) => patch({ minGap: Math.max(0, value) })}
            />
          </label>
          <label className="text-[10px] tracking-wide text-slate-400 uppercase">
            area w
            <NumberInput
              min={1}
              title="Scatter rectangle width in play units"
              value={group.areaWidth}
              onChange={(value) => patch({ areaWidth: Math.max(1, value) })}
            />
          </label>
          <label className="text-[10px] tracking-wide text-slate-400 uppercase">
            area h
            <NumberInput
              min={1}
              title="Scatter rectangle height in play units"
              value={group.areaHeight}
              onChange={(value) => patch({ areaHeight: Math.max(1, value) })}
            />
          </label>
          <label className="text-[10px] tracking-wide text-slate-400 uppercase">
            size jitter
            <NumberInput
              min={0}
              max={1}
              step={0.05}
              title="0 is uniform size. 1 lets a stamp range from a sliver to double"
              value={group.scaleJitter}
              onChange={(value) => patch({ scaleJitter: Math.min(1, Math.max(0, value)) })}
            />
          </label>
          <label className="text-[10px] tracking-wide text-slate-400 uppercase">
            edge bias
            <NumberInput
              min={0}
              max={1}
              step={0.05}
              title="0 is uniform. 1 piles stamps on the rectangle's edges"
              value={group.edgeBias}
              onChange={(value) => patch({ edgeBias: Math.min(1, Math.max(0, value)) })}
            />
          </label>
        </div>
      ) : (
        (["x", "y"] as const).map((axis) => {
          const fill = axis === "x" ? group.fillX : group.fillY;
          const count = axis === "x" ? group.countX : group.countY;
          const margin = axis === "x" ? group.marginX : group.marginY;

          return (
            <Row key={axis} className="mb-1">
              <span className="w-3 shrink-0 text-[10px] text-slate-500 uppercase">{axis}</span>

              <NumberInput
                integer
                min={1}
                width={52}
                disabled={fill}
                title="How many copies along this axis"
                value={count}
                onChange={(value) => patch(axis === "x" ? { countX: value } : { countY: value })}
              />

              <NumberInput
                width={62}
                title="Gap between copies in play units, negative to overlap"
                value={margin}
                onChange={(value) => patch(axis === "x" ? { marginX: value } : { marginY: value })}
              />

              <Button
                variant={fill ? "primary" : "ghost"}
                title="Keep repeating past the edges of the view"
                onClick={() => patch(axis === "x" ? { fillX: !group.fillX } : { fillY: !group.fillY })}
              >
                fill
              </Button>
            </Row>
          );
        })
      )}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-[10px] tracking-wide text-slate-400 uppercase">
          cell w
          <NumberInput
            min={0}
            title={
              group.placement === "iso"
                ? "Diamond width. Height of the tile footprint is half of this (2:1)"
                : "0 follows the other edge at the asset's aspect ratio, or its pixel size if both are 0"
            }
            value={group.cell.width}
            onChange={(value) => patch({ cell: { ...group.cell, width: value } })}
          />
        </label>
        <label className="text-[10px] tracking-wide text-slate-400 uppercase">
          cell h
          <NumberInput
            min={0}
            title={
              group.placement === "iso"
                ? "Art box height. Taller than half the width hangs the sprite north of the diamond"
                : "0 follows the other edge at the asset's aspect ratio, or its pixel size if both are 0"
            }
            value={group.cell.height}
            onChange={(value) => patch({ cell: { ...group.cell, height: value } })}
          />
        </label>
        <label className="text-[10px] tracking-wide text-slate-400 uppercase">
          z index
          <NumberInput integer value={group.zIndex} onChange={(value) => patch({ zIndex: value })} />
        </label>
        <label className="text-[10px] tracking-wide text-slate-400 uppercase">
          opacity
          <NumberInput
            min={0}
            max={1}
            step={0.1}
            value={group.opacity}
            onChange={(value) => patch({ opacity: value })}
          />
        </label>
        {group.placement !== "scatter" ? (
          <label className="text-[10px] tracking-wide text-slate-400 uppercase">
            size jitter
            <NumberInput
              min={0}
              max={1}
              step={0.05}
              title="0 is uniform size. 1 lets a stamp range from a sliver to double"
              value={group.scaleJitter}
              onChange={(value) => patch({ scaleJitter: Math.min(1, Math.max(0, value)) })}
            />
          </label>
        ) : null}
      </div>
    </div>
  );
}

function TerrainLayer({
  terrain,
  assets,
  viewport,
  camera,
  active,
  onPointerDown
}: {
  terrain: TerrainGroup;
  assets: ResolvedAsset[];
  viewport: Viewport;
  camera: { x: number; y: number; zoom: number };
  active: boolean;
  onPointerDown: (event: React.PointerEvent, terrain: TerrainGroup) => void;
}) {
  const extent = terrainExtent(terrain);
  const countX = clampTerrainCount(terrain.countX);
  const countY = clampTerrainCount(terrain.countY);
  const left = (terrain.x - camera.x) * camera.zoom + viewport.width / 2;
  const top = (terrain.y - camera.y) * camera.zoom + viewport.height / 2;
  const width = Math.max(48, extent.width * camera.zoom);
  const height = Math.max(48, extent.height * camera.zoom);

  return (
    <div
      onPointerDown={(event) => onPointerDown(event, terrain)}
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        zIndex: terrain.zIndex,
        border: `1px dashed ${active ? "var(--color-accent)" : "#4a5565"}`,
        cursor: "grab",
        touchAction: "none",
        display: "grid",
        gridTemplateColumns: `repeat(${countX}, 1fr)`,
        gridTemplateRows: `repeat(${countY}, 1fr)`
      }}
    >
      {Array.from({ length: countX * countY }, (_, index) => {
        const tile = terrain.tiles[index];
        const heightAsset = tile?.heightAssetId
          ? assets.find((asset) => asset.id === tile.heightAssetId)
          : undefined;

        return (
          <div
            key={index}
            onDragOver={(event) => {
              if (!isAssetDrag(event)) return;
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(event) => {
              if (!isAssetDrag(event)) return;
              event.preventDefault();
              event.stopPropagation();
              const [assetId] = readAssetDrag(event);
              if (assetId) setTerrainTile(terrain.id, index, { heightAssetId: assetId });
              useUi.getState().setActiveTerrain(terrain.id);
            }}
            className="flex items-center justify-center overflow-hidden border border-[#2a3344] bg-[#141820]/80"
          >
            {heightAsset ? (
              <AssetThumb asset={heightAsset} size={Math.max(24, Math.min(width / countX, height / countY) - 4)} />
            ) : (
              <span className="px-1 text-center text-[9px] leading-tight text-slate-500">height</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TerrainControls({
  terrain,
  assets
}: {
  terrain: TerrainGroup;
  assets: ResolvedAsset[];
}) {
  const [dropping, setDropping] = useState(false);
  const countX = clampTerrainCount(terrain.countX);
  const countY = clampTerrainCount(terrain.countY);

  const patch = (change: Partial<TerrainGroup>) => patchTerrain(terrain.id, change);

  return (
    <div
      onDragOver={(event) => {
        if (!isAssetDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDropping(false);
      }}
      onDrop={(event) => {
        if (!isAssetDrag(event)) return;
        event.preventDefault();
        setDropping(false);
        const [assetId] = readAssetDrag(event);
        if (!assetId) return;
        const empty = terrain.tiles.findIndex((tile) => !tile.heightAssetId);
        setTerrainTile(terrain.id, empty >= 0 ? empty : 0, { heightAssetId: assetId });
      }}
      className={`pointer-events-auto max-h-full w-72 overflow-y-auto rounded-lg border bg-[var(--color-ink-800)]/95 p-2 shadow-xl backdrop-blur-sm ${
        dropping ? "border-[var(--color-accent)]" : "border-[var(--color-edge)]"
      }`}
      style={{ zIndex: 1 }}
    >
      <Row className="mb-2 justify-between">
        <input
          value={terrain.name}
          placeholder={terrainLabel({ ...terrain, name: "" })}
          title="What the scene tree calls this terrain"
          onChange={(event) => patch({ name: event.target.value })}
          className="min-w-0 flex-1"
        />
        <TextButton
          danger
          title="Take this terrain off the scene. The art stays in your library"
          onClick={() => {
            const sceneId = activeSceneId();
            if (!sceneId) return;
            useDoc.getState().removeTerrain(sceneId, terrain.id);
            useUi.getState().setActiveTerrain(null);
          }}
        >
          remove
        </TextButton>
      </Row>

      <p className="mb-2 text-[10px] leading-snug text-slate-500">
        Drop a heightmap onto a cell. Optional colour is a top-down albedo for that same cell.
      </p>

      <div className="mb-2 grid grid-cols-2 gap-2">
        <label className="text-[10px] tracking-wide text-slate-400 uppercase">
          columns
          <NumberInput
            integer
            min={1}
            max={MAX_TERRAIN_TILES}
            value={countX}
            onChange={(value) => patch({ countX: clampTerrainCount(value) })}
          />
        </label>
        <label className="text-[10px] tracking-wide text-slate-400 uppercase">
          rows
          <NumberInput
            integer
            min={1}
            max={MAX_TERRAIN_TILES}
            value={countY}
            onChange={(value) => patch({ countY: clampTerrainCount(value) })}
          />
        </label>
        <label className="text-[10px] tracking-wide text-slate-400 uppercase">
          tile size
          <NumberInput
            min={1}
            value={terrain.tileSize}
            onChange={(value) => patch({ tileSize: Math.max(1, value) })}
          />
        </label>
        <label className="text-[10px] tracking-wide text-slate-400 uppercase">
          samples
          <NumberInput
            integer
            min={2}
            max={MAX_TERRAIN_DETAIL}
            title="Verts along the long edge of each tile. 512 is the default; raise it if the heightmap has more detail you want to keep"
            value={terrain.samples}
            onChange={(value) => patch({ samples: clampTerrainSamples(value) })}
          />
        </label>
        <label className="text-[10px] tracking-wide text-slate-400 uppercase">
          sea
          <NumberInput value={terrain.seaLevel} onChange={(value) => patch({ seaLevel: value })} />
        </label>
        <label className="text-[10px] tracking-wide text-slate-400 uppercase">
          low
          <NumberInput
            title="Black on the heightmap"
            value={terrain.low}
            onChange={(value) => patch({ low: value })}
          />
        </label>
        <label className="text-[10px] tracking-wide text-slate-400 uppercase">
          high
          <NumberInput
            title="White on the heightmap"
            value={terrain.high}
            onChange={(value) => patch({ high: value })}
          />
        </label>
      </div>

      <label className="mb-2 block text-[10px] tracking-wide text-slate-400 uppercase">
        gradient
        <Select
          value={terrain.gradientId}
          options={TERRAIN_GRADIENTS}
          labels={TERRAIN_GRADIENT_LABELS}
          onChange={(gradientId: TerrainGradientId) => patch({ gradientId })}
        />
      </label>

      <Toggle
        label="flatten below sea"
        checked={terrain.flattenSea}
        onChange={(flattenSea) => patch({ flattenSea })}
      />

      <div
        className="mb-1 grid gap-1"
        style={{ gridTemplateColumns: `repeat(${countX}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: countX * countY }, (_, index) => {
          const tile = terrain.tiles[index] ?? { heightAssetId: "", colorAssetId: "" };
          const heightAsset = tile.heightAssetId
            ? assets.find((asset) => asset.id === tile.heightAssetId)
            : undefined;
          const colorAsset = tile.colorAssetId
            ? assets.find((asset) => asset.id === tile.colorAssetId)
            : undefined;
          const col = index % countX;
          const row = Math.floor(index / countX);

          return (
            <div
              key={index}
              className="rounded border border-[var(--color-edge)] bg-[var(--color-ink-600)] p-1"
            >
              <div className="mb-1 text-[9px] text-slate-500">
                {col},{row}
              </div>
              <TerrainSlot
                label="height"
                asset={heightAsset}
                onDrop={(assetId) => setTerrainTile(terrain.id, index, { heightAssetId: assetId })}
                onClear={() => setTerrainTile(terrain.id, index, { heightAssetId: "" })}
              />
              <TerrainSlot
                label="color"
                asset={colorAsset}
                onDrop={(assetId) => setTerrainTile(terrain.id, index, { colorAssetId: assetId })}
                onClear={() => setTerrainTile(terrain.id, index, { colorAssetId: "" })}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TerrainSlot({
  label,
  asset,
  onDrop,
  onClear
}: {
  label: string;
  asset?: ResolvedAsset;
  onDrop: (assetId: string) => void;
  onClear: () => void;
}) {
  return (
    <div
      onDragOver={(event) => {
        if (!isAssetDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        if (!isAssetDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        const [assetId] = readAssetDrag(event);
        if (assetId) onDrop(assetId);
      }}
      className="mb-1 flex items-center gap-1 rounded border border-dashed border-[#3a4456] px-1 py-0.5"
    >
      {asset ? <AssetThumb asset={asset} size={28} /> : null}
      <span className="min-w-0 flex-1 truncate text-[10px] text-slate-400">
        {asset?.label ?? label}
      </span>
      {asset ? (
        <TextButton danger title={`Clear ${label}`} onClick={onClear}>
          &times;
        </TextButton>
      ) : null}
    </div>
  );
}
