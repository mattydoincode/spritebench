"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAssetDrag, readAssetDrag } from "@/client/dragAssets";
import { useStudio } from "@/client/store";
import { DITHER_MODES, type Size } from "@/core/types";
import type { AssetRecord, RepeatGroup, StagedItem } from "@/shared/model";
import { BitmapCanvas, useAssetPalette, useProcessed } from "./AssetBitmap";
import {
  anyModalOpen,
  Button,
  ColorInput,
  NumberInput,
  Row,
  Select,
  Slider,
  Toggle
} from "./ui";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 64;
const MAX_TILES = 900;
const MAX_TILES_PER_AXIS = 300;

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
const ROTATION_SALT = 0x5bf03635;

function resolveCell(cell: Size, natural: Size): Size {
  if (cell.width > 0 && cell.height > 0) return cell;

  const ratio =
    natural.width > 0 && natural.height > 0 ? natural.width / natural.height : 1;

  if (cell.width > 0) return { width: cell.width, height: cell.width / ratio };
  if (cell.height > 0) return { width: cell.height * ratio, height: cell.height };

  return natural;
}

function pickIndex(seed: number, column: number, row: number, count: number): number {
  if (count <= 1) return 0;

  let hash = (seed ^ Math.imul(column, 374761393) ^ Math.imul(row, 668265263)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;

  return hash % count;
}

interface Viewport {
  width: number;
  height: number;
}

function usePlaygroundAsset(asset: AssetRecord): AssetRecord {
  const palette = useStudio((state) => state.composition.palette);
  const dither = useStudio((state) => state.composition.paletteDither);
  const strength = useStudio((state) => state.composition.paletteDitherStrength);

  return useMemo(() => {
    if (palette === "" || asset.processing.paletteFile !== "") return asset;

    return {
      ...asset,
      processing: {
        ...asset.processing,
        paletteFile: palette,
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
  onPointerDown
}: {
  item: StagedItem;
  asset: AssetRecord;
  viewport: Viewport;
  camera: { x: number; y: number; zoom: number };
  active: boolean;
  onPointerDown: (event: React.PointerEvent, item: StagedItem) => void;
}) {
  const staged = usePlaygroundAsset(asset);
  const palette = useAssetPalette(staged);
  const { preview } = useProcessed(staged, palette, item.showSource);

  const bitmap = item.showSource ? preview?.sourceBitmap : preview?.processed;
  const naturalWidth = item.showSource ? preview?.sourceWidth ?? 0 : preview?.width ?? 0;
  const naturalHeight = item.showSource ? preview?.sourceHeight ?? 0 : preview?.height ?? 0;

  const autoFootprint = item.footprint.width <= 0 || item.footprint.height <= 0;

  useEffect(() => {
    if (!autoFootprint || preview === null || preview.width <= 0) return;

    useStudio.getState().updateItem(item.id, {
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
            transform: `scale(${item.flipHorizontal ? -1 : 1}, ${item.flipVertical ? -1 : 1})`,
            pointerEvents: "none"
          }}
        />
      ) : (
        <div className="h-full w-full rounded border border-dashed border-slate-600" />
      )}
    </div>
  );
}

interface Cell {
  column: number;
  row: number;
  x: number;
  y: number;
  rotation: number;
}

function GroupAssetTiles({
  group,
  asset,
  cells,
  cellWidth,
  cellHeight,
  viewport,
  camera,
  onReady,
  onPointerDown
}: {
  group: RepeatGroup;
  asset: AssetRecord;
  cells: Cell[];
  cellWidth: number;
  cellHeight: number;
  viewport: Viewport;
  camera: { x: number; y: number; zoom: number };
  onReady: (width: number, height: number) => void;
  onPointerDown: (event: React.PointerEvent, group: RepeatGroup) => void;
}) {
  const staged = usePlaygroundAsset(asset);
  const palette = useAssetPalette(staged);
  const { preview } = useProcessed(staged, palette);

  useEffect(() => {
    if (preview && preview.width > 0) onReady(preview.width, preview.height);
  }, [onReady, preview]);

  if (!preview) return null;

  const rectFor = (cell: Cell) => {
    const cellLeft = (cell.x - camera.x) * camera.zoom + viewport.width / 2;
    const cellTop = (cell.y - camera.y) * camera.zoom + viewport.height / 2;

    const left = Math.round(cellLeft);
    const top = Math.round(cellTop);
    const boxWidth = Math.round(cellLeft + cellWidth * camera.zoom) - left;
    const boxHeight = Math.round(cellTop + cellHeight * camera.zoom) - top;

    const quarter = cell.rotation === 90 || cell.rotation === 270;
    const fit = quarter
      ? Math.min(boxWidth / preview.height, boxHeight / preview.width)
      : Math.min(boxWidth / preview.width, boxHeight / preview.height);

    const width = preview.width * fit;
    const height = preview.height * fit;

    return {
      left: left + (boxWidth - width) / 2,
      top: top + (boxHeight - height) / 2,
      width,
      height
    };
  };

  return (
    <>
      {cells.map((cell) => {
        const draw = rectFor(cell);

        return (
        <div
          key={`${cell.column}:${cell.row}`}
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
            useStudio.getState().addToGroup(group.id, readAssetDrag(event));
          }}
          style={{
            position: "absolute",
            left: draw.left,
            top: draw.top,
            width: draw.width,
            height: draw.height,
            zIndex: group.zIndex,
            opacity: group.opacity,
            transform: cell.rotation === 0 ? undefined : `rotate(${cell.rotation}deg)`,
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
  assets: AssetRecord[];
  viewport: Viewport;
  camera: { x: number; y: number; zoom: number };
  active: boolean;
  onPointerDown: (event: React.PointerEvent, group: RepeatGroup) => void;
}) {
  const members = group.assetIds
    .map((id) => assets.find((asset) => asset.id === id))
    .filter((asset): asset is AssetRecord => asset !== undefined);

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
    const side = 48 * camera.zoom;

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
          useStudio.getState().addToGroup(group.id, readAssetDrag(event));
        }}
        className="flex items-center justify-center text-center text-[10px] leading-tight text-slate-400"
        style={{
          position: "absolute",
          left: originLeft,
          top: originTop,
          width: side,
          height: side,
          minWidth: 80,
          minHeight: 80,
          border: `1px dashed ${active ? "var(--color-accent)" : "#4a5565"}`,
          zIndex: group.zIndex,
          cursor: "grab",
          touchAction: "none"
        }}
      >
        drop art here
      </div>
    );
  }

  const stepX = cellWidth + group.marginX;
  const stepY = cellHeight + group.marginY;

  const columns = tileIndices(
    stepX,
    group.countX,
    group.fillX,
    group.x,
    cellWidth,
    camera.x - viewport.width / (2 * camera.zoom),
    camera.x + viewport.width / (2 * camera.zoom)
  );

  const rowBudget = Math.max(1, Math.floor(MAX_TILES / Math.max(1, columns.length)));
  const rows = tileIndices(
    stepY,
    group.countY,
    group.fillY,
    group.y,
    cellHeight,
    camera.y - viewport.height / (2 * camera.zoom),
    camera.y + viewport.height / (2 * camera.zoom)
  ).slice(0, rowBudget);

  const buckets = members.map<Cell[]>(() => []);

  if (cellWidth > 0 && cellHeight > 0) {
    for (const row of rows) {
      for (const column of columns) {
        const pick = pickIndex(group.seed, column, row, members.length);
        buckets[pick].push({
          column,
          row,
          x: group.x + column * stepX,
          y: group.y + row * stepY,
          rotation: group.randomRotate
            ? pickIndex(group.seed ^ ROTATION_SALT, column, row, 4) * 90
            : 0
        });
      }
    }
  }

  const backdrop =
    group.background && columns.length > 0 && rows.length > 0
      ? {
          left: (group.x + columns[0] * stepX - camera.x) * camera.zoom + viewport.width / 2,
          top: (group.y + rows[0] * stepY - camera.y) * camera.zoom + viewport.height / 2,
          width: ((columns[columns.length - 1] - columns[0]) * stepX + cellWidth) * camera.zoom,
          height: ((rows[rows.length - 1] - rows[0]) * stepY + cellHeight) * camera.zoom
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
            useStudio.getState().addToGroup(group.id, readAssetDrag(event));
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

      {active && cellWidth > 0 ? (
        <div
          style={{
            position: "absolute",
            left: originLeft - 2,
            top: originTop - 2,
            width: cellWidth * camera.zoom + 4,
            height: cellHeight * camera.zoom + 4,
            border: "1px dashed var(--color-accent)",
            zIndex: group.zIndex,
            pointerEvents: "none"
          }}
        />
      ) : null}

      {members.map((asset, index) => (
        <GroupAssetTiles
          key={asset.id}
          group={group}
          asset={asset}
          cells={buckets[index]}
          cellWidth={cellWidth}
          cellHeight={cellHeight}
          viewport={viewport}
          camera={camera}
          onReady={index === 0 ? onReady : IGNORE_SIZE}
          onPointerDown={onPointerDown}
        />
      ))}
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
        <button
          type="button"
          title="Take this palette out of the playground set"
          onClick={onRemove}
          className="text-slate-400 hover:text-rose-300"
        >
          &times;
        </button>
      ) : null}
    </span>
  );
}

function PaletteBar() {
  const composition = useStudio((state) => state.composition);
  const palettes = useStudio((state) => state.palettes);
  const paletteColors = useStudio((state) => state.paletteColors);
  const busy = useStudio((state) => state.busy);
  const store = useStudio.getState;

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [showDither, setShowDither] = useState(false);

  const pool = composition.palettePool;
  const palette = composition.palette;
  const unpooled = palettes.filter((entry) => !pool.includes(entry.file));

  const previewFor = (file: string) =>
    paletteColors[file] ?? palettes.find((entry) => entry.file === file)?.preview ?? [];

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--color-edge)] bg-[var(--color-ink-800)] px-3 py-1.5">
      <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
        Palette
      </span>

      <PaletteChip
        label="off"
        colours={[]}
        active={palette === ""}
        onSelect={() => store().setPlaygroundPalette("")}
      />

      {pool.map((file) => (
        <PaletteChip
          key={file}
          label={file.replace(/\.[^.]+$/, "")}
          colours={previewFor(file)}
          active={palette === file}
          onSelect={() => store().setPlaygroundPalette(file)}
          onRemove={() => store().removePaletteFromPool(file)}
        />
      ))}

      {unpooled.length > 0 ? (
        <select
          value=""
          title="Add a palette already sitting in the palettes folder"
          onChange={(event) => store().addPaletteToPool(event.target.value)}
          style={{ width: 130 }}
        >
          <option value="">add palette...</option>
          {unpooled.map((entry) => (
            <option key={entry.file} value={entry.file}>
              {entry.file} ({entry.count})
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
          void store().addPalettes(files);
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
          title="Write this palette into every staged asset so exports use it too"
          onClick={() => store().commitPaletteToStaged()}
        >
          bake into staged
        </Button>
      ) : null}

      {showDither && palette !== "" ? (
        <div className="flex w-full items-center gap-2 pt-1">
          <span className="w-24 shrink-0">
            <Select
              value={composition.paletteDither}
              options={DITHER_MODES}
              onChange={(value) => store().setPaletteDither({ dither: value })}
            />
          </span>
          {composition.paletteDither !== "none" ? (
            <span className="w-48">
              <Slider
                min={0}
                max={1}
                value={composition.paletteDitherStrength}
                onChange={(value) => store().setPaletteDither({ strength: value })}
              />
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function Playground() {
  const composition = useStudio((state) => state.composition);
  const assets = useStudio((state) => state.assets);
  const activeItemId = useStudio((state) => state.activeItemId);
  const activeGroupId = useStudio((state) => state.activeGroupId);
  const snapToGrid = useStudio((state) => state.snapToGrid);
  const showGrid = useStudio((state) => state.showGrid);
  const store = useStudio.getState;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });
  const [dropping, setDropping] = useState(false);
  const dragRef = useRef<{
    mode: "pan" | "item" | "group";
    targetId?: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
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

      const { activeGroupId, activeItemId, removeGroup, removeItem } = useStudio.getState();

      if (activeGroupId) {
        event.preventDefault();
        removeGroup(activeGroupId);
        return;
      }

      if (activeItemId) {
        event.preventDefault();
        removeItem(activeItemId);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const camera = composition.camera;

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

    store().setCamera({
      zoom,
      x: camera.x + (before.x - afterX),
      y: camera.y + (before.y - afterY)
    });
  };

  const onItemPointerDown = (event: React.PointerEvent, item: StagedItem) => {
    if (event.button !== 0 || event.altKey) return;

    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);

    store().setActiveItem(item.id);
    dragRef.current = {
      mode: "item",
      targetId: item.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: item.x,
      originY: item.y
    };
  };

  const onGroupPointerDown = (event: React.PointerEvent, group: RepeatGroup) => {
    if (event.button !== 0 || event.altKey) return;

    event.stopPropagation();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);

    store().setActiveGroup(group.id);
    dragRef.current = {
      mode: "group",
      targetId: group.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: group.x,
      originY: group.y
    };
  };

  const onBackgroundPointerDown = (event: React.PointerEvent) => {
    if (event.button === 0 && !event.altKey) {
      store().setActiveItem(null);
      store().setActiveGroup(null);
    }

    dragRef.current = {
      mode: "pan",
      startX: event.clientX,
      startY: event.clientY,
      originX: camera.x,
      originY: camera.y
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    const deltaX = (event.clientX - drag.startX) / camera.zoom;
    const deltaY = (event.clientY - drag.startY) / camera.zoom;

    if (drag.mode === "pan") {
      store().setCamera({ x: drag.originX - deltaX, y: drag.originY - deltaY });
      return;
    }

    if (!drag.targetId) return;

    const rawX = drag.originX + deltaX;
    const rawY = drag.originY + deltaY;
    const moved = {
      x: snapToGrid ? Math.round(rawX) : rawX,
      y: snapToGrid ? Math.round(rawY) : rawY
    };

    if (drag.mode === "group") {
      store().updateGroup(drag.targetId, moved);
      return;
    }

    store().updateItem(drag.targetId, moved);
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const onDrop = (event: React.DragEvent) => {
    if (!isAssetDrag(event)) return;

    event.preventDefault();
    setDropping(false);

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const at = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    const ids = readAssetDrag(event);

    ids.forEach((id, index) => {
      store().stageAsset(id, {
        x: Math.round(at.x) + index * 8,
        y: Math.round(at.y) + index * 8
      });
    });
  };

  const cellPixels = composition.unitsPerCell * camera.zoom;
  const gridOffsetX = (-camera.x * camera.zoom + viewport.width / 2) % cellPixels;
  const gridOffsetY = (-camera.y * camera.zoom + viewport.height / 2) % cellPixels;

  const activeItem = composition.items.find((item) => item.id === activeItemId) ?? null;
  const activeAsset = activeItem
    ? assets.find((entry) => entry.id === activeItem.assetId) ?? null
    : null;
  const activeGroup = composition.groups.find((group) => group.id === activeGroupId) ?? null;
  const staged = composition.items.length + composition.groups.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-edge)] bg-[var(--color-ink-800)] px-3 py-2">
        <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
          Playground
        </span>

        <span className="text-[11px] tabular-nums text-slate-500">
          {camera.zoom >= 1 ? `${camera.zoom.toFixed(2)}x` : `1/${(1 / camera.zoom).toFixed(1)}x`}
        </span>

        <Button variant="ghost" onClick={() => store().setCamera({ zoom: 1 })}>
          1:1
        </Button>
        <Button variant="ghost" onClick={() => store().setCamera({ x: 0, y: 0, zoom: 4 })}>
          reset view
        </Button>

        <label className="flex items-center gap-1 text-[11px] text-slate-400">
          cell
          <NumberInput
            integer
            min={1}
            width={60}
            value={composition.unitsPerCell}
            onChange={(value) => store().setUnitsPerCell(value)}
          />
        </label>

        <Button variant={showGrid ? "primary" : "ghost"} onClick={() => store().toggleGrid()}>
          grid
        </Button>
        <Button variant={snapToGrid ? "primary" : "ghost"} onClick={() => store().toggleSnap()}>
          snap
        </Button>

        <Button
          title="Add a tiling repeater, then drag library art onto it. Each cell picks one of its assets at random"
          onClick={() => store().addGroup()}
        >
          + repeater
        </Button>

        <span className="flex-1" />

        <span className="text-[11px] text-slate-500">{staged} staged</span>
        <Button
          variant="danger"
          onClick={() => {
            if (staged > 0 && confirm("Remove everything from the playground?")) {
              store().clearStage();
            }
          }}
        >
          clear
        </Button>
      </div>

      <PaletteBar />

      <div className="relative min-h-0 flex-1">
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

          {composition.groups.map((group) => (
            <GroupLayer
              key={group.id}
              group={group}
              assets={assets}
              viewport={viewport}
              camera={camera}
              active={group.id === activeGroupId}
              onPointerDown={onGroupPointerDown}
            />
          ))}

          {composition.items.map((item) => {
            const asset = assets.find((entry) => entry.id === item.assetId);
            if (!asset) return null;

            return (
              <StagedSprite
                key={item.id}
                item={item}
                asset={asset}
                viewport={viewport}
                camera={camera}
                active={item.id === activeItemId}
                onPointerDown={onItemPointerDown}
              />
            );
          })}
        </div>

        {activeGroup ? (
          <GroupControls group={activeGroup} assets={assets} />
        ) : activeItem && activeAsset ? (
          <StagedItemControls item={activeItem} asset={activeAsset} />
        ) : (
          <div className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-slate-600">
            wheel to zoom, drag the background to pan, drag a sprite to move it
          </div>
        )}
      </div>
    </div>
  );
}

function StagedItemControls({ item, asset }: { item: StagedItem; asset: AssetRecord }) {
  const locked = useStudio((state) => state.lockFootprintAspect);
  const store = useStudio.getState;
  const editingAspect = useRef<number | null>(null);

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

    store().updateItem(item.id, { footprint });
  };

  return (
    <div
      className="absolute right-3 bottom-3 w-64 rounded border border-[var(--color-edge)] bg-[var(--color-ink-800)]/95 p-2 shadow-lg"
      style={{ zIndex: 1 }}
    >
      <Row className="mb-2 justify-between">
        <span className="truncate text-[11px] text-slate-300">{asset.name}</span>
        <Button variant="danger" onClick={() => store().removeItem(item.id)}>
          remove
        </Button>
      </Row>

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
          onClick={() => store().toggleFootprintLock()}
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
            onChange={(value) => store().updateItem(item.id, { x: value })}
          />
        </label>
        <label className="text-[10px] tracking-wide text-slate-400 uppercase">
          y
          <NumberInput
            value={item.y}
            onChange={(value) => store().updateItem(item.id, { y: value })}
          />
        </label>
        <label className="text-[10px] tracking-wide text-slate-400 uppercase">
          z index
          <NumberInput
            integer
            value={item.zIndex}
            onChange={(value) => store().updateItem(item.id, { zIndex: value })}
          />
        </label>
        <label className="text-[10px] tracking-wide text-slate-400 uppercase">
          opacity
          <NumberInput
            min={0}
            max={1}
            step={0.1}
            value={item.opacity}
            onChange={(value) => store().updateItem(item.id, { opacity: value })}
          />
        </label>
      </div>

      <Row className="mb-2 flex-wrap">
        <Button
          variant={item.flipHorizontal ? "primary" : "ghost"}
          onClick={() => store().updateItem(item.id, { flipHorizontal: !item.flipHorizontal })}
        >
          flip x
        </Button>
        <Button
          variant={item.flipVertical ? "primary" : "ghost"}
          onClick={() => store().updateItem(item.id, { flipVertical: !item.flipVertical })}
        >
          flip y
        </Button>
        <Button
          variant={item.showSource ? "primary" : "ghost"}
          onClick={() => store().updateItem(item.id, { showSource: !item.showSource })}
        >
          raw
        </Button>
        <Button variant="ghost" onClick={() => store().bringToFront(item.id)}>
          front
        </Button>
      </Row>

      <Row>
        <Button
          variant="ghost"
          title="Reset the footprint to the exported pixel size, so one play unit is one texture pixel"
          onClick={() => store().updateItem(item.id, { footprint: { width: 0, height: 0 } })}
        >
          footprint = asset pixels
        </Button>
      </Row>
    </div>
  );
}

function GroupControls({ group, assets }: { group: RepeatGroup; assets: AssetRecord[] }) {
  const store = useStudio.getState;
  const [dropping, setDropping] = useState(false);

  const patch = (change: Partial<RepeatGroup>) => store().updateGroup(group.id, change);

  const members = group.assetIds
    .map((id) => assets.find((asset) => asset.id === id))
    .filter((asset): asset is AssetRecord => asset !== undefined);

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
        store().addToGroup(group.id, readAssetDrag(event));
      }}
      className={`absolute right-3 bottom-3 w-72 rounded border bg-[var(--color-ink-800)]/95 p-2 shadow-lg ${
        dropping ? "border-[var(--color-accent)]" : "border-[var(--color-edge)]"
      }`}
      style={{ zIndex: 1 }}
    >
      <Row className="mb-2 justify-between">
        <span className="text-[11px] text-slate-300">repeater &middot; {members.length} asset(s)</span>
        <Button variant="danger" onClick={() => store().removeGroup(group.id)}>
          remove
        </Button>
      </Row>

      <p className="mb-2 text-[10px] leading-snug text-slate-500">
        Drag thumbnails from the library onto this panel or onto the tiles to add them to the mix.
      </p>

      <div className="mb-2 flex flex-wrap gap-1">
        {members.map((asset) => (
          <span
            key={asset.id}
            className="flex items-center gap-1 rounded border border-[var(--color-edge)] bg-[var(--color-ink-600)] px-1 py-0.5 text-[10px] text-slate-300"
          >
            <span className="max-w-[7rem] truncate">{asset.name}</span>
            {members.length > 1 ? (
              <button
                type="button"
                title="Drop this asset from the mix"
                className="text-slate-400 hover:text-rose-300"
                onClick={() =>
                  store().setGroupAssets(
                    group.id,
                    group.assetIds.filter((entry) => entry !== asset.id)
                  )
                }
              >
                &times;
              </button>
            ) : null}
          </span>
        ))}
      </div>

      <Row className="mb-2">
        <Button
          title="Shuffle which asset lands in each cell"
          onClick={() => patch({ seed: Math.floor(Math.random() * 1e9) })}
        >
          reshuffle
        </Button>
      </Row>

      <Toggle
        label="Random quarter-turn per cell"
        checked={group.randomRotate}
        onChange={(value) => patch({ randomRotate: value })}
      />

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

      {(["x", "y"] as const).map((axis) => {
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
      })}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-[10px] tracking-wide text-slate-400 uppercase">
          cell w
          <NumberInput
            min={0}
            title="0 follows the other edge at the asset's aspect ratio, or its pixel size if both are 0"
            value={group.cell.width}
            onChange={(value) => patch({ cell: { ...group.cell, width: value } })}
          />
        </label>
        <label className="text-[10px] tracking-wide text-slate-400 uppercase">
          cell h
          <NumberInput
            min={0}
            title="0 follows the other edge at the asset's aspect ratio, or its pixel size if both are 0"
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
      </div>
    </div>
  );
}
