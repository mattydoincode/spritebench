"use client";

import { useEffect, useState } from "react";
import { useActiveScene, useAsset, useSelectedAsset, useSelectedJob } from "@/client/stores/assets";
import { useDoc } from "@/client/stores/doc";
import { useServer } from "@/client/stores/server";
import { DEFAULT_INSPECTOR_PREVIEW, useUi } from "@/client/stores/ui";
import { MAX_CHROMA_KEYS } from "@/core/settings";
import { isoProjectionFromSource } from "@/core/isoMask";
import { CUTOUT_LABELS, CUTOUT_MODES, DISTANCE_MODES, DITHER_MODES, ORIENTATIONS } from "@/core/types";
import { useMaskOverlay } from "@/client/maskOverlay";
import { PROCESS_PRIORITY } from "@/client/processor";
import { useSequenceFrames, useSequencePlayback } from "@/client/sequence";
import { isSetAsset } from "@/shared/repeaterMix";
import { frameSettings, frameSourceAssetId, type Sequence } from "@/shared/sequence";
import { AnimationSection } from "./AnimationSection";
import { SetSection } from "./SetSection";
import { BitmapCanvas, useAssetPalette, useProcessed } from "./AssetBitmap";
import { DownsampleControls } from "./DownsampleControls";
import { ExportDialog } from "./ExportDialog";
import { GenerationHistory } from "./GenerationHistory";
import { JobInspector } from "./JobInspector";
import { ResizeHandle } from "./ResizeHandle";
import { RightTabs } from "./RightTabs";
import {
  Button,
  ColorInput,
  ExpandablePreview,
  Section,
  Field,
  NumberInput,
  Panel,
  Row,
  Select,
  Slider,
  TextButton,
  Toggle
} from "./ui";

type ViewMode = "processed" | "source" | "alpha";

const EMPTY_SEQUENCES: Sequence[] = [];

function lightboxScale(width: number, height: number): number {
  if (width <= 0 || height <= 0 || typeof window === "undefined") return 1;
  return Math.min((window.innerWidth - 48) / width, (window.innerHeight - 80) / height);
}

export function InspectorPanel() {
  const selectedIds = useUi((state) => state.selectedIds);
  const palettes = useServer((state) => state.palettes);
  const scene = useActiveScene();
  const busy = useUi((state) => state.busy);
  const asset = useSelectedAsset();
  const job = useSelectedJob();
  const activeSequenceId = useUi((state) => state.activeSequenceId);
  const previewHeight = useUi((state) => state.inspectorPreview);
  const panelWidth = useUi((state) => state.layout.right);
  const projectId = useServer((state) => state.project?.id ?? null);

  const scenePalette = scene?.palette ?? "";
  const paletteName = (id: string) =>
    palettes.find((entry) => entry.id === id)?.name ?? "a palette";

  const doc = useDoc.getState;
  const server = useServer.getState;
  const ui = useUi.getState;

  const [view, setView] = useState<ViewMode>("processed");
  const [showMask, setShowMask] = useState(false);
  const [exportName, setExportName] = useState("");
  const [exporting, setExporting] = useState(false);

  // Seeded from the asset's label, which is its pretty name if it has one and
  // its number otherwise, so a never-renamed asset downloads as `001`.
  useEffect(() => {
    setExportName(asset?.label ?? "");
  }, [asset?.id, asset?.label]);

  const palette = useAssetPalette(asset);

  // The picker's choice, falling back to the first animation whenever it names
  // one this asset does not have -- which is every time the selection changes.
  const sequences = asset?.sequences ?? EMPTY_SEQUENCES;
  const sequence =
    sequences.find((entry) => entry.id === activeSequenceId) ?? sequences[0] ?? null;

  const frames = useSequenceFrames(asset, sequence, palette);
  const playback = useSequencePlayback(sequence);

  const frameOverride =
    asset && sequence && sequence.frames[playback.index]
      ? frameSettings(asset.processing, sequence, sequence.frames[playback.index])
      : undefined;

  // With a sequence selected the top preview shows the playing frame rather
  // than the whole sheet, so there is one preview surface and not two.
  const frameAssetId =
    asset && sequence && sequence.frames[playback.index]
      ? frameSourceAssetId(asset.id, sequence.frames[playback.index])
      : undefined;
  const frameAsset = useAsset(frameAssetId ?? null);
  const overlayAsset = frameAsset ?? asset;
  const { bitmap: maskOverlay, available: maskAvailable } = useMaskOverlay(
    overlayAsset,
    projectId,
    view === "source" ? "source" : "processed"
  );

  const { preview, error, loading } = useProcessed(
    asset,
    palette,
    true,
    "source",
    frameOverride,
    frameAssetId,
    PROCESS_PRIORITY.selected
  );

  if (job) return <JobInspector job={job} />;

  if (!asset) {
    return (
      <Panel title="Inspector" pane="right" lead={<RightTabs />}>
        <p className="text-[11px] text-slate-500">
          Select an asset in the library to tune its size, cutout, and palette. Every asset keeps
          its own snapshot, so editing one never touches the others.
        </p>
      </Panel>
    );
  }

  const processing = asset.processing;

  const update = (patch: Partial<typeof processing>) => {
    doc().patchProcessing(asset.id, patch);
    if (patch.paletteId) void server().ensurePalette(patch.paletteId);
  };

  const showBitmap = view === "source" ? preview?.sourceBitmap : preview?.processed;
  const bitmapWidth = view === "source" ? preview?.sourceWidth ?? 0 : preview?.width ?? 0;
  const bitmapHeight = view === "source" ? preview?.sourceHeight ?? 0 : preview?.height ?? 0;
  const previewPad = 16;
  const previewBoxW = Math.max(64, panelWidth - 36);
  const previewScale =
    bitmapWidth > 0 && bitmapHeight > 0
      ? Math.min(
          (previewBoxW - previewPad) / bitmapWidth,
          (previewHeight - previewPad) / bitmapHeight
        )
      : 1;

  return (
    <Panel
      title="Inspector"
      pane="right"
      lead={<RightTabs />}
      actions={
        <Button
          variant="danger"
          title="Delete this asset and its raw source file"
          onClick={() => {
            if (confirm(`Delete ${asset.label} and its source PNG?`)) {
              void server().deleteAsset(asset.id);
            }
          }}
        >
          delete
        </Button>
      }
    >
      <Section id="inspector.preview" label="preview">
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

          {maskAvailable ? (
            <label className="flex items-center gap-1 text-[10px] text-slate-400">
              <input
                type="checkbox"
                checked={showMask}
                onChange={(event) => setShowMask(event.target.checked)}
                className="h-3 w-3 accent-[var(--color-accent)]"
              />
              mask
            </label>
          ) : null}

          <span className="flex-1" />

          {sequence && sequence.frames.length > 0 ? (
            <Button
              variant={playback.playing ? "primary" : "default"}
              title={playback.playing ? "Pause the animation" : "Play the animation"}
              onClick={playback.toggle}
            >
              {playback.playing ? "pause" : "play"}
            </Button>
          ) : null}

          <Button
            variant={processing.edits.length > 0 ? "primary" : "default"}
            title="Crop this image without touching the raw file, for every instance at once"
            onClick={() => ui().openImageEditor(asset.id)}
          >
            {processing.edits.length > 0 ? `edit (${processing.edits.length})` : "edit"}
          </Button>
        </Row>

        {sequence && sequence.frames.length > 1 ? (
          <Row className="mb-2">
            <input
              type="range"
              className="flex-1"
              min={0}
              max={sequence.frames.length - 1}
              step={1}
              value={playback.index}
              onChange={(event) => playback.seek(Number(event.target.value))}
            />
            <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-slate-400">
              {playback.index + 1}/{sequence.frames.length}
            </span>
          </Row>
        ) : null}

        <div className="mb-2">
          <ExpandablePreview
            title={`${asset.label} · ${bitmapWidth}×${bitmapHeight}`}
            className="checkerboard flex w-full items-center justify-center rounded-t border-0 bg-transparent p-2"
            style={{ height: previewHeight }}
            expanded={
              showBitmap ? (
                <BitmapCanvas
                  bitmap={showBitmap}
                  width={bitmapWidth}
                  height={bitmapHeight}
                  showAlpha={view === "alpha"}
                  overlay={showMask ? maskOverlay : null}
                  pixelated
                  style={{
                    width: Math.max(1, Math.round(bitmapWidth * lightboxScale(bitmapWidth, bitmapHeight))),
                    height: Math.max(
                      1,
                      Math.round(bitmapHeight * lightboxScale(bitmapWidth, bitmapHeight))
                    )
                  }}
                />
              ) : (
                <span className="text-[11px] text-slate-400">{error ?? "no preview"}</span>
              )
            }
          >
            {error ? (
              <span className="p-2 text-center text-[11px] text-rose-300">{error}</span>
            ) : showBitmap ? (
              <BitmapCanvas
                bitmap={showBitmap}
                width={bitmapWidth}
                height={bitmapHeight}
                showAlpha={view === "alpha"}
                overlay={showMask ? maskOverlay : null}
                pixelated={previewScale >= 1}
                style={{
                  width: Math.max(1, Math.round(bitmapWidth * previewScale)),
                  height: Math.max(1, Math.round(bitmapHeight * previewScale))
                }}
              />
            ) : (
              <span className="text-[11px] text-slate-500">{loading ? "processing..." : ""}</span>
            )}
          </ExpandablePreview>
          <ResizeHandle
            orientation="horizontal"
            onDrag={(delta) => ui().setInspectorPreview(previewHeight + delta)}
            onReset={() => ui().setInspectorPreview(DEFAULT_INSPECTOR_PREVIEW)}
          />
        </div>

        <p className="mb-3 text-[10px] leading-snug text-slate-500">
          {preview ? (
            <>
              source {preview.sourceWidth}x{preview.sourceHeight} to {preview.width}x{preview.height}
              {preview.description ? <> &middot; {preview.description}</> : null}
            </>
          ) : null}
        </p>
      </Section>

      <Section id="inspector.asset" label="asset">
        <Field label="Name" hint={`asset ${asset.seq}, blank to use the number`}>
          <input
            type="text"
            value={asset.name}
            placeholder={asset.label}
            onChange={(event) => doc().rename(asset.id, event.target.value)}
          />
        </Field>

        <Row>
          <div className="flex-1">
            <Field label="Folder">
              <input
                type="text"
                value={asset.folder}
                onChange={(event) => doc().setFolder(asset.id, event.target.value)}
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Tags" hint="comma separated">
              <input
                type="text"
                value={asset.tags.join(", ")}
                onChange={(event) =>
                  doc().setTags(
                    asset.id,
                    event.target.value
                      .split(",")
                      .map((tag) => tag.trim())
                      .filter((tag) => tag.length > 0)
                  )
                }
              />
            </Field>
          </div>
        </Row>
      </Section>

      {asset.set ? (
        <SetSection
          asset={asset}
          set={asset.set}
          sequence={sequence}
          palette={palette}
          playback={playback}
          frames={frames}
        />
      ) : (
        <AnimationSection
          asset={asset}
          sequence={sequence}
          palette={palette}
          playback={playback}
          frames={frames}
        />
      )}

      <Section id="inspector.size" label="size">
        <DownsampleControls processing={processing} onChange={update} />
      </Section>

      <Section id="inspector.transparency" label="transparency">

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
        <div className="mb-2">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-400">
            Key colours
          </span>
          {processing.chromaKeys.map((colour, index) => (
            <Row key={index} className="mb-1">
              <ColorInput
                value={colour}
                fallback="#ff00ff"
                onChange={(value) => {
                  const next = processing.chromaKeys.slice();
                  next[index] = value;
                  update({ chromaKeys: next });
                }}
              />
              <TextButton
                danger
                title="Remove this key colour"
                onClick={() =>
                  update({ chromaKeys: processing.chromaKeys.filter((_, at) => at !== index) })
                }
              >
                remove
              </TextButton>
            </Row>
          ))}
          <Button
            className="w-full"
            disabled={processing.chromaKeys.length >= MAX_CHROMA_KEYS}
            title="Add another colour to punch out"
            onClick={() =>
              update({
                chromaKeys: [
                  ...processing.chromaKeys,
                  processing.chromaKeys.at(-1) ?? "#ff00ff"
                ]
              })
            }
          >
            add colour
          </Button>
        </div>
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
        disabled={processing.clipToIso}
        onChange={(value) => update({ trimToContent: value })}
      />

      <Toggle
        label="Clip to iso diamond"
        checked={processing.clipToIso}
        onChange={(value) => update({ clipToIso: value })}
      />
      </Section>

      <Section id="inspector.palette" label="palette">
        <Field label="Palette" hint={`${palette.length} colours`}>
          <select
            value={processing.paletteId}
            onChange={(event) => update({ paletteId: event.target.value })}
          >
            <option value="">(full colour)</option>
            {palettes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </Field>

        {processing.paletteId === "" && scenePalette !== "" ? (
          <p className="mb-2 text-[10px] leading-snug text-amber-300">
            The scene is previewing this with {paletteName(scenePalette)}, but it exports
            in full colour until you pick a palette here or bake the scene one in. Choosing one
            here always wins over the scene.
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

        {processing.paletteId ? (
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
      </Section>

      <Section id="inspector.cleanup" label="orientation and cleanup">
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
      </Section>

      <Section id="inspector.history" label="history">
        <GenerationHistory asset={frameAsset ?? asset} />
      </Section>

      <Section id="inspector.output" label="output">
        {selectedIds.length > 1 ? (
          <Button
            className="mb-2 w-full"
            title="Copy this asset's processing settings onto every selected asset"
            onClick={() => {
              // Crops are per-image; copying them onto a different sprite would
              // cut it in the wrong place.
              const { edits, ...shared } = processing;
              void edits;
              doc().applyProcessingToMany(selectedIds, shared as typeof processing);
            }}
          >
            apply these settings to all {selectedIds.length} selected
          </Button>
        ) : null}

        <Button
          className="mb-2 w-full"
          disabled={!scene}
          onClick={() => {
            if (!scene) return;

            doc().addItem(scene.id, {
              id: crypto.randomUUID(),
              assetId: asset.id,
              x: (scene.items.length % 6) * 96,
              y: Math.floor(scene.items.length / 6) * 96,
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
              display: isSetAsset(asset) ? "sheet" : "cell"
            });
          }}
        >
          add to scene
        </Button>

        <Field label="Download filename" hint="no extension">
          <input
            type="text"
            value={exportName}
            onChange={(event) => setExportName(event.target.value)}
          />
        </Field>

        <Button variant="primary" className="w-full" onClick={() => setExporting(true)}>
          download
        </Button>

        <Button
          variant="ghost"
          className="mt-1 w-full"
          disabled={busy !== null}
          title="Writes a copy into this app's own storage instead of downloading it. Counts against your storage."
          onClick={() => void server().approve(asset.id, exportName)}
        >
          {busy === "exporting" ? "saving..." : "save a server-side copy"}
        </Button>

        {asset.exportPath ? (
          <p className="mt-2 text-[10px] break-all text-emerald-400">{asset.exportPath}</p>
        ) : null}
      </Section>

      {exporting ? (
        <ExportDialog
          assets={[asset]}
          nameOverride={exportName}
          onClose={() => setExporting(false)}
        />
      ) : null}
    </Panel>
  );
}
