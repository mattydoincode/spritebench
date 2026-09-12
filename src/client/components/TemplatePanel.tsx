"use client";

import { useEffect, useState, type DragEvent } from "react";
import { sourceUrl } from "@/client/api";
import { canAcceptTemplateDrop, readTemplateDrop } from "@/client/dragAssets";
import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";
import {
  ISO_DIAMOND_TEMPLATE_ID,
  ISO_DIAMOND_TEMPLATE_NAME,
  isIsoDiamondTemplate
} from "@/core/isoMask";
import {
  PIXEL_CONSTRAINT_TEMPLATE_ID,
  PIXEL_CONSTRAINT_TEMPLATE_NAME,
  isLayoutGuideTemplate,
  isPixelConstraintTemplate,
  pixelConstraintWindow
} from "@/core/pixelMask";
import { MASK_SOURCES, TEMPLATE_FIT_MODES, type Size } from "@/core/types";
import { snapRequestSize } from "@/providers/models";
import type { BaseSpec, ImageSource, MaskSpec } from "@/shared/model";
import { Button, ExpandablePreview, Field, NumberInput, Row, Select, Slider } from "./ui";

type TemplateMode = "none" | "iso" | "pixel" | "custom";

function templateMode(mask: MaskSpec | null, custom: boolean): TemplateMode {
  const id = mask?.source.kind === "template" ? mask.source.templateId : null;
  if (id && isIsoDiamondTemplate(id)) return "iso";
  if (id && isPixelConstraintTemplate(id)) return "pixel";
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

function templateBase(templateId: string, previous: BaseSpec | null): BaseSpec {
  return {
    source: { kind: "template", templateId },
    fit: previous?.fit ?? "contain",
    matchAspect: previous?.matchAspect ?? true
  };
}

function assetBase(assetId: string, previous: BaseSpec | null): BaseSpec {
  return {
    source: { kind: "asset", assetId },
    fit: previous?.fit ?? "contain",
    matchAspect: previous?.matchAspect ?? true
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
  plate?: { canvas: Size; window: Size }
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
    }
    return {
      src: `/api/projects/${projectId}/templates/file?${params}`,
      label: current.name,
      size:
        isPixelConstraintTemplate(source.templateId) && plate
          ? `${plate.canvas.width}x${plate.canvas.height} · ${plate.window.width}×${plate.window.height} cells`
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

function DropZone({
  hint,
  onFile,
  onAsset,
  assetsOnly
}: {
  hint: string;
  onFile?: (file: File) => void;
  onAsset: (assetId: string) => void;
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
        if (drop.kind === "asset") onAsset(drop.assetId);
        else if (!assetsOnly && onFile) onFile(drop.file);
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
  const base = useUi((state) => state.base);
  const mask = useUi((state) => state.mask);
  const loop = useUi((state) => state.loop);
  const chunk = useUi((state) => state.chunk);
  const templates = useServer((state) => state.templates);
  const assets = useServer((state) => state.assets);
  const settings = useServer((state) => state.settings);
  const generation = settings.generation;
  const pixelWindow = pixelConstraintWindow(settings.processing.targetSize);
  const pixelCanvas = snapRequestSize(generation.size, generation.model);
  const projectId = useServer((state) => state.project?.id ?? null);
  const busy = useUi((state) => state.busy);
  const store = useServer.getState;
  const ui = useUi.getState;

  const starting = loop.enabled || chunk.enabled;
  const [showAlpha, setShowAlpha] = useState(false);
  const [custom, setCustom] = useState(false);
  const mode = templateMode(mask, custom);

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
    const id = base?.source.kind === "template" ? base.source.templateId : null;
    if (!id || !isLayoutGuideTemplate(id)) return;
    if (!mask) ui().setMask(templateMask(id, null));
    ui().setBase(null);
  }, [base, mask, ui]);

  const basePreview =
    base && projectId ? sourcePreview(base.source, projectId, templates, assets, showAlpha) : null;
  const maskPreview =
    mask && projectId
      ? sourcePreview(
          mask.source,
          projectId,
          templates,
          assets,
          showAlpha,
          mask.source.kind === "template" && isPixelConstraintTemplate(mask.source.templateId)
            ? { canvas: pixelCanvas, window: pixelWindow }
            : undefined
        )
      : null;

  return (
    <div>
      <div className="mb-3">
        <Row className="mb-2 justify-between">
          <span className="text-[11px] uppercase tracking-wide text-slate-400">
            {starting ? "Starting image" : "Reference"}
          </span>
          {base ? (
            <Button variant="ghost" onClick={() => ui().setBase(null)}>
              clear
            </Button>
          ) : null}
        </Row>

        <DropZone
          assetsOnly={starting}
          hint={
            busy === "saving template"
              ? "processing template..."
              : starting
                ? "drag an asset from the library"
                : "drop a PNG, or drag an asset here"
          }
          onFile={(file) => void store().uploadTemplate(file, { slot: "base" })}
          onAsset={(assetId) => ui().setBase(assetBase(assetId, base))}
        />

        {!starting && templates.some((entry) => !isLayoutGuideTemplate(entry.id)) ? (
          <Field label="Saved templates">
            <select
              value={
                base?.source.kind === "template" && !isLayoutGuideTemplate(base.source.templateId)
                  ? base.source.templateId
                  : ""
              }
              onChange={(event) => {
                const value = event.target.value;
                ui().setBase(value ? templateBase(value, base) : null);
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

        {starting && assets.length > 0 ? (
          <Field label="Project assets">
            <select
              value={base?.source.kind === "asset" ? base.source.assetId : ""}
              onChange={(event) => {
                const value = event.target.value;
                ui().setBase(value ? assetBase(value, base) : null);
              }}
            >
              <option value="">(none)</option>
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

        {base && basePreview ? (
          <>
            <TemplateThumb src={basePreview.src} alt={basePreview.label} size={basePreview.size} />
            <Row className="mb-2 justify-between">
              <span className="text-[10px] text-slate-500">{basePreview.size}</span>
              <Button variant="ghost" onClick={() => setShowAlpha(!showAlpha)}>
                {showAlpha ? "show colour" : "show alpha"}
              </Button>
            </Row>
            <Field label="Fit" hint="how the image maps onto the request size">
              <Select
                value={base.fit}
                options={TEMPLATE_FIT_MODES}
                onChange={(fit) => ui().setBase({ ...base, fit })}
              />
            </Field>
            <div className="mb-2">
              <label className="flex items-center gap-2 text-[11px] text-slate-400">
                <input
                  type="checkbox"
                  checked={base.matchAspect}
                  onChange={(event) => ui().setBase({ ...base, matchAspect: event.target.checked })}
                />
                Match the request aspect to the image
              </label>
            </div>
          </>
        ) : null}
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
              ["pixel", PIXEL_CONSTRAINT_TEMPLATE_NAME],
              ["custom", "Custom"]
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              variant={mode === id ? "primary" : "ghost"}
              title={
                id === "iso"
                  ? "2:1 diamond plate. The model draws inside the tile footprint."
                  : id === "pixel"
                    ? "Grey checkerboard at request size; each square is one asset pixel."
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
                if (id === "pixel") {
                  setCustom(false);
                  ui().setMask(templateMask(PIXEL_CONSTRAINT_TEMPLATE_ID, mask));
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

        {mode === "custom" ? (
          <>
            <DropZone
              hint={
                busy === "saving template"
                  ? "processing template..."
                  : "paste a sketch, drop a PNG, or drag an asset here"
              }
              onFile={(file) => void store().uploadTemplate(file, { slot: "mask" })}
              onAsset={(assetId) => void store().uploadTemplateFromAsset(assetId, "mask")}
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

        {mask && maskPreview && (mode === "iso" || mode === "pixel" || mode === "custom") ? (
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
