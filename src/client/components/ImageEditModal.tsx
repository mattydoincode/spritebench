"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStudio } from "@/client/store";
import { applyEdits, describeEdit, type CropEdit } from "@/core/edits";
import type { RgbaImage } from "@/core/types";
import { Button, Divider, Field, NumberInput, Modal, Row } from "./ui";

const VIEW_WIDTH = 620;
const VIEW_HEIGHT = 460;

interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function loadSource(url: string): Promise<RgbaImage> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not load the source image (${response.status})`);

  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d canvas context available");

  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  return { width: frame.width, height: frame.height, data: frame.data };
}

function fitScale(image: RgbaImage): number {
  const raw = Math.min(VIEW_WIDTH / image.width, VIEW_HEIGHT / image.height);
  return raw >= 1 ? Math.floor(raw) : raw;
}

function ImageCanvas({ image, scale }: { image: RgbaImage; scale: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    canvas.width = image.width;
    canvas.height = image.height;

    const context = canvas.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, image.width, image.height);
    context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  }, [image]);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none block"
      style={{
        width: Math.round(image.width * scale),
        height: Math.round(image.height * scale),
        imageRendering: scale >= 1 ? "pixelated" : "auto"
      }}
    />
  );
}

export function ImageEditModal() {
  const assetId = useStudio((state) => state.editingAssetId);
  const asset = useStudio((state) =>
    state.assets.find((entry) => entry.id === state.editingAssetId)
  );
  const store = useStudio.getState;

  const [source, setSource] = useState<RgbaImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  const dragRef = useRef<{ originX: number; originY: number } | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!assetId) return;

    let cancelled = false;
    setSource(null);
    setError(null);
    setSelection(null);

    loadSource(`/api/assets/${assetId}/source`)
      .then((image) => {
        if (!cancelled) setSource(image);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      });

    return () => {
      cancelled = true;
    };
  }, [assetId]);

  const edits = asset?.processing.edits ?? [];

  const edited = useMemo(
    () => (source ? applyEdits(source, edits) : null),
    [source, edits]
  );

  if (!asset || !assetId) return null;

  const scale = edited ? fitScale(edited) : 1;

  const toImagePoint = (clientX: number, clientY: number) => {
    const surface = surfaceRef.current;
    if (!surface || !edited) return { x: 0, y: 0 };

    const bounds = surface.getBoundingClientRect();

    return {
      x: Math.max(0, Math.min(edited.width, Math.round((clientX - bounds.left) / scale))),
      y: Math.max(0, Math.min(edited.height, Math.round((clientY - bounds.top) / scale)))
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

    store().setEdits(asset.id, [...edits, crop]);
    setSelection(null);
  };

  return (
    <Modal
      title={`Edit ${asset.name}`}
      onClose={() => store().closeImageEditor()}
      width={980}
      footer={
        <Row className="justify-between">
          <span className="text-[10px] text-slate-500">
            Edits sit on top of the raw generated PNG, so every instance in the playground and the
            exported file follow along. Nothing here touches the original file.
          </span>

          <Row>
            <Button
              disabled={edits.length === 0}
              title="Remove the last edit"
              onClick={() => store().setEdits(asset.id, edits.slice(0, -1))}
            >
              undo
            </Button>

            <Button
              variant="danger"
              disabled={edits.length === 0}
              title="Drop every edit and go back to the raw image"
              onClick={() => store().setEdits(asset.id, [])}
            >
              reset
            </Button>
          </Row>
        </Row>
      }
    >
      <div className="flex gap-3">
        <div className="min-w-0 flex-1">
          <div className="checkerboard flex min-h-[300px] items-center justify-center rounded p-3">
            {error ? <span className="text-[11px] text-rose-300">{error}</span> : null}
            {!error && !edited ? (
              <span className="text-[11px] text-slate-500">loading image...</span>
            ) : null}

            {edited ? (
              <div
                ref={surfaceRef}
                className="relative cursor-crosshair overflow-hidden"
                style={{ touchAction: "none" }}
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
                <ImageCanvas image={edited} scale={scale} />

                {selection && selection.width > 0 && selection.height > 0 ? (
                  <div
                    className="pointer-events-none absolute border border-[var(--color-accent)]"
                    style={{
                      left: Math.round(selection.x * scale),
                      top: Math.round(selection.y * scale),
                      width: Math.round(selection.width * scale),
                      height: Math.round(selection.height * scale),
                      boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)"
                    }}
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          <p className="mt-2 text-[10px] text-slate-500">
            {source && edited ? (
              <>
                raw {source.width}x{source.height}
                {edits.length > 0 ? (
                  <>
                    {" "}
                    &rarr; edited {edited.width}x{edited.height}
                  </>
                ) : null}
                {scale !== 1 ? ` \u00b7 shown at ${scale >= 1 ? `${scale}x` : `${Math.round(scale * 100)}%`}` : ""}
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
              No edits yet. The playground shows the raw image.
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
