"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useHistory, sameJson } from "@/client/history";
import { useAsset } from "@/client/stores/assets";
import { useDoc } from "@/client/stores/doc";
import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";
import {
  DEFAULT_GRID,
  cellFrameSize,
  cellUsed,
  clampFrame,
  detectGrid,
  nudgeFrame,
  placeFrame,
  resizeFrame,
  sliceGrid,
  tightenFrames,
  type FrameSize,
  type GridOptions
} from "@/core/slice";
import type { Rect, Size } from "@/core/types";
import { fitCamera, type ViewCamera } from "@/core/viewport";
import { DEFAULT_FPS, insetRect, type Sequence, type SequenceFrame } from "@/shared/sequence";
import { ImageViewport, ViewControls, viewPoint } from "./ImageViewport";
import { useSource } from "./SourceCanvas";
import { Button, Divider, Field, NumberInput, Modal, Row } from "./ui";

const VIEW = { width: 620, height: 460 };

interface ActionRow {
  name: string;
  frames: number;
}

interface Origin {
  x: number;
  y: number;
}

interface SliceDraft {
  grid: GridOptions;
  frameSize: FrameSize;
  origins: Record<number, Origin>;
  actions: ActionRow[];
}

const EMPTY_DRAFT: SliceDraft = {
  grid: DEFAULT_GRID,
  frameSize: { width: 1, height: 1 },
  origins: {},
  actions: [{ name: "idle", frames: 4 }]
};

function rowsFromAsset(sequences: Sequence[]): ActionRow[] {
  if (sequences.length === 0) return [{ name: "idle", frames: 4 }];
  return sequences.map((entry) => ({
    name: entry.name,
    frames: Math.max(1, entry.frames.length)
  }));
}

function seedFromAsset(
  sequences: Sequence[],
  columns: number
): { size: FrameSize; origins: Record<number, Origin> } | null {
  const first = sequences[0]?.frames[0];
  if (!first) return null;

  const size = insetRect(first.rect, sequences[0].inset);
  const origins: Record<number, Origin> = {};

  sequences.forEach((sequence, row) => {
    sequence.frames.forEach((frame, column) => {
      const rect = resizeFrame(insetRect(frame.rect, sequence.inset), size);
      origins[row * columns + column] = { x: rect.x, y: rect.y };
    });
  });

  return { size: { width: size.width, height: size.height }, origins };
}

function resolveFrame(
  index: number,
  cells: Rect[],
  draft: SliceDraft,
  sheet: Size
): Rect | null {
  const cell = cells[index];
  if (!cell) return null;

  const origin = draft.origins[index];
  if (origin) {
    return clampFrame(
      { x: origin.x, y: origin.y, width: draft.frameSize.width, height: draft.frameSize.height },
      sheet
    );
  }

  return placeFrame(cell, draft.frameSize, sheet);
}

function withFrameSize(draft: SliceDraft, size: FrameSize, sheet: Size | null): SliceDraft {
  const clamped = sheet
    ? clampFrame({ x: 0, y: 0, width: Math.max(1, size.width), height: Math.max(1, size.height) }, sheet)
    : { width: Math.max(1, size.width), height: Math.max(1, size.height) };
  const nextSize: FrameSize = { width: clamped.width, height: clamped.height };

  if (!sheet) return { ...draft, frameSize: nextSize };

  const origins: Record<number, Origin> = {};
  for (const [key, origin] of Object.entries(draft.origins)) {
    const resized = resizeFrame(
      { x: origin.x, y: origin.y, width: draft.frameSize.width, height: draft.frameSize.height },
      nextSize,
      sheet
    );
    origins[Number(key)] = { x: resized.x, y: resized.y };
  }

  return { ...draft, frameSize: nextSize, origins };
}

/**
 * Cutting a sheet into one animation per row.
 *
 * Works on the raw PNG. The grid is a starting layout; each used cell is a
 * fixed-size box you can drag, because generated sprites rarely sit on the
 * lines the model was asked to draw.
 */
export function SliceModal() {
  const assetId = useUi((state) => state.slicingAssetId);
  const projectId = useServer((state) => state.project?.id ?? null);
  const asset = useAsset(assetId);

  const { source, error } = useSource(projectId, assetId);
  const history = useHistory<SliceDraft>(EMPTY_DRAFT, sameJson);
  const draft = history.present;

  const [selected, setSelected] = useState<number | null>(null);
  const [camera, setCamera] = useState<ViewCamera>({ zoom: 1, panX: 0, panY: 0 });

  const seededFromAsset = useRef(false);
  const booted = useRef(false);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ index: number; grabX: number; grabY: number } | null>(null);

  useEffect(() => {
    if (!assetId || !asset) return;

    const next = rowsFromAsset(asset.sequences);
    const columns = Math.max(1, ...next.map((entry) => entry.frames));
    const rows = Math.max(next.length, 1);
    const seed = seedFromAsset(asset.sequences, columns);

    setSelected(null);
    booted.current = false;
    seededFromAsset.current = Boolean(seed);
    history.reset({
      grid: { ...DEFAULT_GRID, columns, rows },
      frameSize: seed?.size ?? { width: 1, height: 1 },
      origins: seed?.origins ?? {},
      actions: next
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  useEffect(() => {
    if (!source) return;
    setCamera(fitCamera(source, VIEW));
  }, [source]);

  const cells = useMemo(
    () => (source ? sliceGrid(source, draft.grid) : []),
    [source, draft.grid]
  );

  useEffect(() => {
    if (!source || booted.current) return;
    booted.current = true;

    if (seededFromAsset.current) {
      seededFromAsset.current = false;
      history.replace((was) => {
        const origins: Record<number, Origin> = {};
        for (const [key, origin] of Object.entries(was.origins)) {
          const clamped = clampFrame(
            { x: origin.x, y: origin.y, width: was.frameSize.width, height: was.frameSize.height },
            source
          );
          origins[Number(key)] = { x: clamped.x, y: clamped.y };
        }
        return { ...was, origins };
      });
      return;
    }

    history.replace((was) => ({
      ...was,
      frameSize: cellFrameSize(cells),
      origins: {}
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  useEffect(() => {
    if (!assetId) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) history.redo();
        else history.undo();
        return;
      }

      if (selected === null || !source) return;

      const step = event.shiftKey ? 10 : 1;
      let dx = 0;
      let dy = 0;
      if (event.key === "ArrowLeft") dx = -step;
      else if (event.key === "ArrowRight") dx = step;
      else if (event.key === "ArrowUp") dy = -step;
      else if (event.key === "ArrowDown") dy = step;
      else return;

      event.preventDefault();
      const current = resolveFrame(selected, cells, draft, source);
      if (!current) return;
      const next = nudgeFrame(current, dx, dy, source);
      history.commit((was) => ({
        ...was,
        origins: { ...was.origins, [selected]: { x: next.x, y: next.y } }
      }));
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assetId, selected, source, cells, draft, history]);

  if (!asset || !assetId) return null;

  const sheet: Size | null = source;
  const cellSize = cells.length ? cellFrameSize(cells) : null;

  const resolve = (index: number): Rect | null =>
    sheet ? resolveFrame(index, cells, draft, sheet) : null;

  const usedRects = cells.flatMap((_, index) => {
    const row = Math.floor(index / draft.grid.columns);
    const column = index % draft.grid.columns;
    if (!cellUsed(row, column, draft.actions)) return [];
    const rect = resolve(index);
    return rect ? [rect] : [];
  });

  const moveFrame = (index: number, x: number, y: number, commit: boolean) => {
    if (!sheet) return;
    const current = resolve(index);
    if (!current) return;
    const next = clampFrame({ ...current, x, y }, sheet);
    const apply = (was: SliceDraft): SliceDraft => ({
      ...was,
      origins: { ...was.origins, [index]: { x: next.x, y: next.y } }
    });
    if (commit) history.commit(apply);
    else history.replace(apply);
  };

  const setAction = (index: number, patchRow: Partial<ActionRow>) => {
    history.commit((was) => ({
      ...was,
      actions: was.actions.map((entry, at) => (at === index ? { ...entry, ...patchRow } : entry))
    }));
  };

  const setRows = (rows: number) => {
    const next = Math.max(1, rows);
    history.commit((was) => {
      const actions = was.actions.slice(0, next);
      while (actions.length < next) {
        actions.push({ name: `animation ${actions.length + 1}`, frames: Math.min(4, was.grid.columns) });
      }
      return { ...was, grid: { ...was.grid, rows: next }, actions, origins: {} };
    });
  };

  const setColumns = (columns: number) => {
    const next = Math.max(1, columns);
    history.commit((was) => ({
      ...was,
      grid: { ...was.grid, columns: next },
      origins: {},
      actions: was.actions.map((entry) => ({
        ...entry,
        frames: Math.min(Math.max(1, entry.frames), next)
      }))
    }));
  };

  const patchGrid = (next: Partial<GridOptions>) => {
    history.commit((was) => ({ ...was, grid: { ...was.grid, ...next }, origins: {} }));
  };

  const autoDetect = () => {
    if (!source) return;

    const guess = detectGrid(source, asset.processing.alphaThreshold);
    if (!guess) return;

    const guessed = sliceGrid(source, guess);
    setSelected(null);
    history.commit((was) => {
      const actions = was.actions.slice(0, guess.rows);
      while (actions.length < guess.rows) {
        actions.push({ name: `animation ${actions.length + 1}`, frames: guess.columns });
      }
      return {
        grid: guess,
        frameSize: cellFrameSize(guessed),
        origins: {},
        actions: actions.map((entry) => ({
          ...entry,
          frames: Math.min(Math.max(1, entry.frames), guess.columns)
        }))
      };
    });
  };

  const tighten = () => {
    if (!source || usedRects.length === 0) return;

    const next = tightenFrames(source, usedRects, asset.processing.alphaThreshold);
    const size = cellFrameSize(next);
    let cursor = 0;

    history.commit((was) => {
      const origins = { ...was.origins };
      cells.forEach((_, index) => {
        const row = Math.floor(index / was.grid.columns);
        const column = index % was.grid.columns;
        if (!cellUsed(row, column, was.actions)) return;
        const rect = next[cursor++];
        if (rect) origins[index] = { x: rect.x, y: rect.y };
      });
      return { ...was, frameSize: size, origins };
    });
  };

  const fitToGrid = () => {
    if (!source) return;
    setSelected(null);
    history.commit((was) => ({
      ...was,
      frameSize: cellFrameSize(cells),
      origins: {}
    }));
  };

  const apply = () => {
    const sequences: Sequence[] = draft.actions.map((action, row) => ({
      id: crypto.randomUUID(),
      name: action.name.trim() || (row === 0 ? "animation" : `animation ${row + 1}`),
      fps: asset.sequences[row]?.fps ?? DEFAULT_FPS,
      playback: asset.sequences[row]?.playback ?? "loop",
      inset: { top: 0, right: 0, bottom: 0, left: 0 },
      frames: Array.from({ length: action.frames }, (_, column): SequenceFrame => ({
        id: crypto.randomUUID(),
        sourceAssetId: asset.id,
        rect: resolve(row * draft.grid.columns + column) ?? { x: 0, y: 0, width: 1, height: 1 },
        edits: [],
        hold: 1
      }))
    }));

    useDoc.getState().replaceSequences(asset.id, sequences);
    useUi.getState().setActiveSequence(sequences[0]?.id ?? null);
    useUi.getState().closeSlicer();
  };

  const toImage = (clientX: number, clientY: number) => {
    const surface = surfaceRef.current;
    if (!surface) return { x: 0, y: 0 };
    const point = viewPoint(surface, camera, clientX, clientY);
    return { x: Math.round(point.imageX), y: Math.round(point.imageY) };
  };

  const selectedRect = selected !== null ? resolve(selected) : null;

  return (
    <Modal
      title={`Slice ${asset.label}`}
      onClose={() => useUi.getState().closeSlicer()}
      width={980}
      actions={
        <Row>
          <Button disabled={!history.canUndo} title="Undo (Ctrl+Z)" onClick={() => history.undo()}>
            undo
          </Button>
          <Button disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z)" onClick={() => history.redo()}>
            redo
          </Button>
        </Row>
      }
      footer={
        <Row className="justify-between">
          <span className="text-[10px] text-slate-500">
            Wheel zooms, drag empty space to pan, drag a box to move it. Re-slicing never touches
            the PNG.
          </span>

          <Button variant="primary" disabled={usedRects.length === 0} onClick={apply}>
            slice into {draft.actions.length} animation{draft.actions.length === 1 ? "" : "s"}
          </Button>
        </Row>
      }
    >
      <div className="flex gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-h-[300px] items-center justify-center">
            {error ? <span className="text-[11px] text-rose-300">{error}</span> : null}
            {!error && !source ? (
              <span className="text-[11px] text-slate-500">loading image...</span>
            ) : null}

            {source ? (
              <ImageViewport
                image={source}
                width={VIEW.width}
                height={VIEW.height}
                camera={camera}
                onCameraChange={setCamera}
                panOnBackground
                viewportRef={surfaceRef}
                onPointerDown={() => setSelected(null)}
                onPointerMove={(event) => {
                  const drag = dragRef.current;
                  if (!drag) return;
                  const point = toImage(event.clientX, event.clientY);
                  moveFrame(drag.index, point.x - drag.grabX, point.y - drag.grabY, false);
                }}
                onPointerUp={() => {
                  if (dragRef.current) history.end();
                  dragRef.current = null;
                }}
                onPointerCancel={() => {
                  dragRef.current = null;
                }}
              >
                {cells.map((_, index) => {
                  const row = Math.floor(index / draft.grid.columns);
                  const column = index % draft.grid.columns;
                  const included = cellUsed(row, column, draft.actions);
                  const rect = resolve(index);
                  if (!rect) return null;

                  const active = selected === index;

                  return (
                    <div
                      key={index}
                      role={included ? "button" : undefined}
                      className={`absolute border ${
                        included
                          ? `pointer-events-auto cursor-move ${
                              active
                                ? "z-10 border-2 border-[var(--color-accent)]"
                                : "border-[var(--color-accent)]"
                            }`
                          : "border-dashed border-slate-600 opacity-40"
                      }`}
                      style={{
                        left: rect.x * camera.zoom,
                        top: rect.y * camera.zoom,
                        width: rect.width * camera.zoom,
                        height: rect.height * camera.zoom
                      }}
                      onPointerDown={(event) => {
                        if (!included) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const point = toImage(event.clientX, event.clientY);
                        dragRef.current = {
                          index,
                          grabX: point.x - rect.x,
                          grabY: point.y - rect.y
                        };
                        setSelected(index);
                        history.begin();
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={(event) => {
                        const drag = dragRef.current;
                        if (!drag || drag.index !== index) return;
                        const point = toImage(event.clientX, event.clientY);
                        moveFrame(drag.index, point.x - drag.grabX, point.y - drag.grabY, false);
                      }}
                      onPointerUp={() => {
                        if (dragRef.current) history.end();
                        dragRef.current = null;
                      }}
                      onPointerCancel={() => {
                        dragRef.current = null;
                      }}
                    >
                      {included ? (
                        <span className="pointer-events-none absolute left-0.5 top-0.5 rounded bg-black/60 px-0.5 text-[8px] leading-tight text-slate-200">
                          {draft.actions[row]?.name || row + 1} {column + 1}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </ImageViewport>
            ) : null}
          </div>

          {source ? <ViewControls image={source} view={VIEW} camera={camera} onCameraChange={setCamera} /> : null}

          <p className="mt-2 text-[10px] text-slate-500">
            {source ? (
              <>
                raw {source.width}x{source.height} · {usedRects.length} frames · {draft.frameSize.width}
                ×{draft.frameSize.height}
                {cellSize ? ` · grid cell ${cellSize.width}×${cellSize.height}` : ""}
                {selected !== null ? " · arrows nudge, shift for 10px" : ""}
              </>
            ) : null}
          </p>
        </div>

        <div className="w-[260px] shrink-0">
          <Divider label="grid" />

          <Row>
            <div className="flex-1">
              <Field label="Columns" hint="frames / row">
                <NumberInput integer min={1} max={32} value={draft.grid.columns} onChange={setColumns} />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Rows" hint="actions">
                <NumberInput integer min={1} max={32} value={draft.grid.rows} onChange={setRows} />
              </Field>
            </div>
          </Row>

          <Row>
            <div className="flex-1">
              <Field label="Margin X" hint="px">
                <NumberInput
                  integer
                  min={0}
                  value={draft.grid.marginX}
                  onChange={(marginX) => patchGrid({ marginX })}
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Margin Y" hint="px">
                <NumberInput
                  integer
                  min={0}
                  value={draft.grid.marginY}
                  onChange={(marginY) => patchGrid({ marginY })}
                />
              </Field>
            </div>
          </Row>

          <Row>
            <div className="flex-1">
              <Field label="Gutter X" hint="px">
                <NumberInput
                  integer
                  min={0}
                  value={draft.grid.spacingX}
                  onChange={(spacingX) => patchGrid({ spacingX })}
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Gutter Y" hint="px">
                <NumberInput
                  integer
                  min={0}
                  value={draft.grid.spacingY}
                  onChange={(spacingY) => patchGrid({ spacingY })}
                />
              </Field>
            </div>
          </Row>

          <Button className="mb-2 w-full" disabled={!source} onClick={autoDetect}>
            auto-detect from gutters
          </Button>

          <Divider label="frame size" />

          <p className="mb-2 text-[10px] leading-snug text-slate-500">
            Same crop for every frame. Tighten eats shared empty margin. Fit to grid puts the
            boxes back on an even split of the sheet.
          </p>

          <Row>
            <div className="flex-1">
              <Field label="Width" hint="px">
                <NumberInput
                  integer
                  min={1}
                  max={source?.width ?? 4096}
                  value={draft.frameSize.width}
                  onChange={(width) =>
                    history.commit((was) => withFrameSize(was, { ...was.frameSize, width }, sheet))
                  }
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Height" hint="px">
                <NumberInput
                  integer
                  min={1}
                  max={source?.height ?? 4096}
                  value={draft.frameSize.height}
                  onChange={(height) =>
                    history.commit((was) => withFrameSize(was, { ...was.frameSize, height }, sheet))
                  }
                />
              </Field>
            </div>
          </Row>

          <Button
            className="mb-2 w-full"
            disabled={!source || !cellSize}
            title="Even split: sheet ÷ columns × rows, boxes recentred on each cell"
            onClick={fitToGrid}
          >
            {cellSize ? `fit to grid · ${cellSize.width}×${cellSize.height}` : "fit to grid"}
          </Button>

          <Button className="mb-2 w-full" disabled={!source || usedRects.length === 0} onClick={tighten}>
            tighten
          </Button>

          <Divider label="actions" />

          {draft.actions.map((entry, index) => (
            <Row key={index} className="mb-1">
              <input
                type="text"
                className="min-w-0 flex-1"
                value={entry.name}
                onChange={(event) => setAction(index, { name: event.target.value })}
              />
              <NumberInput
                integer
                min={1}
                max={draft.grid.columns}
                width={52}
                value={entry.frames}
                onChange={(frames) => setAction(index, { frames })}
              />
            </Row>
          ))}

          {selectedRect && selected !== null ? (
            <>
              <Divider
                label={`frame ${Math.floor(selected / draft.grid.columns) + 1}.${(selected % draft.grid.columns) + 1}`}
              />

              <Row>
                <div className="flex-1">
                  <Field label="X" hint="px">
                    <NumberInput
                      integer
                      min={0}
                      max={Math.max(0, (source?.width ?? 1) - selectedRect.width)}
                      value={selectedRect.x}
                      onChange={(x) => moveFrame(selected, x, selectedRect.y, true)}
                    />
                  </Field>
                </div>
                <div className="flex-1">
                  <Field label="Y" hint="px">
                    <NumberInput
                      integer
                      min={0}
                      max={Math.max(0, (source?.height ?? 1) - selectedRect.height)}
                      value={selectedRect.y}
                      onChange={(y) => moveFrame(selected, selectedRect.x, y, true)}
                    />
                  </Field>
                </div>
              </Row>
            </>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
