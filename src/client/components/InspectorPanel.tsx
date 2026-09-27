"use client";

import { useCallback, useRef, useState } from "react";
import { useActiveScene, useAsset, useSelectedAsset, useSelectedJob } from "@/client/stores/assets";
import { useDoc } from "@/client/stores/doc";
import { useServer } from "@/client/stores/server";
import { defaultPaneSize, useUi } from "@/client/stores/ui";
import { MAX_CHROMA_KEYS } from "@/core/settings";
import { CUTOUT_LABELS, CUTOUT_MODES, DISTANCE_MODES, DITHER_MODES, ORIENTATIONS } from "@/core/types";
import { useMaskOverlay } from "@/client/maskOverlay";
import { PROCESS_PRIORITY } from "@/client/processor";
import { useSequenceFrames, useSequencePlayback } from "@/client/sequence";
import {
  cleanupSummary,
  paletteSummary,
  pixelArtSummary,
  transparencySummary
} from "@/shared/sectionSummary";
import { frameSettings, frameSourceAssetId, type Sequence } from "@/shared/sequence";
import { stageAtCamera } from "@/client/stage";
import { AnimationBar } from "./AnimationBar";
import { SetSection } from "./SetSection";
import { BitmapCanvas, useAssetPalette, useProcessed } from "./AssetBitmap";
import { DownsampleControls } from "./DownsampleControls";
import { ExportDialog } from "./ExportDialog";
import { GenerationHistory } from "./GenerationHistory";
import { JobInspector } from "./JobInspector";
import {
  Button,
  ColorInput,
  ExpandablePreview,
  Section,
  Field,
  NumberInput,
  Panel,
  PanelTab,
  Row,
  Select,
  Slider,
  TextButton,
  Toggle
} from "./ui";

type ViewMode = "processed" | "source" | "alpha" | "prompt";

const VIEW_LABELS: Record<ViewMode, string> = {
  processed: "Processed",
  source: "Source",
  alpha: "Alpha",
  prompt: "Prompt"
};

/** Live size of an element, for fitting a bitmap into whatever room it has. */
function useBoxSize(): [(node: HTMLElement | null) => void, { width: number; height: number }] {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: HTMLElement | null) => {
    observer.current?.disconnect();
    if (!node) return;

    observer.current = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height }
      );
    });
    observer.current.observe(node);
  }, []);

  return [ref, size];
}

const EMPTY_SEQUENCES: Sequence[] = [];

function lightboxScale(width: number, height: number): number {
  if (width <= 0 || height <= 0 || typeof window === "undefined") return 1;
  return Math.min((window.innerWidth - 48) / width, (window.innerHeight - 80) / height);
}

export function InspectorPanel() {
  const selectedIds = useUi((state) => state.selectedIds);
  const palettes = useServer((state) => state.palettes);
  const scene = useActiveScene();
  const asset = useSelectedAsset();
  const job = useSelectedJob();
  const activeSequenceId = useUi((state) => state.activeSequenceId);
  const previewHeight = useUi((state) => state.layout.preview);
  const [boxRef, box] = useBoxSize();
  const projectId = useServer((state) => state.project?.id ?? null);

  const scenePalette = scene?.palette ?? "";
  const paletteName = (id: string) =>
    palettes.find((entry) => entry.id === id)?.name ?? "a palette";

  const doc = useDoc.getState;
  const server = useServer.getState;
  const ui = useUi.getState;

  const [view, setView] = useState<ViewMode>("processed");
  const [showMask, setShowMask] = useState(false);
  const [exporting, setExporting] = useState(false);

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
      <Panel title="Inspector">
        <p className="text-[11px] text-slate-500">
          Select an asset in the library to inspect it.
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
  const previewScale =
    bitmapWidth > 0 && bitmapHeight > 0 && box.width > 0 && box.height > 0
      ? Math.min((box.width - previewPad) / bitmapWidth, (box.height - previewPad) / bitmapHeight)
      : 1;

  // Pinned above the sections, like the prompt in the Generate panel: the
  // thing the inspector is for, always in view, sized by dragging its edge.
  const previewPinned = (
    <>
      <div className="mb-2 flex h-7 shrink-0 items-stretch gap-4 border-b border-[var(--color-edge)]">
        <div role="tablist" aria-label="Preview" className="flex items-stretch gap-4">
          {(["processed", "source", "alpha", "prompt"] as ViewMode[]).map((mode) => (
            <PanelTab key={mode} size="section" selected={view === mode} onClick={() => setView(mode)}>
              {VIEW_LABELS[mode]}
            </PanelTab>
          ))}
        </div>
        <span className="flex-1" />
        <div className="flex items-center gap-1 self-center">
          {maskAvailable && view !== "prompt" ? (
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
          {!asset.set && asset.sequences.length === 0 && view !== "prompt" ? (
            <TextButton
              title="Slice this image into frames to play it as an animation. Works on any sheet laid out on a grid."
              onClick={() => ui().openSlicer(asset.id)}
            >
              slice
            </TextButton>
          ) : null}
          <TextButton
            title="Crop this image without touching the raw file, for every instance at once"
            onClick={() => ui().openImageEditor(asset.id)}
          >
            {processing.edits.length > 0 ? `edit (${processing.edits.length})` : "edit"}
          </TextButton>
        </div>
      </div>

      {sequence && view !== "prompt" ? (
        <AnimationBar asset={asset} sequence={sequence} playback={playback} frames={frames} />
      ) : null}

      {view === "prompt" ? (
        // What made this image: the exact prompt, what was attached, and how.
        <div className="min-h-16 flex-1 overflow-y-auto">
          <GenerationHistory asset={frameAsset ?? asset} />
        </div>
      ) : (
        <div ref={boxRef} className="min-h-16 flex-1 overflow-hidden rounded">
          <ExpandablePreview
            title={`${asset.label} · ${bitmapWidth}×${bitmapHeight}`}
            className="checkerboard flex h-full w-full items-center justify-center border-0 bg-transparent p-2"
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
        </div>

      )}

      {preview && view !== "prompt" ? (
        <p className="mt-1.5 shrink-0 truncate text-[10px] text-slate-500">
          source {preview.sourceWidth}x{preview.sourceHeight} to {preview.width}x{preview.height}
          {preview.description ? <> &middot; {preview.description}</> : null}
        </p>
      ) : null}
      {/* Always here, under the image: what it is, where it lives, and getting it out. */}
      <div className="mt-2 flex shrink-0 flex-col gap-1.5 border-t border-[var(--color-edge)] pt-2">
        {/* One line when there is room; wraps when the inspector is narrow. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="text"
            value={asset.name}
            placeholder={asset.label}
            title="Name, also the download filename. Blank uses the number."
            style={{ width: "auto", flex: "1 1 6rem", minWidth: "6rem" }}
            onChange={(event) => doc().rename(asset.id, event.target.value)}
          />
          <span className="flex items-center gap-1">
            <Button variant="primary" onClick={() => setExporting(true)}>
              download
            </Button>
            <TextButton
              disabled={!scene}
              title={scene ? "Put this image in the middle of the scene view" : "Open a scene first"}
              onClick={() => stageAtCamera([asset.id])}
            >
              + scene
            </TextButton>
          </span>
        </div>

        {selectedIds.length > 1 ? (
          <TextButton
            className="self-start"
            title="Copy this image's processing settings onto every selected image"
            onClick={() => {
              // Crops are per-image; copying them onto a different sprite would
              // cut it in the wrong place.
              const { edits, ...shared } = processing;
              void edits;
              doc().applyProcessingToMany(selectedIds, shared as typeof processing);
            }}
          >
            apply these settings to all {selectedIds.length} selected
          </TextButton>
        ) : null}
      </div>
    </>
  );

  return (
    <Panel
      title="Inspector"
      pinned={{
        content: previewPinned,
        height: previewHeight,
        onResize: (height) => ui().setPaneSize("preview", height),
        onReset: () => ui().setPaneSize("preview", defaultPaneSize("preview"))
      }}
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
      {asset.set ? (
        <SetSection
          asset={asset}
          set={asset.set}
          sequence={sequence}
          palette={palette}
          playback={playback}
          frames={frames}
        />
      ) : null}

      <Section id="inspector.size" label="pixel art" summary={pixelArtSummary(processing)}>
        <DownsampleControls processing={processing} onChange={update} />
      </Section>

      <Section
        id="inspector.transparency"
        label="transparency"
        summary={transparencySummary(processing)}
      >

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

      <Section
        id="inspector.palette"
        label="palette"
        summary={paletteSummary(processing, paletteName(processing.paletteId))}
      >
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

      <Section
        id="inspector.cleanup"
        label="orientation and cleanup"
        summary={cleanupSummary(processing)}
      >
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


      {exporting ? (
        <ExportDialog
          assets={[asset]}
          onClose={() => setExporting(false)}
        />
      ) : null}
    </Panel>
  );
}
