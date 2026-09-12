import { Zip, ZipPassThrough } from "fflate";
import { sourceUrl } from "@/client/api";
import { processor } from "@/client/processor";
import { planSheet, type SheetPlan } from "@/core/sheet";
import type { Rgb } from "@/core/types";
import { buildFramesManifest, buildSheetManifest } from "@/shared/manifest";
import { exportStem, sanitizeName } from "@/shared/naming";
import { frameSettings, frameSourceAssetId, type Sequence } from "@/shared/sequence";
import type { ResolvedAsset } from "@/shared/model";

/**
 * Which project the export is coming out of. Needed for the image URLs and
 * for the filename stem, since an export reads `mygame_001.png`.
 */
export interface ExportContext {
  projectId: string;
  projectName: string;
}

/**
 * Which bytes the user wants. "original" is what the provider returned;
 * "processed" is that image run through the pipeline with the asset's saved
 * settings, which is what they see in the studio.
 */
export type ExportKind =
  | "original"
  | "processed"
  | "both"
  | "sequenceSheet"
  | "sequenceFrames";

/** True for the kinds that only produce anything for a sliced asset. */
export function isSequenceKind(kind: ExportKind): boolean {
  return kind === "sequenceSheet" || kind === "sequenceFrames";
}

/**
 * `Uint8Array` pinned to a non-shared buffer. The default parameter admits
 * `SharedArrayBuffer`, which `Blob` will not take.
 */
type Bytes = Uint8Array<ArrayBuffer>;

export const EXPORT_KINDS: readonly ExportKind[] = [
  "original",
  "processed",
  "both",
  "sequenceSheet",
  "sequenceFrames"
];

export const EXPORT_KIND_LABELS: Record<ExportKind, string> = {
  original: "original only",
  processed: "processed only",
  both: "original + processed",
  sequenceSheet: "animation: packed sheet + json",
  sequenceFrames: "animation: one png per frame + json"
};

export interface ExportProgress {
  done: number;
  total: number;
  label: string;
}

/** Resolves the palette an asset needs, going through the store's cache. */
export type PaletteLookup = (paletteId: string) => Promise<Rgb[]>;

/**
 * The filename stem for one asset: `mygame_001` unnamed, `mygame_hero_idle`
 * once renamed.
 *
 * Sanitized rather than trusted, because these end up in a ZIP central
 * directory and then on a filesystem, and a name carrying a slash or `..`
 * decides where the archive writes when the user unpacks it.
 */
function baseName(
  context: ExportContext,
  asset: ResolvedAsset,
  override?: string
): string {
  const raw = override?.trim().replace(/\.png$/i, "");

  return raw
    ? sanitizeName(raw, `asset_${asset.seq}`)
    : exportStem(context.projectName, asset.seq, asset.name);
}

/**
 * ZIP entries must be unique or the archive is malformed, and two assets can
 * legitimately carry the same export name.
 */
function uniqueNamer(): (path: string) => string {
  const used = new Set<string>();

  return (path: string) => {
    if (!used.has(path)) {
      used.add(path);
      return path;
    }

    const dot = path.lastIndexOf(".");
    const stem = dot === -1 ? path : path.slice(0, dot);
    const extension = dot === -1 ? "" : path.slice(dot);

    for (let suffix = 2; ; suffix++) {
      const candidate = `${stem}_${suffix}${extension}`;
      if (used.has(candidate)) continue;

      used.add(candidate);
      return candidate;
    }
  };
}

export type EntryVariant =
  | "original"
  | "processed"
  | "sequenceSheet"
  | "sequenceFrame"
  | "manifest";

export interface PlannedEntry {
  assetId: string;
  /** Path inside the archive, already deduplicated. */
  path: string;
  variant: EntryVariant;
  /** Which animation, for the sequence variants. */
  sequenceId?: string;
  /** Which frame, for `sequenceFrame`. */
  frameIndex?: number;
}

/** `mygame_hero_walk`, or just `mygame_hero` for an animation with no name. */
function sequenceStem(stem: string, sequenceName: string): string {
  const suffix = sanitizeName(sequenceName, "");
  return suffix ? `${stem}_${suffix}` : stem;
}

/**
 * Decides the archive layout up front, separately from fetching anything.
 *
 * With a single kind the archive is flat. With both, the two variants of one
 * asset would collide on name, so each gets its own folder -- which reads
 * better than suffixing every file anyway.
 *
 * The sequence kinds walk every animation on every asset, and quietly skip
 * assets that have none: exporting a selection of forty sprites where three
 * are animated should give you those three, not an error.
 */
export function planZipEntries(
  context: ExportContext,
  assets: ResolvedAsset[],
  kind: ExportKind,
  nameOverride?: string
): PlannedEntry[] {
  const nameFor = uniqueNamer();
  const wantOriginal = kind === "original" || kind === "both";
  const wantProcessed = kind === "processed" || kind === "both";
  const originalDir = kind === "both" ? "original/" : "";
  const processedDir = kind === "both" ? "processed/" : "";

  const planned: PlannedEntry[] = [];

  for (const asset of assets) {
    // An override only makes sense for a single asset; across a batch every
    // entry would collide and get suffixed into nonsense.
    const stem = baseName(context, asset, assets.length === 1 ? nameOverride : undefined);

    if (wantOriginal) {
      planned.push({
        assetId: asset.id,
        path: nameFor(`${originalDir}${stem}.png`),
        variant: "original"
      });
    }

    if (wantProcessed) {
      planned.push({
        assetId: asset.id,
        path: nameFor(`${processedDir}${stem}.png`),
        variant: "processed"
      });
    }

    if (!isSequenceKind(kind)) continue;

    for (const sequence of asset.sequences) {
      if (sequence.frames.length === 0) continue;

      const animation = sequenceStem(stem, sequence.name);

      if (kind === "sequenceSheet") {
        const sheet = nameFor(`${animation}.png`);

        planned.push({
          assetId: asset.id,
          path: sheet,
          variant: "sequenceSheet",
          sequenceId: sequence.id
        });

        planned.push({
          assetId: asset.id,
          path: nameFor(`${animation}.json`),
          variant: "manifest",
          sequenceId: sequence.id
        });

        continue;
      }

      // One PNG per frame goes in its own folder. Flat, a twelve-frame walk
      // and a twelve-frame run would interleave into one unreadable listing.
      for (let index = 0; index < sequence.frames.length; index++) {
        planned.push({
          assetId: asset.id,
          path: nameFor(`${animation}/${String(index).padStart(3, "0")}.png`),
          variant: "sequenceFrame",
          sequenceId: sequence.id,
          frameIndex: index
        });
      }

      planned.push({
        assetId: asset.id,
        path: nameFor(`${animation}/animation.json`),
        variant: "manifest",
        sequenceId: sequence.id
      });
    }
  }

  return planned;
}

/** The stored PNG exactly as the provider returned it, straight from storage. */
async function originalBytes(projectId: string, assetId: string): Promise<Bytes> {
  const response = await fetch(sourceUrl(projectId, assetId, "source"));

  if (!response.ok) {
    throw new Error(
      response.status === 410
        ? "the full-resolution original has rolled off and is no longer available"
        : `could not read the original (${response.status})`
    );
  }

  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Encodes the pipeline result the browser has already computed.
 *
 * The whole point of doing this here is that the pixels never touch the
 * server: the Web Worker holds the processed bitmap for anything on screen, so
 * an export of a previewed asset costs one canvas encode and no network.
 */
async function processedBytes(
  projectId: string,
  asset: ResolvedAsset,
  palette: Rgb[]
): Promise<{ bytes: Bytes; width: number; height: number }> {
  const preview = await processor.process(
    projectId,
    asset.id,
    asset.processing,
    palette,
    false,
    "source"
  );

  const canvas = new OffscreenCanvas(preview.width, preview.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("this browser would not provide a 2D canvas");

  context.drawImage(preview.processed, 0, 0);

  const blob = await canvas.convertToBlob({ type: "image/png" });

  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    width: preview.width,
    height: preview.height
  };
}

interface RenderedFrame {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

async function encodeCanvas(canvas: OffscreenCanvas): Promise<Bytes> {
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Draws the packed sheet.
 *
 * The canvas half of the pure/impure split: `planSheet` decided every
 * rectangle, and this only blits. Keeping the arithmetic out of here is what
 * makes the layout testable without a browser.
 */
async function drawSheet(plan: SheetPlan, frames: RenderedFrame[]): Promise<Bytes> {
  const canvas = new OffscreenCanvas(plan.size.width, plan.size.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("this browser would not provide a 2D canvas");

  for (const placement of plan.placements) {
    const frame = frames[placement.index];
    if (frame) context.drawImage(frame.bitmap, placement.x, placement.y);
  }

  return encodeCanvas(canvas);
}

/**
 * Renders the frames of one animation, once per export.
 *
 * Memoised per sequence because the sheet, every individual frame and the
 * manifest all need the same bitmaps, and they arrive as separate archive
 * entries. Without this, a twelve-frame sequence would run the pipeline
 * twenty-five times to produce thirteen files.
 */
function sequenceRenderer(context: ExportContext, lookup: PaletteLookup) {
  const cache = new Map<string, Promise<RenderedFrame[]>>();

  return async function render(asset: ResolvedAsset, sequence: Sequence): Promise<RenderedFrame[]> {
    const key = `${asset.id}:${sequence.id}`;
    const hit = cache.get(key);
    if (hit) return hit;

    const pending = (async () => {
      const palette = await paletteFor(asset, lookup);

      const frames: RenderedFrame[] = [];
      for (const frame of sequence.frames) {
        const preview = await processor.process(
          context.projectId,
          frameSourceAssetId(asset.id, frame),
          frameSettings(asset.processing, sequence, frame),
          palette,
          false,
          "source"
        );

        frames.push({
          bitmap: preview.processed,
          width: preview.width,
          height: preview.height
        });
      }

      return frames;
    })();

    cache.set(key, pending);
    return pending;
  };
}

function jsonBytes(value: unknown): Bytes {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`) as Bytes;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();

  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function paletteFor(asset: ResolvedAsset, lookup: PaletteLookup): Promise<Rgb[]> {
  return asset.processing.paletteId ? lookup(asset.processing.paletteId) : [];
}

/**
 * Downloads one asset. A single file goes down as a plain PNG rather than a
 * one-entry archive; only "both" needs a container.
 */
export async function downloadAsset(
  context: ExportContext,
  asset: ResolvedAsset,
  kind: ExportKind,
  lookup: PaletteLookup,
  nameOverride?: string
): Promise<void> {
  const stem = baseName(context, asset, nameOverride);

  if (kind === "original") {
    const bytes = await originalBytes(context.projectId, asset.id);
    triggerDownload(new Blob([bytes], { type: "image/png" }), `${stem}.png`);
    return;
  }

  if (kind === "processed") {
    const { bytes } = await processedBytes(
      context.projectId,
      asset,
      await paletteFor(asset, lookup)
    );
    triggerDownload(new Blob([bytes], { type: "image/png" }), `${stem}.png`);
    return;
  }

  await downloadZip(context, [asset], kind, lookup, `${stem}.zip`, undefined, nameOverride);
}

/** Supplies the bytes for one planned entry. */
export type EntryBytes = (entry: PlannedEntry) => Promise<Bytes>;

export interface ArchiveResult {
  bytes: Bytes;
  entries: number;
  failures: string[];
}

/**
 * Assembles the archive. Kept free of the DOM so the ZIP layout and the bytes
 * themselves can be verified in a test rather than by unpacking a download.
 *
 * Entries are added with ZipPassThrough, which stores rather than deflates.
 * PNG is already DEFLATE internally, so compressing again spends real CPU on
 * the user's machine to save approximately nothing.
 *
 * Entries are walked one at a time on purpose. Fanning out would hold every
 * decoded bitmap and its encoding in memory at once, and a full library at the
 * free quota is large enough for that to matter.
 *
 * One asset failing does not abandon the archive: a rolled-off original among
 * fifty good images should cost the user that one file, not the export.
 */
export async function buildArchive(
  plan: PlannedEntry[],
  provide: EntryBytes,
  onProgress?: (progress: ExportProgress) => void
): Promise<ArchiveResult> {
  const chunks: Uint8Array[] = [];
  const failures: string[] = [];
  let entries = 0;

  const zip = new Zip();

  const finished = new Promise<void>((resolve, reject) => {
    zip.ondata = (error, chunk, final) => {
      if (error) {
        reject(error);
        return;
      }

      chunks.push(chunk);
      if (final) resolve();
    };
  });

  for (const [index, planned] of plan.entries()) {
    onProgress?.({ done: index, total: plan.length, label: planned.path });

    try {
      const bytes = await provide(planned);

      const entry = new ZipPassThrough(planned.path);
      zip.add(entry);
      entry.push(bytes, true);
      entries++;
    } catch (error) {
      failures.push(
        `${planned.path} (${planned.variant}): ${error instanceof Error ? error.message : error}`
      );
    }
  }

  if (entries === 0) {
    zip.terminate();
    throw new Error(`nothing could be exported. ${failures[0] ?? ""}`.trim());
  }

  onProgress?.({ done: plan.length, total: plan.length, label: "packaging" });

  zip.end();
  await finished;

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total) as Bytes;
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return { bytes, entries, failures };
}

/** Builds the archive for a selection and hands it to the download manager. */
export async function downloadZip(
  context: ExportContext,
  assets: ResolvedAsset[],
  kind: ExportKind,
  lookup: PaletteLookup,
  filename = "spritebench-export.zip",
  onProgress?: (progress: ExportProgress) => void,
  nameOverride?: string
): Promise<{ entries: number; failures: string[] }> {
  if (assets.length === 0) throw new Error("nothing selected to export");

  const plan = planZipEntries(context, assets, kind, nameOverride);

  if (plan.length === 0) {
    throw new Error(
      isSequenceKind(kind)
        ? "none of the selected assets have an animation. Slice one in the inspector first."
        : "nothing selected to export"
    );
  }

  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const render = sequenceRenderer(context, lookup);

  const { bytes, entries, failures } = await buildArchive(
    plan,
    async (planned) => {
      const asset = byId.get(planned.assetId);
      if (!asset) throw new Error("this asset is no longer in the library");

      if (planned.variant === "original") return originalBytes(context.projectId, asset.id);

      if (planned.variant === "processed") {
        return (await processedBytes(context.projectId, asset, await paletteFor(asset, lookup)))
          .bytes;
      }

      const sequence = asset.sequences.find((entry) => entry.id === planned.sequenceId);
      if (!sequence) throw new Error("this animation is no longer on the asset");

      const frames = await render(asset, sequence);

      if (planned.variant === "sequenceFrame") {
        const frame = frames[planned.frameIndex ?? -1];
        if (!frame) throw new Error("this frame is no longer in the animation");

        const canvas = new OffscreenCanvas(frame.width, frame.height);
        const canvasContext = canvas.getContext("2d");
        if (!canvasContext) throw new Error("this browser would not provide a 2D canvas");

        canvasContext.drawImage(frame.bitmap, 0, 0);
        return encodeCanvas(canvas);
      }

      if (planned.variant === "sequenceSheet") {
        return drawSheet(planSheet(frames), frames);
      }

      // The manifest's shape follows the kind, because the two describe
      // different things: where the frames are inside one PNG, or which file
      // each frame is.
      if (kind === "sequenceSheet") {
        const sheetPath = plan.find(
          (entry) => entry.variant === "sequenceSheet" && entry.sequenceId === sequence.id
        )?.path;

        return jsonBytes(
          buildSheetManifest(sequence, planSheet(frames), sheetPath ?? `${sequence.name}.png`)
        );
      }

      const files = plan.filter(
        (entry) => entry.variant === "sequenceFrame" && entry.sequenceId === sequence.id
      );

      return jsonBytes(
        buildFramesManifest(
          sequence,
          files.map((entry, index) => ({
            // Relative to the manifest, which sits alongside the frames.
            file: entry.path.slice(entry.path.lastIndexOf("/") + 1),
            width: frames[index]?.width ?? 0,
            height: frames[index]?.height ?? 0
          }))
        )
      );
    },
    onProgress
  );

  triggerDownload(new Blob([bytes], { type: "application/zip" }), filename);

  return { entries, failures };
}

/** `spritebench-12-images-2026-09-05.zip` */
export function zipFilename(count: number, kind: ExportKind): string {
  const day = new Date().toISOString().slice(0, 10);

  const suffix: Record<ExportKind, string> = {
    original: "-originals",
    processed: "",
    both: "-both",
    sequenceSheet: "-sheets",
    sequenceFrames: "-frames"
  };

  return `spritebench-${count}-image${count === 1 ? "" : "s"}${suffix[kind]}-${day}.zip`;
}
