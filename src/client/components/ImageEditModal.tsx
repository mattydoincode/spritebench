"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAsset } from "@/client/stores/assets";
import { useDoc } from "@/client/stores/doc";
import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";
import { applyEdits, describeEdit, type CropEdit } from "@/core/edits";
import type { ImageEdit } from "@/core/edits";
import { insetRect } from "@/shared/sequence";
import { fitCamera, type ViewCamera } from "@/core/viewport";
import { ImageViewport, ViewControls, viewPoint } from "./ImageViewport";
import { useSource } from "./SourceCanvas";
import { Button, Divider, Field, NumberInput, Modal, Row } from "./ui";

const VIEW = { width: 620, height: 460 };

interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function ImageEditModal() {
  const assetId = useUi((state) => state.editingAssetId);
  const editingFrame = useUi((state) => state.editingFrame);
  const projectId = useServer((state) => state.project?.id ?? null);
  const asset = useAsset(assetId);

  const { source, error } = useSource(projectId, assetId);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [undone, setUndone] = useState<ImageEdit[]>([]);
  const [camera, setCamera] = useState<ViewCamera>({ zoom: 1, panX: 0, panY: 0 });

  const dragRef = useRef<{ originX: number; originY: number } | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const sequence =
    asset?.sequences.find((entry) => entry.id === editingFrame?.sequenceId) ?? null;
  const frameIndex = sequence
    ? sequence.frames.findIndex((entry) => entry.id === editingFrame?.frameId)
    : -1;
  const frame = frameIndex >= 0 ? sequence!.frames[frameIndex] : null;

  // In frame mode the whole tool is scoped to one cell: the base image is the
  // frame's rectangle out of the sheet, and edits land on the frame rather
  // than on the asset, so cropping frame 3 leaves the other fifteen alone.
  const edits = frame ? frame.edits : asset?.processing.edits ?? [];

  const setEdits = (next: ImageEdit[]) => {
    if (!asset) return;

    if (frame && sequence) {
      useDoc.getState().patchSequenceFrame(asset.id, sequence.id, frame.id, { edits: next });
    } else {
      useDoc.getState().patchProcessing(asset.id, { edits: next });
    }
  };

  // Clearing the drag box when the target changes: keeping a rectangle drawn
  // over frame 2 while looking at frame 3 would apply it to the wrong one.
  useEffect(() => {
    setSelection(null);
    setUndone([]);
  }, [assetId, frame?.id]);

  const base = useMemo(() => {
    if (!source) return null;
    if (!frame || !sequence) return source;

    return applyEdits(source, [{ kind: "crop", ...insetRect(frame.rect, sequence.inset) }]);
  }, [source, frame, sequence]);

  const edited = useMemo(
    () => (base ? applyEdits(base, edits) : null),
    [base, edits]
  );

  useEffect(() => {
    if (!edited) return;
    setCamera(fitCamera(edited, VIEW));
  }, [edited?.width, edited?.height, assetId, frame?.id]);

  useEffect(() => {
    if (!assetId) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;

      event.preventDefault();
      if (event.shiftKey) {
        const last = undone[undone.length - 1];
        if (!last) return;
        setUndone((was) => was.slice(0, -1));
        setEdits([...edits, last]);
        return;
      }

      const last = edits[edits.length - 1];
      if (!last) return;
      setUndone((was) => [...was, last]);
      setEdits(edits.slice(0, -1));
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assetId, edits, undone]);

  if (!asset || !assetId) return null;

  const toImagePoint = (clientX: number, clientY: number) => {
    const surface = surfaceRef.current;
    if (!surface || !edited) return { x: 0, y: 0 };

    const point = viewPoint(surface, camera, clientX, clientY);

    return {
      x: Math.max(0, Math.min(edited.width, Math.round(point.imageX))),
      y: Math.max(0, Math.min(edited.height, Math.round(point.imageY)))
    };
  };

  const setSelectionFrom = (clientX: number, clientY: number) => {
    const start = dragRef.current;
    if (!start) return;

    const point = toImagePoint(clientX, clientY);

    setSelection({
      x: Math.min(start.originX, point.x),
      y: Math.min(start.originY, point.y),
      width: Math.abs(point.x - start.originX),
      height: Math.abs(point.y - start.originY)
    });
  };

  const patchSelection = (patch: Partial<Selection>) => {
    if (!edited) return;

    const next = { ...(selection ?? { x: 0, y: 0, width: edited.width, height: edited.height }), ...patch };

    setSelection({
      x: Math.max(0, Math.round(next.x)),
      y: Math.max(0, Math.round(next.y)),
      width: Math.max(1, Math.round(next.width)),
      height: Math.max(1, Math.round(next.height))
    });
  };

  const usable = selection !== null && selection.width >= 1 && selection.height >= 1;

  const applyCrop = () => {
    if (!usable || !selection) return;

    const crop: CropEdit = {
      kind: "crop",
      x: selection.x,
      y: selection.y,
      width: selection.width,
      height: selection.height
    };

    setEdits([...edits, crop]);
    setUndone([]);
    setSelection(null);
  };

  const undoEdit = () => {
    const last = edits[edits.length - 1];
    if (!last) return;
    setUndone((was) => [...was, last]);
    setEdits(edits.slice(0, -1));
  };

  const redoEdit = () => {
    const last = undone[undone.length - 1];
    if (!last) return;
    setUndone((was) => was.slice(0, -1));
    setEdits([...edits, last]);
  };

  return (
    <Modal
      title={
        frame && sequence
          ? `Edit ${asset.label} \u00b7 ${sequence.name} frame ${frameIndex + 1}`
          : `Edit ${asset.label}`
      }
      onClose={() => useUi.getState().closeImageEditor()}
      width={980}
      footer={
        <Row className="justify-between">
          <span className="text-[10px] text-slate-500">
            {frame
              ? "Wheel zooms, Space/Alt-drag pans, drag a box to crop. Edits apply to this frame alone."
              : "Wheel zooms, Space/Alt-drag pans. Edits sit on the raw PNG — the original file is untouched."}
          </span>

          <Row>
            <Button
              disabled={edits.length === 0}
              title="Remove the last edit (Ctrl+Z)"
              onClick={undoEdit}
            >
              undo
            </Button>

            <Button
              disabled={undone.length === 0}
              title="Restore the last undone edit (Ctrl+Shift+Z)"
              onClick={redoEdit}
            >
              redo
            </Button>

            <Button
              variant="danger"
              disabled={edits.length === 0}
              title="Drop every edit and go back to the raw image"
              onClick={() => {
                setEdits([]);
                setUndone([]);
              }}
            >
              reset
            </Button>
          </Row>
        </Row>
      }
    >
      {sequence && sequence.frames.length > 1 ? (
        <Row className="mb-2 overflow-x-auto pb-1">
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400">
            frame
          </span>

          {sequence.frames.map((entry, index) => (
            <Button
              key={entry.id}
              variant={entry.id === frame?.id ? "primary" : "ghost"}
              title={entry.edits.length > 0 ? `${entry.edits.length} edits` : "no edits"}
              onClick={() => useUi.getState().openFrameEditor(asset.id, sequence.id, entry.id)}
            >
              {index + 1}
              {entry.edits.length > 0 ? "*" : ""}
            </Button>
          ))}
        </Row>
      ) : null}

      <div className="flex gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-h-[300px] items-center justify-center">
            {error ? <span className="text-[11px] text-rose-300">{error}</span> : null}
            {!error && !edited ? (
              <span className="text-[11px] text-slate-500">loading image...</span>
            ) : null}

            {edited ? (
              <ImageViewport
                image={edited}
                width={VIEW.width}
                height={VIEW.height}
                camera={camera}
                onCameraChange={setCamera}
                cursor="crosshair"
                viewportRef={surfaceRef}
                onPointerDown={(event) => {
                  event.preventDefault();
                  const point = toImagePoint(event.clientX, event.clientY);
                  dragRef.current = { originX: point.x, originY: point.y };
                  setSelection({ x: point.x, y: point.y, width: 0, height: 0 });
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (!dragRef.current) return;
                  setSelectionFrom(event.clientX, event.clientY);
                }}
                onPointerUp={(event) => {
                  if (dragRef.current) setSelectionFrom(event.clientX, event.clientY);
                  dragRef.current = null;
                }}
                onPointerCancel={() => {
                  dragRef.current = null;
                }}
              >
                {selection && selection.width > 0 && selection.height > 0 ? (
                  <div
                    className="pointer-events-none absolute border border-[var(--color-accent)]"
                    style={{
                      left: selection.x * camera.zoom,
                      top: selection.y * camera.zoom,
                      width: selection.width * camera.zoom,
                      height: selection.height * camera.zoom,
                      boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)"
                    }}
                  />
                ) : null}
              </ImageViewport>
            ) : null}
          </div>

          {edited ? <ViewControls image={edited} view={VIEW} camera={camera} onCameraChange={setCamera} /> : null}

          <p className="mt-2 text-[10px] text-slate-500">
            {base && edited ? (
              <>
                {frame ? "frame" : "raw"} {base.width}x{base.height}
                {edits.length > 0 ? (
                  <>
                    {" "}
                    &rarr; edited {edited.width}x{edited.height}
                  </>
                ) : null}
              </>
            ) : null}
          </p>
        </div>

        <div className="w-[240px] shrink-0">
          <Divider label="crop" />

          <p className="mb-2 text-[10px] leading-snug text-slate-500">
            Drag a box on the image, or type the rectangle in raw pixels of the current image.
          </p>

          <Row>
            <div className="flex-1">
              <Field label="X">
                <NumberInput
                  integer
                  min={0}
                  value={selection?.x ?? 0}
                  onChange={(value) => patchSelection({ x: value })}
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Y">
                <NumberInput
                  integer
                  min={0}
                  value={selection?.y ?? 0}
                  onChange={(value) => patchSelection({ y: value })}
                />
              </Field>
            </div>
          </Row>

          <Row>
            <div className="flex-1">
              <Field label="Width">
                <NumberInput
                  integer
                  min={1}
                  value={selection?.width ?? edited?.width ?? 0}
                  onChange={(value) => patchSelection({ width: value })}
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Height">
                <NumberInput
                  integer
                  min={1}
                  value={selection?.height ?? edited?.height ?? 0}
                  onChange={(value) => patchSelection({ height: value })}
                />
              </Field>
            </div>
          </Row>

          <Row className="mb-2">
            <Button
              disabled={!edited}
              title="Select the whole image"
              onClick={() =>
                edited
                  ? setSelection({ x: 0, y: 0, width: edited.width, height: edited.height })
                  : undefined
              }
            >
              select all
            </Button>

            <Button disabled={!selection} onClick={() => setSelection(null)}>
              clear
            </Button>
          </Row>

          <Button variant="primary" className="w-full" disabled={!usable} onClick={applyCrop}>
            apply crop
          </Button>

          <Divider label={`edits (${edits.length})`} />

          {edits.length === 0 ? (
            <p className="text-[10px] text-slate-500">
              No edits yet. The scene shows the raw image.
            </p>
          ) : (
            <ol className="flex flex-col gap-1">
              {edits.map((edit, index) => (
                <li
                  key={index}
                  className="rounded border border-[var(--color-edge)] bg-[var(--color-ink-800)] px-2 py-1 text-[10px] text-slate-300"
                >
                  {index + 1}. {describeEdit(edit)}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Modal>
  );
}
