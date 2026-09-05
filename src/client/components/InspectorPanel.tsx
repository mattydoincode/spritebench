"use client";

import { useEffect, useState } from "react";
import { useStudio } from "@/client/store";
import {
  CUTOUT_MODES,
  DISTANCE_MODES,
  DITHER_MODES,
  ORIENTATIONS,
  PIXELATE_MODES
} from "@/core/types";
import { BitmapCanvas, useAssetPalette, useProcessed } from "./AssetBitmap";
import {
  Button,
  ColorInput,
  Divider,
  Field,
  NumberInput,
  Panel,
  Row,
  Select,
  Slider,
  Toggle
} from "./ui";

type ViewMode = "processed" | "source" | "alpha";

const PIXELATE_LABELS: Record<string, string> = {
  dominantColor: "dominant colour (chunky pixel art)",
  boxAverage: "box average (soft pixel art)",
  nearest: "nearest (hard, aliased)",
  bilinear: "bilinear (smooth shrink)",
  bicubic: "bicubic (smooth shrink)",
  lanczos: "lanczos (sharpest smooth shrink)"
};

const CUTOUT_LABELS: Record<string, string> = {
  none: "keep the background",
  edgeFloodFill: "flood fill from the edges",
  chromaKey: "chroma key a colour",
  luminanceAbove: "clear pixels brighter than",
  luminanceBelow: "clear pixels darker than"
};

export function InspectorPanel() {
  const assets = useStudio((state) => state.assets);
  const selectedIds = useStudio((state) => state.selectedIds);
  const palettes = useStudio((state) => state.palettes);
  const playgroundPalette = useStudio((state) => state.composition.palette);
  const busy = useStudio((state) => state.busy);
  const store = useStudio.getState;

  const asset = assets.find((entry) => entry.id === selectedIds[selectedIds.length - 1]) ?? null;
  const [view, setView] = useState<ViewMode>("processed");
  const [exportName, setExportName] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    setExportName(asset?.approvedName ?? asset?.name ?? "");
  }, [asset?.id, asset?.approvedName, asset?.name]);

  const palette = useAssetPalette(asset);
  const { preview, error, loading } = useProcessed(asset, palette, view === "source");

  if (!asset) {
    return (
      <Panel title="Inspector">
        <p className="text-[11px] text-slate-500">
          Select an asset in the library to tune its size, cutout, and palette. Every asset keeps
          its own snapshot, so editing one never touches the others.
        </p>
      </Panel>
    );
  }

  const processing = asset.processing;

  const update = (patch: Partial<typeof processing>) =>
    store().updateProcessing(asset.id, patch);

  const showBitmap = view === "source" ? preview?.sourceBitmap : preview?.processed;
  const bitmapWidth = view === "source" ? preview?.sourceWidth ?? 0 : preview?.width ?? 0;
  const bitmapHeight = view === "source" ? preview?.sourceHeight ?? 0 : preview?.height ?? 0;
  const previewScale = bitmapWidth > 0 ? Math.min(1, 260 / bitmapWidth, 260 / bitmapHeight) : 1;

  return (
    <Panel
      title="Inspector"
      actions={
        <Button
          variant="danger"
          title="Delete this asset and its raw source file"
          onClick={() => {
            if (confirm(`Delete ${asset.name} and its source PNG?`)) {
              void store().deleteAsset(asset.id);
            }
          }}
        >
          delete
        </Button>
      }
    >
      <Row className="mb-2">
        {(["processed", "source", "alpha"] as ViewMode[]).map((mode) => (
          <Button
            key={mode}
            variant={view === mode ? "primary" : "ghost"}
            onClick={() => setView(mode)}
          >
            {mode}
          </Button>
        ))}

        <span className="flex-1" />

        <Button
          variant={processing.edits.length > 0 ? "primary" : "default"}
          title="Crop this image without touching the raw file, for every instance at once"
          onClick={() => store().openImageEditor(asset.id)}
        >
          {processing.edits.length > 0 ? `edit (${processing.edits.length})` : "edit"}
        </Button>
      </Row>

      <div className="checkerboard mb-2 flex min-h-[120px] items-center justify-center rounded p-2">
        {error ? (
          <span className="p-2 text-center text-[11px] text-rose-300">{error}</span>
        ) : showBitmap ? (
          <BitmapCanvas
            bitmap={showBitmap}
            width={bitmapWidth}
            height={bitmapHeight}
            showAlpha={view === "alpha"}
            pixelated={previewScale >= 1}
            style={{
              width: Math.max(1, Math.round(bitmapWidth * previewScale)),
              height: Math.max(1, Math.round(bitmapHeight * previewScale))
            }}
          />
        ) : (
          <span className="text-[11px] text-slate-500">{loading ? "processing..." : ""}</span>
        )}
      </div>

      <p className="mb-3 text-[10px] leading-snug text-slate-500">
        {preview ? (
          <>
            source {preview.sourceWidth}x{preview.sourceHeight} to {preview.width}x{preview.height}
            {preview.description ? <> &middot; {preview.description}</> : null}
          </>
        ) : null}
      </p>

      <Field label="Name">
        <input
          type="text"
          value={asset.name}
          onChange={(event) => store().updateAsset(asset.id, { name: event.target.value })}
        />
      </Field>

      <Row>
        <div className="flex-1">
          <Field label="Folder">
            <input
              type="text"
              value={asset.folder}
              onChange={(event) => store().updateAsset(asset.id, { folder: event.target.value })}
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Tags" hint="comma separated">
            <input
              type="text"
              value={asset.tags.join(", ")}
              onChange={(event) =>
                store().updateAsset(asset.id, {
                  tags: event.target.value
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter((tag) => tag.length > 0)
                })
              }
            />
          </Field>
        </div>
      </Row>

      <Divider label="size" />

      <Row>
        <div className="flex-1">
          <Field label="Width" hint="0 = from height">
            <NumberInput
              value={processing.targetSize.width}
              min={0}
              onChange={(value) =>
                update({
                  targetSize: { ...processing.targetSize, width: Math.max(0, Math.round(value)) }
                })
              }
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Height" hint="0 = from width">
            <NumberInput
              value={processing.targetSize.height}
              min={0}
              onChange={(value) =>
                update({
                  targetSize: { ...processing.targetSize, height: Math.max(0, Math.round(value)) }
                })
              }
            />
          </Field>
        </div>
      </Row>

      <Field label="Downsample" hint="pixelated or smooth">
        <Select
          value={processing.pixelate}
          options={PIXELATE_MODES}
          labels={PIXELATE_LABELS}
          onChange={(value) => update({ pixelate: value })}
        />
      </Field>

      <Row className="mb-2">
        {[16, 24, 32, 48, 64, 128].map((height) => (
          <Button
            key={height}
            variant="ghost"
            onClick={() => update({ targetSize: { width: 0, height } })}
          >
            {height}
          </Button>
        ))}
      </Row>

      <Divider label="transparency" />

      <Field label="Cutout">
        <Select
          value={processing.cutout}
          options={CUTOUT_MODES}
          labels={CUTOUT_LABELS}
          onChange={(value) => update({ cutout: value })}
        />
      </Field>

      {processing.cutout === "edgeFloodFill" || processing.cutout === "chromaKey" ? (
        <Field label="Tolerance" hint="how far a colour can stray">
          <Slider
            min={0}
            max={1}
            value={processing.cutoutTolerance}
            onChange={(value) => update({ cutoutTolerance: value })}
          />
        </Field>
      ) : null}

      {processing.cutout === "edgeFloodFill" ? (
        <Field label="Local tolerance" hint="stops the fill at edges">
          <Slider
            min={0}
            max={1}
            value={processing.cutoutLocalTolerance}
            onChange={(value) => update({ cutoutLocalTolerance: value })}
          />
        </Field>
      ) : null}

      {processing.cutout === "chromaKey" ? (
        <Field label="Key colour">
          <ColorInput
            value={processing.chromaKey}
            fallback="#ff00ff"
            onChange={(value) => update({ chromaKey: value })}
          />
        </Field>
      ) : null}

      {processing.cutout === "luminanceAbove" || processing.cutout === "luminanceBelow" ? (
        <Field label="Luminance threshold">
          <Slider
            min={0}
            max={1}
            value={processing.cutoutLuminanceThreshold}
            onChange={(value) => update({ cutoutLuminanceThreshold: value })}
          />
        </Field>
      ) : null}

      <Toggle
        label="Snap alpha to fully on or off"
        checked={processing.snapAlpha}
        onChange={(value) => update({ snapAlpha: value })}
      />

      <Field label="Alpha threshold">
        <Slider
          min={0}
          max={1}
          value={processing.alphaThreshold}
          onChange={(value) => update({ alphaThreshold: value })}
        />
      </Field>

      <Toggle
        label="Trim to content"
        checked={processing.trimToContent}
        onChange={(value) => update({ trimToContent: value })}
      />

      <Divider label="palette" />

      <Field label="Palette" hint={`${palette.length} colours`}>
        <Select
          value={processing.paletteFile}
          options={["", ...palettes.map((entry) => entry.file)] as const}
          labels={{ "": "(full colour)" }}
          onChange={(value) => update({ paletteFile: value })}
        />
      </Field>

      {processing.paletteFile === "" && playgroundPalette !== "" ? (
        <p className="mb-2 text-[10px] leading-snug text-amber-300">
          The playground is previewing this with {playgroundPalette}, but it exports in full colour
          until you pick a palette here or bake the playground one in. Choosing one here always wins
          over the playground.
        </p>
      ) : null}

      {palette.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-0.5">
          {palette.slice(0, 64).map((colour, index) => (
            <span
              key={index}
              className="h-3 w-3 rounded-sm"
              style={{ background: `rgb(${colour.r},${colour.g},${colour.b})` }}
            />
          ))}
        </div>
      ) : null}

      {processing.paletteFile ? (
        <>
          <Field label="Dither">
            <Select
              value={processing.dither}
              options={DITHER_MODES}
              onChange={(value) => update({ dither: value })}
            />
          </Field>

          {processing.dither !== "none" ? (
            <Field label="Dither strength">
              <Slider
                min={0}
                max={1}
                value={processing.ditherStrength}
                onChange={(value) => update({ ditherStrength: value })}
              />
            </Field>
          ) : null}

          <Field label="Colour matching">
            <Select
              value={processing.distanceMode}
              options={DISTANCE_MODES}
              onChange={(value) => update({ distanceMode: value })}
            />
          </Field>
        </>
      ) : null}

      <Divider />

      <Row className="mb-2">
        <Button variant="ghost" onClick={() => setShowAdvanced(!showAdvanced)}>
          {showAdvanced ? "\u25be" : "\u25b8"} orientation and cleanup
        </Button>
      </Row>

      {showAdvanced ? (
        <>
          <Field label="Rotate">
            <Select
              value={processing.orientation}
              options={ORIENTATIONS}
              onChange={(value) => update({ orientation: value })}
            />
          </Field>

          <Row>
            <Toggle
              label="flip x"
              checked={processing.flipHorizontal}
              onChange={(value) => update({ flipHorizontal: value })}
            />
            <Toggle
              label="flip y"
              checked={processing.flipVertical}
              onChange={(value) => update({ flipVertical: value })}
            />
          </Row>

          <Field label="Despeckle" hint="min opaque neighbours">
            <NumberInput
              value={processing.despeckleMinimumNeighbors}
              min={0}
              onChange={(value) =>
                update({ despeckleMinimumNeighbors: Math.max(0, Math.round(value)) })
              }
            />
          </Field>

          <Toggle
            label="Fill single-pixel holes"
            checked={processing.fillHoles}
            onChange={(value) => update({ fillHoles: value })}
          />

          <Field label="Erode edges" hint="pixels">
            <NumberInput
              value={processing.erodePixels}
              min={0}
              onChange={(value) => update({ erodePixels: Math.max(0, Math.round(value)) })}
            />
          </Field>

          <Field label="Trim padding" hint="pixels">
            <NumberInput
              value={processing.trimPadding}
              min={0}
              onChange={(value) => update({ trimPadding: Math.max(0, Math.round(value)) })}
            />
          </Field>

          <Field label="Skip cutout when the border is this transparent">
            <Slider
              min={0}
              max={1}
              value={processing.skipCutoutTransparentBorder}
              onChange={(value) => update({ skipCutoutTransparentBorder: value })}
            />
          </Field>

          <Toggle
            label="Sample only the corners for the background colour"
            checked={processing.sampleCornersOnly}
            onChange={(value) => update({ sampleCornersOnly: value })}
          />
        </>
      ) : null}

      <Divider label="prompt" />

      <Field label="Prompt body" hint="reruns reuse this">
        <textarea
          rows={3}
          value={asset.prompt.body}
          onChange={(event) =>
            store().updateAsset(asset.id, {
              prompt: { ...asset.prompt, body: event.target.value }
            })
          }
        />
      </Field>

      <Divider label="output" />

      {selectedIds.length > 1 ? (
        <Button
          className="mb-2 w-full"
          title="Copy this asset's processing settings onto every selected asset"
          onClick={() => store().applyProcessingToSelection(processing)}
        >
          apply these settings to all {selectedIds.length} selected
        </Button>
      ) : null}

      <Button className="mb-2 w-full" onClick={() => store().stageAsset(asset.id)}>
        add to playground
      </Button>

      <Field label="Export filename" hint="art/approved/props">
        <input
          type="text"
          value={exportName}
          onChange={(event) => setExportName(event.target.value)}
        />
      </Field>

      <Button
        variant="primary"
        className="w-full"
        disabled={busy !== null}
        onClick={() => void store().approve(asset.id, exportName)}
      >
        {busy === "exporting" ? "exporting..." : "export png for Godot"}
      </Button>

      {asset.approvedPath ? (
        <p className="mt-2 text-[10px] break-all text-emerald-400">{asset.approvedPath}</p>
      ) : null}
    </Panel>
  );
}
