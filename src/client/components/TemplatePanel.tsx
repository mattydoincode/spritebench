"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { sourceUrl } from "@/client/api";
import { canAcceptTemplateDrop, readTemplateDrop } from "@/client/dragAssets";
import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";
import {
  ISO_21_TEMPLATE_ID,
  ISO_21_TEMPLATE_NAME,
  ISO_DIAMOND_TEMPLATE_ID,
  ISO_DIAMOND_TEMPLATE_NAME,
  isIsoDiamondTemplate,
  isoProjectionForTemplate
} from "@/core/isoMask";
import {
  SHEET_FRAMES_TEMPLATE_ID,
  SHEET_FRAMES_TEMPLATE_NAME,
  buildSheetFramesTemplate,
  isSheetFramesTemplate,
  previewSheetFramesPlan
} from "@/core/frameMask";
import {
  PIXEL_CONSTRAINT_TEMPLATE_ID,
  PIXEL_CONSTRAINT_TEMPLATE_NAME,
  buildPixelConstraintTemplate,
  buildSheetPixelConstraintTemplate,
  isLayoutGuideTemplate,
  isPixelConstraintTemplate,
  pixelConstraintWindow
} from "@/core/pixelMask";
import { MASK_SOURCES, TEMPLATE_FIT_MODES, type RgbaImage, type Size } from "@/core/types";
import { snapRequestSize } from "@/providers/models";
import { planAnimation, planItemGrid } from "@/shared/animationPrompt";
import { activeFeaturePrompts } from "@/shared/featurePrompt";
import type { BaseSpec, ImageSource, MaskSpec } from "@/shared/model";
import { SuggestedPrompt } from "./SuggestedPrompt";
import { Button, ExpandablePreview, Field, NumberInput, Row, Select, Slider } from "./ui";

type TemplateMode = "none" | "iso" | "iso21" | "pixel" | "frames" | "custom";

function templateMode(mask: MaskSpec | null, custom: boolean): TemplateMode {
  const id = mask?.source.kind === "template" ? mask.source.templateId : null;
  if (id && isIsoDiamondTemplate(id)) {
    return isoProjectionForTemplate(id) === "dimetric" ? "iso21" : "iso";
  }
  if (id && isPixelConstraintTemplate(id)) return "pixel";
  if (id && isSheetFramesTemplate(id)) return "frames";
  if (mask || custom) return "custom";
  return "none";
}

const MASK_LABELS: Record<string, string> = {
  alphaFromTemplate: "edit where template is transparent",
  transparentWhereDark: "edit the dark strokes",
  transparentWhereLight: "edit the light areas",
  keepInsideShape: "edit inside the drawn shape",
  keepOutsideShape: "protect the shape, edit around it"
};

function templateBase(templateId: string, previous: BaseSpec[]): BaseSpec {
  return {
    source: { kind: "template", templateId },
    fit: previous[0]?.fit ?? "contain",
    matchAspect: previous[0]?.matchAspect ?? true
  };
}

function assetBase(assetId: string, previous: BaseSpec[]): BaseSpec {
  return {
    source: { kind: "asset", assetId },
    fit: previous[0]?.fit ?? "contain",
    matchAspect: previous[0]?.matchAspect ?? true
  };
}

function templateMask(templateId: string, previous: MaskSpec | null): MaskSpec {
  if (isIsoDiamondTemplate(templateId)) {
    return {
      source: { kind: "template", templateId },
      maskSource: "keepInsideShape",
      dilatePixels: 0,
      fit: "contain"
    };
  }

  if (isPixelConstraintTemplate(templateId)) {
    return {
      source: { kind: "template", templateId },
      maskSource: "transparentWhereLight",
      dilatePixels: 0,
      fit: "stretch",
      window: previous?.window
    };
  }

  if (isSheetFramesTemplate(templateId)) {
    return {
      source: { kind: "template", templateId },
      maskSource: "transparentWhereLight",
      dilatePixels: 0,
      fit: "stretch"
    };
  }

  return {
    source: { kind: "template", templateId },
    maskSource: previous?.maskSource ?? "keepOutsideShape",
    dilatePixels: previous?.dilatePixels ?? 0,
    fit: previous?.fit ?? "contain"
  };
}

function sourcePreview(
  source: ImageSource,
  projectId: string,
  templates: Array<{ id: string; name: string; width: number; height: number }>,
  assets: Array<{ id: string; seq: number; hasSource: boolean }>,
  alpha: boolean,
  plate?: {
    canvas: Size;
    window: Size;
    sheet?: { columns: number; rows: number; used?: number[] };
  }
): { src: string; label: string; size: string } | null {
  if (source.kind === "template") {
    const current = templates.find((entry) => entry.id === source.templateId);
    if (!current) return null;
    const params = new URLSearchParams({
      id: source.templateId,
      alpha: String(alpha)
    });
    if (isPixelConstraintTemplate(source.templateId) && plate) {
      params.set("cw", String(plate.canvas.width));
      params.set("ch", String(plate.canvas.height));
      params.set("ww", String(plate.window.width));
      params.set("wh", String(plate.window.height));
      if (plate.sheet) {
        params.set("sc", String(plate.sheet.columns));
        params.set("sr", String(plate.sheet.rows));
        if (plate.sheet.used?.length) params.set("used", plate.sheet.used.join(","));
      }
    }
    return {
      src: `/api/projects/${projectId}/templates/file?${params}`,
      label: current.name,
      size:
        isPixelConstraintTemplate(source.templateId) && plate
          ? plate.sheet
            ? `${plate.canvas.width}x${plate.canvas.height} · ${plate.sheet.columns}×${plate.sheet.rows} of ${plate.window.width}×${plate.window.height}`
            : `${plate.canvas.width}x${plate.canvas.height} · ${plate.window.width}×${plate.window.height} cells`
          : `${current.width}x${current.height}`
    };
  }

  const asset = assets.find((entry) => entry.id === source.assetId);
  if (!asset) return null;
  return {
    src: sourceUrl(projectId, source.assetId, "thumb"),
    label: String(asset.seq).padStart(3, "0"),
    size: asset.hasSource ? "asset" : "rolled off"
  };
}

function PlateCanvas({ image, maxHeight }: { image: RgbaImage; maxHeight: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  }, [image]);

  return (
    <canvas
      ref={ref}
      className="max-w-full"
      style={{ maxHeight, height: "auto", imageRendering: "pixelated" }}
    />
  );
}

function PlateThumb({ image, alt, size }: { image: RgbaImage; alt: string; size: string }) {
  return (
    <ExpandablePreview
      title={`${alt} · ${size}`}
      className="checkerboard mb-2 flex w-full items-center justify-center rounded border-0 bg-transparent p-2"
      expanded={<PlateCanvas image={image} maxHeight={800} />}
    >
      <PlateCanvas image={image} maxHeight={140} />
    </ExpandablePreview>
  );
}

function TemplateThumb({ src, alt, size }: { src: string; alt: string; size: string }) {
  return (
    <ExpandablePreview
      title={`${alt} · ${size}`}
      className="checkerboard mb-2 flex w-full items-center justify-center rounded border-0 bg-transparent p-2"
      expanded={
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={alt}
          src={src}
          className="max-h-[calc(100vh-5rem)] max-w-[calc(100vw-2rem)]"
          style={{ imageRendering: "pixelated" }}
        />
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt={alt} src={src} style={{ maxHeight: 140, imageRendering: "pixelated" }} />
    </ExpandablePreview>
  );
}

export function DropZone({
  hint,
  onFiles,
  onAssets,
  assetsOnly
}: {
  hint: string;
  onFiles?: (files: File[]) => void;
  onAssets: (assetIds: string[]) => void;
  assetsOnly?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);

  const accept = (event: DragEvent) =>
    canAcceptTemplateDrop(event.dataTransfer.types, assetsOnly);

  return (
    <div
      onDragEnter={(event) => {
        if (!accept(event)) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragOver={(event) => {
        if (!accept(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const drop = readTemplateDrop(event);
        if (!drop) return;
        if (drop.kind === "assets") onAssets(drop.assetIds);
        else if (!assetsOnly && onFiles) onFiles(drop.files);
      }}
      className={`mb-2 rounded border border-dashed p-3 text-center text-[11px] ${
        dragOver
          ? "border-[var(--color-accent)] bg-[var(--color-ink-600)] text-slate-300"
          : "border-[var(--color-edge)] text-slate-500"
      }`}
    >
      {hint}
    </div>
  );
}

export function TemplatePanel() {
  const bases = useUi((state) => state.bases);
  const mask = useUi((state) => state.mask);
  const loop = useUi((state) => state.loop);
  const chunk = useUi((state) => state.chunk);
  const each = useUi((state) => state.each);
  const templates = useServer((state) => state.templates);
  const assets = useServer((state) => state.assets);
  const settings = useServer((state) => state.settings);
  const animation = useUi((state) => state.animation);
  const itemGrid = useUi((state) => state.itemGrid);
  const generation = settings.generation;
  const pixelWindow = pixelConstraintWindow(settings.processing.targetSize);
  const pixelCanvas = snapRequestSize(generation.size, generation.model);
  const sheet = animation.enabled
    ? planAnimation({
        subject: "",
        actions: animation.actions,
        cellSize: animation.cellSize
      })
    : itemGrid.enabled
      ? planItemGrid({
          subject: "",
          columns: itemGrid.columns,
          rows: itemGrid.rows,
          cellSize: itemGrid.cellSize
        })
      : null;
  const projectId = useServer((state) => state.project?.id ?? null);
  const busy = useUi((state) => state.busy);
  const store = useServer.getState;
  const ui = useUi.getState;

  const starting = loop.enabled || chunk.enabled || each.enabled;
  const assetsOnly = loop.enabled || chunk.enabled;
  const [showAlpha, setShowAlpha] = useState(false);
  const [custom, setCustom] = useState(false);
  const mode = templateMode(mask, custom);
  const sheetOn = animation.enabled || itemGrid.enabled;
  const extras = activeFeaturePrompts({
    model: generation.model,
    mask,
    base: sheetOn ? null : (bases[0] ?? null),
    each: each.enabled,
    animation,
    itemGrid
  });
  const suggested = (id: (typeof extras)[number]["id"]) => {
    const entry = extras.find((item) => item.id === id);
    return entry ? <SuggestedPrompt text={entry.defaultText} /> : null;
  };

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

      const file = [...(event.clipboardData?.items ?? [])]
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .find((entry): entry is File => entry !== null);

      if (!file) return;

      event.preventDefault();
      setCustom(true);
      void store().uploadTemplate(file, { slot: "mask" });
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [store]);

  useEffect(() => {
    const guides = bases.filter(
      (entry) => entry.source.kind === "template" && isLayoutGuideTemplate(entry.source.templateId)
    );
    if (guides.length === 0) return;

    const id = guides[0].source.kind === "template" ? guides[0].source.templateId : null;
    if (id && !mask) ui().setMask(templateMask(id, null));
    ui().setBases(
      bases.filter(
        (entry) =>
          !(entry.source.kind === "template" && isLayoutGuideTemplate(entry.source.templateId))
      )
    );
  }, [bases, mask, ui]);

  const basePreviews = projectId
    ? bases.map((entry) => sourcePreview(entry.source, projectId, templates, assets, showAlpha))
    : [];
  const base = bases[0] ?? null;
  const maskPreview =
    mask && projectId && mode !== "pixel" && mode !== "frames"
      ? sourcePreview(mask.source, projectId, templates, assets, showAlpha)
      : null;
  const pixelPlate = useMemo(() => {
    if (mode !== "pixel") return null;
    const canvas = { width: pixelCanvas.width, height: pixelCanvas.height };
    const cells = { width: pixelWindow.width, height: pixelWindow.height };
    if (animation.enabled) {
      return buildSheetPixelConstraintTemplate(
        canvas,
        cells,
        planAnimation({
          subject: "",
          actions: animation.actions,
          cellSize: animation.cellSize
        }).plan
      );
    }
    if (itemGrid.enabled) {
      return buildSheetPixelConstraintTemplate(
        canvas,
        cells,
        planItemGrid({
          subject: "",
          columns: itemGrid.columns,
          rows: itemGrid.rows,
          cellSize: itemGrid.cellSize
        }).plan
      );
    }
    return buildPixelConstraintTemplate(canvas, cells);
  }, [
    mode,
    pixelCanvas.width,
    pixelCanvas.height,
    pixelWindow.width,
    pixelWindow.height,
    animation.enabled,
    animation.actions,
    animation.cellSize,
    itemGrid.enabled,
    itemGrid.columns,
    itemGrid.rows,
    itemGrid.cellSize
  ]);
  const pixelPlateSize = sheet
    ? `${pixelCanvas.width}x${pixelCanvas.height} · ${sheet.plan.columns}×${sheet.plan.rows} of ${pixelWindow.width}×${pixelWindow.height}`
    : `${pixelCanvas.width}x${pixelCanvas.height} · ${pixelWindow.width}×${pixelWindow.height} cells`;

  const framesCanvas = sheet
    ? snapRequestSize(sheet.sheet.size, generation.model)
    : pixelCanvas;
  const framesPlate = useMemo(() => {
    if (mode !== "frames") return null;
    const plan = sheet
      ? sheet.plan
      : previewSheetFramesPlan();
    return buildSheetFramesTemplate(framesCanvas, plan);
  }, [
    mode,
    framesCanvas.width,
    framesCanvas.height,
    sheet,
    animation.enabled,
    animation.actions,
    animation.cellSize,
    itemGrid.enabled,
    itemGrid.columns,
    itemGrid.rows,
    itemGrid.cellSize
  ]);
  const framesPlateSize = sheet
    ? `${framesCanvas.width}x${framesCanvas.height} · ${sheet.plan.columns}×${sheet.plan.rows} cells`
    : `${framesCanvas.width}x${framesCanvas.height} · 2×2 cells`;

  return (
    <div>
      <div className="mb-3">
        <Row className="mb-2 justify-between">
          <span className="text-[11px] uppercase tracking-wide text-slate-400">
            {each.enabled ? "Images to edit" : starting ? "Starting images" : "References"}
          </span>
          <Row>
            {!assetsOnly ? (
              <Button variant="ghost" onClick={() => ui().openTemplateBuilder()}>
                build
              </Button>
            ) : null}
            {bases.length > 0 ? (
              <Button variant="ghost" onClick={() => ui().setBases([])}>
                clear
              </Button>
            ) : null}
          </Row>
        </Row>

        <DropZone
          assetsOnly={assetsOnly}
          hint={
            busy === "saving template"
              ? "processing template..."
              : each.enabled
                ? "drop PNGs or drag assets — each one is its own edit"
                : starting
                  ? loop.enabled
                    ? "drag assets from the library — each one is its own loop"
                    : "drag assets from the library — each one is its own grid"
                  : "drop PNGs or drag assets — each one is its own job"
          }
          onFiles={(files) => void store().uploadTemplates(files, { slot: "base" })}
          onAssets={(assetIds) =>
            ui().addBases(assetIds.map((assetId) => assetBase(assetId, bases)))
          }
        />

        {!assetsOnly && templates.some((entry) => !isLayoutGuideTemplate(entry.id)) ? (
          <Field label="Saved templates">
            <select
              value=""
              onChange={(event) => {
                const value = event.target.value;
                if (value) ui().addBases([templateBase(value, bases)]);
              }}
            >
              <option value="">add…</option>
              {templates
                .filter((entry) => !isLayoutGuideTemplate(entry.id))
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
            </select>
          </Field>
        ) : null}

        {starting && assets.length > 0 ? (
          <Field label="Project assets">
            <select
              value=""
              onChange={(event) => {
                const value = event.target.value;
                if (value) ui().addBases([assetBase(value, bases)]);
              }}
            >
              <option value="">add…</option>
              {assets
                .filter((entry) => entry.hasSource)
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {String(entry.seq).padStart(3, "0")}
                  </option>
                ))}
            </select>
          </Field>
        ) : null}

        {bases.length > 0 ? (
          <>
            <div className="mb-2 grid grid-cols-2 gap-2">
              {bases.map((entry, index) => {
                const preview = basePreviews[index];
                return (
                  <div key={`${entry.source.kind}:${index}`} className="relative">
                    {preview ? (
                      <TemplateThumb src={preview.src} alt={preview.label} size={preview.size} />
                    ) : (
                      <div className="mb-2 rounded border border-[var(--color-edge)] p-2 text-[10px] text-slate-500">
                        missing
                      </div>
                    )}
                    <Row className="mb-1 justify-between">
                      <span className="truncate text-[10px] text-slate-500">
                        {preview?.label ?? "ref"}
                      </span>
                      <Button variant="ghost" onClick={() => ui().removeBase(index)}>
                        remove
                      </Button>
                    </Row>
                  </div>
                );
              })}
            </div>
            <Row className="mb-2 justify-between">
              <span className="text-[10px] text-slate-500">
                {bases.length === 1
                  ? basePreviews[0]?.size
                  : `${bases.length} ${starting ? "starts" : "templates"} — one job each`}
              </span>
              <Button variant="ghost" onClick={() => setShowAlpha(!showAlpha)}>
                {showAlpha ? "show colour" : "show alpha"}
              </Button>
            </Row>
            <Field label="Fit" hint="how each image maps onto the request size">
              <Select
                value={base?.fit ?? "contain"}
                options={TEMPLATE_FIT_MODES}
                onChange={(fit) => ui().patchBases({ fit })}
              />
            </Field>
            <div className="mb-2">
              <label className="flex items-center gap-2 text-[11px] text-slate-400">
                <input
                  type="checkbox"
                  checked={base?.matchAspect ?? true}
                  onChange={(event) => ui().patchBases({ matchAspect: event.target.checked })}
                />
                Match the request aspect to the image
              </label>
            </div>
          </>
        ) : null}

        {each.enabled ? null : suggested("reference")}
      </div>

      <div>
        <Row className="mb-2 justify-between">
          <span className="text-[11px] uppercase tracking-wide text-slate-400">Template</span>
          {mode !== "none" ? (
            <Button
              variant="ghost"
              onClick={() => {
                setCustom(false);
                ui().setMask(null);
              }}
            >
              clear
            </Button>
          ) : null}
        </Row>

        <Row className="mb-2">
          {(
            [
              ["none", "None"],
              ["iso", ISO_DIAMOND_TEMPLATE_NAME],
              ["iso21", ISO_21_TEMPLATE_NAME],
              ["pixel", PIXEL_CONSTRAINT_TEMPLATE_NAME],
              ["frames", SHEET_FRAMES_TEMPLATE_NAME],
              ["custom", "Custom"]
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              variant={mode === id ? "primary" : "ghost"}
              title={
                id === "iso"
                  ? "True isometric diamond (120° axes, √3:1). The model draws inside the tile footprint."
                  : id === "iso21"
                    ? "2:1 dimetric diamond. Pixel-art tiles that step 2 across and 1 down."
                    : id === "pixel"
                    ? "Grey checkerboard at request size; each square is one asset pixel."
                    : id === "frames"
                      ? "Empty white cells with dark gutters. A sheet layout without the pixel grid."
                      : id === "custom"
                        ? "Upload or paste a sketch and treat it as a stencil."
                        : "No layout plate"
              }
              onClick={() => {
                if (id === "none") {
                  setCustom(false);
                  ui().setMask(null);
                  return;
                }
                if (id === "iso") {
                  setCustom(false);
                  ui().setMask(templateMask(ISO_DIAMOND_TEMPLATE_ID, mask));
                  return;
                }
                if (id === "iso21") {
                  setCustom(false);
                  ui().setMask(templateMask(ISO_21_TEMPLATE_ID, mask));
                  return;
                }
                if (id === "pixel") {
                  setCustom(false);
                  ui().setMask(templateMask(PIXEL_CONSTRAINT_TEMPLATE_ID, mask));
                  return;
                }
                if (id === "frames") {
                  setCustom(false);
                  ui().setMask(templateMask(SHEET_FRAMES_TEMPLATE_ID, mask));
                  return;
                }
                setCustom(true);
                if (mask && mask.source.kind === "template" && isLayoutGuideTemplate(mask.source.templateId)) {
                  ui().setMask(null);
                }
              }}
            >
              {label}
            </Button>
          ))}
        </Row>

        {mode === "pixel" ? (
          <p className="mb-2 text-[10px] leading-snug text-slate-500">
            Asset size is the grid ({pixelWindow.width}×{pixelWindow.height} cells). The plate is the
            request size ({pixelCanvas.width}×{pixelCanvas.height}); each square is one finished
            pixel.
          </p>
        ) : null}

        {mode === "frames" ? (
          <p className="mb-2 text-[10px] leading-snug text-slate-500">
            Empty white cells for each frame, dark gutters between them. No pixel grid and no
            downsample from this plate. Turn on an animation sheet or item grid to size the cells.
          </p>
        ) : null}

        {mode === "iso" || mode === "iso21" ? suggested("iso-diamond") : null}
        {mode === "pixel" ? suggested("pixel-constraint") : null}
        {mode === "frames" ? suggested("frames") : null}
        {mode === "custom" ? suggested("guide") : null}

        {mode === "custom" ? (
          <>
            <DropZone
              hint={
                busy === "saving template"
                  ? "processing template..."
                  : "paste a sketch, drop a PNG, or drag an asset here"
              }
              onFiles={(files) => {
                const file = files[0];
                if (file) void store().uploadTemplate(file, { slot: "mask" });
              }}
              onAssets={(assetIds) => {
                const assetId = assetIds[0];
                if (assetId) void store().uploadTemplateFromAsset(assetId, "mask");
              }}
            />

            <label className="mb-2 flex items-center gap-2 text-[11px] text-slate-400">
              <input
                type="checkbox"
                checked={settings.cutTemplateBackgroundOnPaste}
                onChange={(event) =>
                  store().patchSettings({ cutTemplateBackgroundOnPaste: event.target.checked })
                }
              />
              Remove the white background on paste
            </label>

            {settings.cutTemplateBackgroundOnPaste ? (
              <Field label="Paste cut tolerance">
                <Slider
                  min={0}
                  max={1}
                  value={settings.templateCutTolerance}
                  onChange={(value) => store().patchSettings({ templateCutTolerance: value })}
                />
              </Field>
            ) : null}

            {templates.some((entry) => !isLayoutGuideTemplate(entry.id)) ? (
              <Field label="Saved sketches">
                <select
                  value={
                    mask?.source.kind === "template" && !isLayoutGuideTemplate(mask.source.templateId)
                      ? mask.source.templateId
                      : ""
                  }
                  onChange={(event) => {
                    const value = event.target.value;
                    ui().setMask(value ? templateMask(value, mask) : null);
                  }}
                >
                  <option value="">(none)</option>
                  {templates
                    .filter((entry) => !isLayoutGuideTemplate(entry.id))
                    .map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                </select>
              </Field>
            ) : null}
          </>
        ) : null}

        {mode === "pixel" && pixelPlate ? (
          <>
            <PlateThumb image={pixelPlate} alt={PIXEL_CONSTRAINT_TEMPLATE_NAME} size={pixelPlateSize} />
            <Row className="mb-2 justify-between">
              <span className="text-[10px] text-slate-500">{pixelPlateSize}</span>
            </Row>
          </>
        ) : null}

        {mode === "frames" && framesPlate ? (
          <>
            <PlateThumb image={framesPlate} alt={SHEET_FRAMES_TEMPLATE_NAME} size={framesPlateSize} />
            <Row className="mb-2 justify-between">
              <span className="text-[10px] text-slate-500">{framesPlateSize}</span>
            </Row>
          </>
        ) : null}

        {mask && maskPreview && (mode === "iso" || mode === "iso21" || mode === "custom") ? (
          <>
            <TemplateThumb src={maskPreview.src} alt={maskPreview.label} size={maskPreview.size} />
            <Row className="mb-2 justify-between">
              <span className="text-[10px] text-slate-500">{maskPreview.size}</span>
              {mode === "custom" &&
              mask.source.kind === "template" &&
              !isLayoutGuideTemplate(mask.source.templateId) ? (
                <Button
                  variant="danger"
                  onClick={() => {
                    if (mask.source.kind !== "template") return;
                    void store().deleteTemplate(mask.source.templateId);
                  }}
                >
                  delete
                </Button>
              ) : null}
            </Row>
            {mode === "custom" ? (
              <details className="mb-2">
                <summary className="cursor-pointer text-[11px] text-slate-400">
                  Editable region
                </summary>
                <div className="mt-2">
                  <Field label="Where to draw">
                    <Select
                      value={mask.maskSource}
                      options={MASK_SOURCES}
                      labels={MASK_LABELS}
                      onChange={(maskSource) => ui().setMask({ ...mask, maskSource })}
                    />
                  </Field>
                  <Field label="Grow editable region" hint="pixels">
                    <NumberInput
                      value={mask.dilatePixels}
                      min={0}
                      onChange={(dilatePixels) =>
                        ui().setMask({ ...mask, dilatePixels: Math.max(0, dilatePixels) })
                      }
                    />
                  </Field>
                  <p className="text-[10px] leading-snug text-slate-500">
                    A stencil guides the model, it is not a hard cut. Expect the silhouette to be
                    approximate.
                  </p>
                </div>
              </details>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
