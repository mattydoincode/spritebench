"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDoc } from "@/client/stores/doc";
import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";
import {
  MAX_ISO_TEMPLATE_PITCH,
  MIN_ISO_TEMPLATE_PITCH
} from "@/core/iso";
import {
  ISO_TEMPLATE_DIAMOND,
  ISO_TEMPLATE_FILL,
  ISO_TEMPLATE_SHAPES,
  ISO_TEMPLATE_SHAPE_LABELS,
  ISO_TEMPLATE_SPHERE,
  ISO_TEMPLATE_YAWS,
  isoTemplateFileName,
  normalizeIsoTemplateSpec,
  renderIsoTemplate,
  type IsoTemplateSpec
} from "@/core/isoTemplate";
import { hexToRgb } from "@/core/pixels";
import type { Rgb, RgbaImage } from "@/core/types";
import { IsoLightField } from "./IsoLightField";
import { IsoPitchField } from "./IsoPitchField";
import { Button, ColorInput, Field, Modal, NumberInput, Row, Slider } from "./ui";

function hexFromRgb(color: Rgb): string {
  const h = (channel: number) => channel.toString(16).padStart(2, "0");
  return `#${h(color.r)}${h(color.g)}${h(color.b)}`;
}

async function rgbaImageToPngFile(image: RgbaImage, name: string): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("could not encode PNG");
  context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("could not encode PNG");
  return new File([blob], name, { type: "image/png" });
}

function Preview({ image }: { image: RgbaImage }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")?.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  }, [image]);

  return (
    <canvas
      ref={ref}
      className="max-h-[min(28rem,70vh)] max-w-full"
      style={{ height: "auto", imageRendering: "pixelated" }}
    />
  );
}

export function TemplateBuilderModal() {
  const role = useServer((state) => state.project?.role);
  const busy = useUi((state) => state.busy);
  const [spec, setSpec] = useState<IsoTemplateSpec>(() =>
    normalizeIsoTemplateSpec({
      pitch: useDoc.getState().settings.isoPitch,
      light: useDoc.getState().settings.isoLight
    })
  );
  const image = useMemo(() => renderIsoTemplate(spec), [spec]);
  const readOnly = role === "viewer";
  const saving = busy === "saving template";

  const patch = (next: Partial<IsoTemplateSpec>) => {
    setSpec((current) => normalizeIsoTemplateSpec({ ...current, ...next }));
  };

  const add = async () => {
    if (readOnly || saving) return;
    const file = await rgbaImageToPngFile(image, isoTemplateFileName(spec));
    await useServer.getState().uploadTemplate(file, { slot: "base", cutBackground: false });
    useUi.getState().closeTemplateBuilder();
  };

  const volume = spec.shape === "prism" || spec.shape === "building";
  const city = spec.shape === "intersection";

  return (
    <Modal
      title="Template builder"
      width={880}
      onClose={() => useUi.getState().closeTemplateBuilder()}
      footer={
        <Row className="justify-end">
          <Button
            variant="primary"
            disabled={readOnly || saving}
            onClick={() => void add()}
          >
            {saving ? "saving…" : "Add as reference"}
          </Button>
        </Row>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        <div>
          <Field label="Shape">
            <Row className="flex-wrap">
              {ISO_TEMPLATE_SHAPES.map((shape) => (
                <Button
                  key={shape}
                  variant={spec.shape === shape ? "primary" : "ghost"}
                  onClick={() => {
                    if (shape === "diamond") patch({ shape, fill: ISO_TEMPLATE_DIAMOND });
                    else if (shape === "sphere") patch({ shape, fill: ISO_TEMPLATE_SPHERE });
                    else if (spec.shape === "diamond" || spec.shape === "sphere") {
                      patch({ shape, fill: ISO_TEMPLATE_FILL });
                    } else patch({ shape });
                  }}
                >
                  {ISO_TEMPLATE_SHAPE_LABELS[shape]}
                </Button>
              ))}
            </Row>
          </Field>

          <IsoPitchField
            pitch={spec.pitch}
            min={MIN_ISO_TEMPLATE_PITCH}
            max={MAX_ISO_TEMPLATE_PITCH}
            onChange={(pitch) => patch({ pitch })}
          />

          {spec.shape !== "diamond" && spec.shape !== "intersection" ? (
            <Field label="Yaw" hint={spec.yaw === 0 ? "front" : "iso"}>
              <Row>
                {ISO_TEMPLATE_YAWS.map((yaw) => (
                  <Button
                    key={yaw}
                    variant={spec.yaw === yaw ? "primary" : "ghost"}
                    onClick={() => patch({ yaw })}
                  >
                    {yaw === 0 ? "front" : "iso"}
                  </Button>
                ))}
              </Row>
            </Field>
          ) : null}

          <IsoLightField light={spec.light} onChange={(light) => patch({ light })} />

          <Field label="Export width" hint="px">
            <NumberInput
              integer
              min={16}
              max={2048}
              value={spec.width}
              onChange={(width) => patch({ width })}
            />
          </Field>

          {spec.shape === "sphere" ? (
            <Field label="Diameter" hint="relative">
              <NumberInput
                min={0.05}
                max={8}
                step={0.05}
                value={spec.extentX}
                onChange={(extentX) => patch({ extentX })}
              />
            </Field>
          ) : null}

          {volume ? (
            <>
              <Field label="Width" hint="east–west">
                <NumberInput
                  min={0.05}
                  max={8}
                  step={0.05}
                  value={spec.extentX}
                  onChange={(extentX) => patch({ extentX })}
                />
              </Field>
              <Field label="Depth" hint="north–south">
                <NumberInput
                  min={0.05}
                  max={8}
                  step={0.05}
                  value={spec.extentY}
                  onChange={(extentY) => patch({ extentY })}
                />
              </Field>
              <Field label="Height">
                <NumberInput
                  min={0.05}
                  max={8}
                  step={0.05}
                  value={spec.extentZ}
                  onChange={(extentZ) => patch({ extentZ })}
                />
              </Field>
            </>
          ) : null}

          {city ? (
            <>
              <Field label="Road" hint="of the cell">
                <Slider
                  min={0.04}
                  max={0.6}
                  step={0.01}
                  value={spec.roadWidth}
                  onChange={(roadWidth) => patch({ roadWidth })}
                />
              </Field>
              <Field label="Sidewalk" hint="of the cell">
                <Slider
                  min={0}
                  max={0.35}
                  step={0.01}
                  value={spec.sidewalkWidth}
                  onChange={(sidewalkWidth) => patch({ sidewalkWidth })}
                />
              </Field>
            </>
          ) : null}

          <Field label={spec.shape === "intersection" ? "Road colour" : "Fill"}>
            <ColorInput
              value={hexFromRgb(spec.shape === "intersection" ? spec.road : spec.fill)}
              onChange={(value) =>
                spec.shape === "intersection"
                  ? patch({ road: hexToRgb(value) })
                  : patch({ fill: hexToRgb(value) })
              }
            />
          </Field>

          {volume ? (
            <Field label="Top">
              <ColorInput value={hexFromRgb(spec.top)} onChange={(value) => patch({ top: hexToRgb(value) })} />
            </Field>
          ) : null}

          {spec.shape === "building" || city ? (
            <Field label="Lot">
              <ColorInput value={hexFromRgb(spec.lot)} onChange={(value) => patch({ lot: hexToRgb(value) })} />
            </Field>
          ) : null}

          {city ? (
            <Field label="Sidewalk colour">
              <ColorInput
                value={hexFromRgb(spec.sidewalk)}
                onChange={(value) => patch({ sidewalk: hexToRgb(value) })}
              />
            </Field>
          ) : null}
        </div>

        <div className="checkerboard flex min-h-[16rem] items-center justify-center rounded border border-[var(--color-edge)] p-3">
          <Preview image={image} />
        </div>
      </div>

      <p className="mt-3 text-[10px] tabular-nums text-slate-500">
        {image.width}×{image.height}
        {spec.shape !== "diamond" && spec.shape !== "intersection"
          ? ` · ${spec.extentX}×${spec.shape === "sphere" ? spec.extentX : spec.extentY}×${spec.shape === "sphere" ? spec.extentX : spec.extentZ}`
          : ""}
      </p>
    </Modal>
  );
}
