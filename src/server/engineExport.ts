import { applyPipeline } from "@/core/pipeline";
import type { ProcessingSettings } from "@/core/settings";
import { getAssetRow, listAssets, toAssetRecord } from "@/db/repo/assets";
import { readDoc } from "@/db/repo/projectDoc";
import { hashExportBytes } from "@/server/apiToken";
import { ApproveError, approveAsset, exportBytesForAsset } from "@/server/approve";
import { loadPalette } from "@/server/palettes";
import { decodePng, encodePng } from "@/server/png";
import { attachSet, setByAssetId } from "@/shared/assetSet";
import { docFromState, listAssetSets, readAssetEdits, resolveAsset } from "@/shared/doc";
import {
  bagFileName,
  hashBundleText,
  planBundle,
  spriteFramesBundleText,
  texturesBundleText,
  type BundleAsset,
  type PlannedClip,
  type PlannedFrame
} from "@/shared/engineBundle";
import type { EngineSlotIntent, EngineSlotRecord } from "@/shared/engineSlot";
import type { ResolvedAsset } from "@/shared/model";
import { frameSettings, frameSourceAssetId } from "@/shared/sequence";
import { ObjectNotFoundError, storage } from "@/storage";
import { engineBundleKey, engineFrameKey } from "@/storage/keys";

export interface TextureExport {
  intent: "texture";
  remoteHash: string;
  path: string;
}

export interface ClipFrameExport {
  file: string;
  path: string;
  hold: number;
}

export interface ClipExport {
  name: string;
  fps: number;
  loop: boolean;
  frames: ClipFrameExport[];
}

export interface SpriteFramesExport {
  intent: "sprite_frames";
  remoteHash: string;
  clips: ClipExport[];
}

export interface BagFrameExport {
  file: string;
  path: string;
}

export interface TexturesExport {
  intent: "textures";
  remoteHash: string;
  frames: BagFrameExport[];
}

export type SlotExport = TextureExport | SpriteFramesExport | TexturesExport;

export type AssignAssetProgress = (assetId: string) => void | Promise<void>;

export async function resolveBundleAsset(
  projectId: string,
  assetId: string
): Promise<ResolvedAsset | null> {
  const records = await listAssets(projectId);
  const record = records.find((entry) => entry.id === assetId);
  if (!record) return null;

  const snapshot = await readDoc(projectId);
  const doc = docFromState(snapshot.state);
  const sizes = Object.fromEntries(
    records.map((entry) => [entry.id, { width: entry.sourceWidth, height: entry.sourceHeight }])
  );

  return attachSet(
    resolveAsset(record, readAssetEdits(doc, assetId)),
    setByAssetId(listAssetSets(doc), assetId),
    sizes
  );
}

export function emptyTexturesExport(): TexturesExport {
  return {
    intent: "textures",
    remoteHash: hashBundleText(texturesBundleText([]), hashExportBytes),
    frames: []
  };
}

export async function exportSlotAssignment(
  projectId: string,
  slotId: string,
  assetIds: string[],
  intent: EngineSlotIntent,
  onProgress?: AssignAssetProgress
): Promise<SlotExport> {
  const ids = assetIds.filter((id) => id.length > 0);
  if (ids.length === 0 && intent !== "textures") {
    throw new ApproveError(404, "asset not found");
  }

  let exported: SlotExport;
  if (ids.length === 0) {
    exported = emptyTexturesExport();
  } else if (intent === "texture") {
    exported = await exportTexture(projectId, ids[0]);
    await onProgress?.(ids[0]);
  } else if (intent === "sprite_frames") {
    exported = await exportSpriteFrames(projectId, slotId, ids[0]);
    await onProgress?.(ids[0]);
  } else {
    exported = await exportTextures(projectId, slotId, ids, onProgress);
  }
  await persistSlotExport(projectId, slotId, exported);
  return exported;
}

/** Sign the files assign already wrote. Re-render only if they are gone. */
export async function slotExportForPull(
  projectId: string,
  slot: Pick<EngineSlotRecord, "id" | "assignedAssetIds" | "intent" | "remoteHash">
): Promise<SlotExport> {
  const cached = await readSlotExport(projectId, slot.id);
  if (cached && (!slot.remoteHash || cached.remoteHash === slot.remoteHash)) {
    return cached;
  }
  const recovered = await recoverSlotExport(projectId, slot);
  if (recovered) {
    await persistSlotExport(projectId, slot.id, recovered);
    return recovered;
  }
  return exportSlotAssignment(projectId, slot.id, slot.assignedAssetIds, slot.intent);
}

export async function persistSlotExport(
  projectId: string,
  slotId: string,
  exported: SlotExport
): Promise<void> {
  await storage().put(engineBundleKey(projectId, slotId), Buffer.from(JSON.stringify(exported)), {
    contentType: "application/json",
    cacheControl: "public, max-age=31536000, immutable"
  });
}

export async function readSlotExport(
  projectId: string,
  slotId: string
): Promise<SlotExport | null> {
  try {
    const bytes = await storage().get(engineBundleKey(projectId, slotId));
    return parseSlotExport(JSON.parse(Buffer.from(bytes).toString("utf8")));
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return null;
    throw error;
  }
}

export function parseSlotExport(data: unknown): SlotExport | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const remoteHash = typeof row.remoteHash === "string" ? row.remoteHash : "";
  if (!remoteHash) return null;

  if (row.intent === "texture" && typeof row.path === "string" && row.path.length > 0) {
    return { intent: "texture", remoteHash, path: row.path };
  }

  if (row.intent === "sprite_frames" && Array.isArray(row.clips)) {
    const clips: ClipExport[] = [];
    for (const clip of row.clips) {
      if (!clip || typeof clip !== "object") return null;
      const entry = clip as Record<string, unknown>;
      if (!Array.isArray(entry.frames)) return null;
      const frames: ClipFrameExport[] = [];
      for (const frame of entry.frames) {
        if (!frame || typeof frame !== "object") return null;
        const item = frame as Record<string, unknown>;
        if (typeof item.file !== "string" || typeof item.path !== "string") return null;
        frames.push({
          file: item.file,
          path: item.path,
          hold: typeof item.hold === "number" ? item.hold : 1
        });
      }
      clips.push({
        name: typeof entry.name === "string" ? entry.name : "default",
        fps: typeof entry.fps === "number" ? entry.fps : 6,
        loop: entry.loop !== false,
        frames
      });
    }
    return { intent: "sprite_frames", remoteHash, clips };
  }

  if (row.intent === "textures" && Array.isArray(row.frames)) {
    const frames: BagFrameExport[] = [];
    for (const frame of row.frames) {
      if (!frame || typeof frame !== "object") return null;
      const item = frame as Record<string, unknown>;
      if (typeof item.file !== "string" || typeof item.path !== "string") return null;
      frames.push({ file: item.file, path: item.path });
    }
    return { intent: "textures", remoteHash, frames };
  }

  return null;
}

async function recoverSlotExport(
  projectId: string,
  slot: Pick<EngineSlotRecord, "id" | "assignedAssetIds" | "intent" | "remoteHash">
): Promise<SlotExport | null> {
  const remoteHash = slot.remoteHash;
  if (!remoteHash) return null;
  const ids = slot.assignedAssetIds.filter((id) => id.length > 0);
  if (ids.length === 0) return null;

  if (slot.intent === "texture") {
    const row = await getAssetRow(projectId, ids[0]);
    if (!row?.exportKey || !(await storage().exists(row.exportKey))) return null;
    return { intent: "texture", remoteHash, path: row.exportKey };
  }

  if (slot.intent === "sprite_frames") {
    const asset = await resolveBundleAsset(projectId, ids[0]);
    if (!asset) return null;
    const plan = planBundle("sprite_frames", asset as BundleAsset);
    if (plan.intent !== "sprite_frames") return null;
    const clips: ClipExport[] = [];
    for (const clip of plan.clips) {
      const frames: ClipFrameExport[] = [];
      for (const frame of clip.frames) {
        const path = engineFrameKey(projectId, slot.id, frame.file);
        if (!(await storage().exists(path))) return null;
        frames.push({ file: frame.file, path, hold: frame.hold });
      }
      if (frames.length === 0) continue;
      clips.push({ name: clip.name, fps: clip.fps, loop: clip.loop, frames });
    }
    if (clips.length === 0) return null;
    return { intent: "sprite_frames", remoteHash, clips };
  }

  const frames: BagFrameExport[] = [];
  for (const assetId of ids) {
    const asset = await resolveBundleAsset(projectId, assetId);
    if (!asset) return null;
    const plan = planBundle("textures", asset as BundleAsset);
    if (plan.intent !== "textures") return null;
    for (const frame of plan.frames) {
      const file = bagFileName(frames.length);
      const path = engineFrameKey(projectId, slot.id, file);
      if (!(await storage().exists(path))) return null;
      frames.push({ file, path });
    }
  }
  if (frames.length === 0) return null;
  return { intent: "textures", remoteHash, frames };
}

async function exportSpriteFrames(
  projectId: string,
  slotId: string,
  assetId: string
): Promise<SpriteFramesExport> {
  const asset = await resolveBundleAsset(projectId, assetId);
  if (!asset) throw new ApproveError(404, "asset not found");

  const plan = planBundle("sprite_frames", asset as BundleAsset);
  if (plan.intent !== "sprite_frames") {
    throw new ApproveError(410, "could not render any frames");
  }

  const renderer = createRenderer(projectId, asset);
  const clips: ClipExport[] = [];
  const hashed = [];

  for (const clip of plan.clips) {
    const frames = await renderClipFrames(projectId, slotId, clip, renderer);
    if (frames.length === 0) continue;
    clips.push({
      name: clip.name,
      fps: clip.fps,
      loop: clip.loop,
      frames: frames.map(({ file, path, hold }) => ({ file, path, hold }))
    });
    hashed.push({
      name: clip.name,
      fps: clip.fps,
      loop: clip.loop,
      frames: frames.map(({ hold, sha256 }) => ({ hold, sha256 }))
    });
  }

  if (clips.length === 0) {
    throw new ApproveError(410, "could not render any frames");
  }

  return {
    intent: "sprite_frames",
    remoteHash: hashBundleText(spriteFramesBundleText(hashed), hashExportBytes),
    clips
  };
}

async function exportTextures(
  projectId: string,
  slotId: string,
  assetIds: string[],
  onProgress?: AssignAssetProgress
): Promise<TexturesExport> {
  const frames: Array<BagFrameExport & { sha256: string }> = [];

  for (const assetId of assetIds) {
    const asset = await resolveBundleAsset(projectId, assetId);
    if (!asset) throw new ApproveError(404, "asset not found");

    const plan = planBundle("textures", asset as BundleAsset);
    if (plan.intent === "textures") {
      const renderer = createRenderer(projectId, asset);
      for (const frame of plan.frames) {
        const rendered = await renderer.render(frame);
        if (!rendered) continue;
        const file = bagFileName(frames.length);
        const path = engineFrameKey(projectId, slotId, file);
        await storage().put(path, rendered, {
          contentType: "image/png",
          cacheControl: "public, max-age=31536000, immutable"
        });
        frames.push({ file, path, sha256: hashExportBytes(rendered) });
      }
    }

    await onProgress?.(assetId);
  }

  if (frames.length === 0) {
    throw new ApproveError(410, "could not render any frames");
  }

  return {
    intent: "textures",
    remoteHash: hashBundleText(
      texturesBundleText(frames.map((frame) => frame.sha256)),
      hashExportBytes
    ),
    frames: frames.map(({ file, path }) => ({ file, path }))
  };
}

async function exportTexture(projectId: string, assetId: string): Promise<TextureExport> {
  let exported = await exportBytesForAsset(projectId, assetId);
  if (!exported) {
    const approved = await approveAsset(projectId, assetId);
    exported = { bytes: approved.bytes, path: approved.path };
  }

  return {
    intent: "texture",
    remoteHash: hashExportBytes(exported.bytes),
    path: exported.path
  };
}

async function renderClipFrames(
  projectId: string,
  slotId: string,
  clip: PlannedClip,
  renderer: ReturnType<typeof createRenderer>
): Promise<Array<ClipFrameExport & { sha256: string }>> {
  const frames: Array<ClipFrameExport & { sha256: string }> = [];

  for (const frame of clip.frames) {
    const rendered = await renderer.render(frame);
    if (!rendered) continue;
    const path = engineFrameKey(projectId, slotId, frame.file);
    await storage().put(path, rendered, {
      contentType: "image/png",
      cacheControl: "public, max-age=31536000, immutable"
    });
    frames.push({
      file: frame.file,
      path,
      hold: frame.hold,
      sha256: hashExportBytes(rendered)
    });
  }

  return frames;
}

function createRenderer(projectId: string, assigned: ResolvedAsset) {
  const sourceCache = new Map<string, Promise<Buffer | null>>();
  const paletteCache = new Map<string, Promise<Awaited<ReturnType<typeof loadPalette>>>>();
  const processingCache = new Map<string, Promise<ProcessingSettings>>();

  async function sourceBytes(assetId: string): Promise<Buffer | null> {
    const hit = sourceCache.get(assetId);
    if (hit) return hit;

    const pending = (async () => {
      const row = await getAssetRow(projectId, assetId);
      if (!row?.sourceKey) return null;
      try {
        return Buffer.from(await storage().get(row.sourceKey));
      } catch (error) {
        if (error instanceof ObjectNotFoundError) return null;
        throw error;
      }
    })();

    sourceCache.set(assetId, pending);
    return pending;
  }

  async function paletteFor(paletteId: string | null | undefined) {
    if (!paletteId) return [];
    const hit = paletteCache.get(paletteId);
    if (hit) return hit;
    const pending = loadPalette(projectId, paletteId);
    paletteCache.set(paletteId, pending);
    return pending;
  }

  async function processingFor(assetId: string): Promise<ProcessingSettings> {
    if (assetId === assigned.id) return assigned.processing;
    const hit = processingCache.get(assetId);
    if (hit) return hit;

    const pending = (async () => {
      const row = await getAssetRow(projectId, assetId);
      if (!row) return assigned.processing;
      const snapshot = await readDoc(projectId);
      const edits = readAssetEdits(docFromState(snapshot.state), assetId);
      return edits?.processing ?? toAssetRecord(row).generatedWith;
    })();

    processingCache.set(assetId, pending);
    return pending;
  }

  return {
    async render(frame: PlannedFrame): Promise<Buffer | null> {
      if (frame.mode === "still") {
        const processing = await processingFor(frame.assetId);
        const bytes = await sourceBytes(frame.assetId);
        if (!bytes) return null;
        const palette = await paletteFor(processing.paletteId);
        const { image } = applyPipeline(decodePng(bytes), processing, palette);
        return Buffer.from(encodePng(image));
      }

      const sourceId = frameSourceAssetId(assigned.id, {
        ...frame.sequence.frames[frame.frameIndex],
        sourceAssetId: frame.assetId
      });
      const bytes = await sourceBytes(sourceId);
      if (!bytes) return null;
      const settings = frameSettings(
        assigned.processing,
        frame.sequence,
        frame.sequence.frames[frame.frameIndex]
      );
      const palette = await paletteFor(settings.paletteId);
      const { image } = applyPipeline(decodePng(bytes), settings, palette);
      return Buffer.from(encodePng(image));
    }
  };
}
