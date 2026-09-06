import { Zip, ZipPassThrough } from "fflate";
import { processor, sourceUrlFor } from "@/client/processor";
import type { Rgb } from "@/core/types";
import type { AssetRecord } from "@/shared/model";

/**
 * Which bytes the user wants. "original" is what the provider returned;
 * "processed" is that image run through the pipeline with the asset's saved
 * settings, which is what they see in the studio.
 */
export type ExportKind = "original" | "processed" | "both";

/**
 * `Uint8Array` pinned to a non-shared buffer. The default parameter admits
 * `SharedArrayBuffer`, which `Blob` will not take.
 */
type Bytes = Uint8Array<ArrayBuffer>;

export const EXPORT_KINDS: readonly ExportKind[] = ["original", "processed", "both"];

export const EXPORT_KIND_LABELS: Record<ExportKind, string> = {
  original: "original only",
  processed: "processed only",
  both: "original + processed"
};

export interface ExportProgress {
  done: number;
  total: number;
  label: string;
}

/** Resolves the palette an asset needs, going through the store's cache. */
export type PaletteLookup = (file: string) => Promise<Rgb[]>;

/**
 * Filenames are sanitized rather than trusted: these end up in a ZIP central
 * directory and then on a filesystem, and a name carrying a slash or `..`
 * decides where the archive writes when the user unpacks it.
 */
function baseName(asset: AssetRecord, override?: string): string {
  const raw = override?.trim() || asset.approvedName?.trim() || asset.name.trim() || asset.id;

  const cleaned = raw
    .replace(/\.png$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    // Leading dots and separators are what turn a name into a traversal.
    .replace(/^[._-]+/, "")
    .replace(/[._-]+$/, "");

  // A name of nothing but separators sanitizes down to punctuation, which is
  // truthy and would ship a file called "_.png".
  return /[a-zA-Z0-9]/.test(cleaned) ? cleaned : asset.id;
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

export interface PlannedEntry {
  assetId: string;
  /** Path inside the archive, already deduplicated. */
  path: string;
  variant: "original" | "processed";
}

/**
 * Decides the archive layout up front, separately from fetching anything.
 *
 * With a single kind the archive is flat. With both, the two variants of one
 * asset would collide on name, so each gets its own folder -- which reads
 * better than suffixing every file anyway.
 */
export function planZipEntries(
  assets: AssetRecord[],
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
    const stem = baseName(asset, assets.length === 1 ? nameOverride : undefined);

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
  }

  return planned;
}

/** The stored PNG exactly as the provider returned it, straight from storage. */
async function originalBytes(assetId: string): Promise<Bytes> {
  const response = await fetch(sourceUrlFor(assetId, "source"));

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
  asset: AssetRecord,
  palette: Rgb[]
): Promise<{ bytes: Bytes; width: number; height: number }> {
  const preview = await processor.process(asset.id, asset.processing, palette, false, "source");

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

async function paletteFor(asset: AssetRecord, lookup: PaletteLookup): Promise<Rgb[]> {
  return asset.processing.paletteFile ? lookup(asset.processing.paletteFile) : [];
}

/**
 * Downloads one asset. A single file goes down as a plain PNG rather than a
 * one-entry archive; only "both" needs a container.
 */
export async function downloadAsset(
  asset: AssetRecord,
  kind: ExportKind,
  lookup: PaletteLookup,
  nameOverride?: string
): Promise<void> {
  const stem = baseName(asset, nameOverride);

  if (kind === "original") {
    triggerDownload(new Blob([await originalBytes(asset.id)], { type: "image/png" }), `${stem}.png`);
    return;
  }

  if (kind === "processed") {
    const { bytes } = await processedBytes(asset, await paletteFor(asset, lookup));
    triggerDownload(new Blob([bytes], { type: "image/png" }), `${stem}.png`);
    return;
  }

  await downloadZip([asset], kind, lookup, `${stem}.zip`, undefined, nameOverride);
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
  assets: AssetRecord[],
  kind: ExportKind,
  lookup: PaletteLookup,
  filename = "spritebench-export.zip",
  onProgress?: (progress: ExportProgress) => void,
  nameOverride?: string
): Promise<{ entries: number; failures: string[] }> {
  if (assets.length === 0) throw new Error("nothing selected to export");

  const plan = planZipEntries(assets, kind, nameOverride);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));

  const { bytes, entries, failures } = await buildArchive(
    plan,
    async (planned) => {
      const asset = byId.get(planned.assetId);
      if (!asset) throw new Error("this asset is no longer in the library");

      return planned.variant === "original"
        ? originalBytes(asset.id)
        : (await processedBytes(asset, await paletteFor(asset, lookup))).bytes;
    },
    onProgress
  );

  triggerDownload(new Blob([bytes], { type: "application/zip" }), filename);

  return { entries, failures };
}

/** `spritebench-12-images-2026-09-05.zip` */
export function zipFilename(count: number, kind: ExportKind): string {
  const day = new Date().toISOString().slice(0, 10);
  const suffix = kind === "both" ? "-both" : kind === "original" ? "-originals" : "";

  return `spritebench-${count}-image${count === 1 ? "" : "s"}${suffix}-${day}.zip`;
}
