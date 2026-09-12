import * as Y from "yjs";
import { normalizeEdits } from "@/core/edits";
import { clampIsoTurn } from "@/core/isoTurn";
import { DEFAULT_PROCESSING, withDefaults, type ProcessingSettings } from "@/core/settings";
import {
  DEFAULT_TERRAIN,
  TERRAIN_GRADIENTS,
  clampTerrainCount,
  clampTerrainSamples,
  clampTileSize,
  emptyTiles,
  resizeTerrainGrid
} from "@/core/terrain";
import type { DitherMode, Inset, Rect } from "@/core/types";
import {
  defaultSetView,
  type AssetSet,
  type AssetSetKind,
  type AssetSetMember,
  type AssetSetView
} from "./assetSet";
import { displayName } from "./naming";
import {
  DEFAULT_PROJECT_SETTINGS,
  DEFAULT_REPEATER,
  REPEATER_PLACEMENTS,
  REPEATER_ROTATES,
  repeaterFromItem,
  type AssetEdits,
  type AssetRecord,
  type Scene,
  type ProjectSettings,
  type PromptSnippet,
  type RepeatGroup,
  type ResolvedAsset,
  type StagedItem,
  type TerrainGroup,
  type TerrainTile
} from "./model";
import {
  DEFAULT_FPS,
  PLAYBACK_MODES,
  clampFps,
  clampHold,
  type PlaybackMode,
  type Sequence,
  type SequenceFrame
} from "./sequence";

/**
 * The shared document: one Yjs doc per project, holding everything a human
 * edits. Runs unchanged in the browser and in Node -- the approve route
 * decodes it server-side to read processing settings.
 *
 * What is *not* here is as deliberate as what is. Asset provenance (storage
 * keys, prompt, dimensions, the number) is written once by the worker and
 * lives in Postgres: there is nothing to merge, and a CRDT would only add a
 * way for a client to corrupt it. Camera position and selection are one
 * person's business and live in localStorage.
 */

const SCENES = "scenes";
const ASSET_EDITS = "assetEdits";
const ASSET_SETS = "assetSets";
const PROJECT = "project";
const PROMPT_SNIPPETS = "promptSnippets";

/**
 * Transaction origins. `Y.UndoManager` is configured to track only
 * `LOCAL_ORIGIN`, which is what makes Ctrl+Z undo your own edits and step
 * over a collaborator's -- the attribution behaviour, for free, provided
 * every write goes through `transactLocal` and every inbound update through
 * `applyRemote`.
 */
export const LOCAL_ORIGIN = "local";
export const REMOTE_ORIGIN = "remote";

export function createDoc(): Y.Doc {
  return new Y.Doc();
}

export function docFromState(state: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state, REMOTE_ORIGIN);
  return doc;
}

export function encodeState(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/** Applies an update from the server or another client, outside undo. */
export function applyRemote(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update, REMOTE_ORIGIN);
}

/**
 * Runs a mutation as one undoable, one-network-message unit. A drag that
 * emitted a transaction per pointermove would produce a hundred undo steps
 * and a hundred POSTs for one gesture.
 */
export function transactLocal(doc: Y.Doc, mutate: () => void): void {
  doc.transact(mutate, LOCAL_ORIGIN);
}

export function scenesMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(SCENES);
}

export function assetEditsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(ASSET_EDITS);
}

export function projectMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(PROJECT);
}

export function promptSnippetsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(PROMPT_SNIPPETS);
}

export function assetSetsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(ASSET_SETS);
}

// --- readers ---------------------------------------------------------------
// Every read is defensive. A collaborator on an older build can leave a key
// absent or a type surprising, and a missing `opacity` must not blank the
// canvas.

function str(map: Y.Map<unknown>, key: string, fallback = ""): string {
  const value = map.get(key);
  return typeof value === "string" ? value : fallback;
}

function num(map: Y.Map<unknown>, key: string, fallback: number): number {
  const value = map.get(key);
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function flag(map: Y.Map<unknown>, key: string, fallback = false): boolean {
  const value = map.get(key);
  return typeof value === "boolean" ? value : fallback;
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function strings(map: Y.Map<unknown>, key: string): string[] {
  const value = map.get(key);
  if (value instanceof Y.Array) {
    return value.toArray().filter((entry): entry is string => typeof entry === "string");
  }
  return Array.isArray(value) ? value.filter((e): e is string => typeof e === "string") : [];
}

function size(map: Y.Map<unknown>, key: string): { width: number; height: number } {
  const value = map.get(key) as { width?: unknown; height?: unknown } | undefined;
  return {
    width: typeof value?.width === "number" ? value.width : 0,
    height: typeof value?.height === "number" ? value.height : 0
  };
}

function point(map: Y.Map<unknown>, key: string): { x: number; y: number } {
  const value = map.get(key) as { x?: unknown; y?: unknown } | undefined;
  return {
    x: typeof value?.x === "number" && Number.isFinite(value.x) ? value.x : 0,
    y: typeof value?.y === "number" && Number.isFinite(value.y) ? value.y : 0
  };
}

function readItem(id: string, map: Y.Map<unknown>): StagedItem {
  const position = point(map, "position");

  return {
    id,
    assetId: str(map, "assetId"),
    x: position.x,
    y: position.y,
    footprint: size(map, "footprint"),
    zIndex: num(map, "zIndex", 0),
    flipHorizontal: flag(map, "flipHorizontal"),
    flipVertical: flag(map, "flipVertical"),
    isoTurn: clampIsoTurn(num(map, "isoTurn", 0)),
    showSource: flag(map, "showSource"),
    opacity: num(map, "opacity", 1),
    paused: flag(map, "paused"),
    sequenceId: str(map, "sequenceId"),
    heldFrame: Math.max(0, Math.floor(num(map, "heldFrame", 0))),
    display: str(map, "display") === "sheet" ? "sheet" : "cell",
    rotation: num(map, "rotation", 0)
  };
}

function readTiles(map: Y.Map<unknown>, countX: number, countY: number): TerrainTile[] {
  const expected = emptyTiles(countX, countY);
  const value = map.get("tiles");
  if (!(value instanceof Y.Array)) return expected;

  return expected.map((fallback, index) => {
    const entry = value.get(index);
    if (entry instanceof Y.Map) {
      return {
        heightAssetId: str(entry, "heightAssetId"),
        colorAssetId: str(entry, "colorAssetId")
      };
    }

    if (entry && typeof entry === "object") {
      const raw = entry as { heightAssetId?: unknown; colorAssetId?: unknown };
      return {
        heightAssetId: typeof raw.heightAssetId === "string" ? raw.heightAssetId : "",
        colorAssetId: typeof raw.colorAssetId === "string" ? raw.colorAssetId : ""
      };
    }

    return fallback;
  });
}

function toTileArray(tiles: TerrainTile[]): Y.Array<Y.Map<unknown>> {
  const array = new Y.Array<Y.Map<unknown>>();
  array.push(
    tiles.map((tile) => {
      const map = new Y.Map<unknown>();
      map.set("heightAssetId", tile.heightAssetId);
      map.set("colorAssetId", tile.colorAssetId);
      return map;
    })
  );
  return array;
}

function readTerrain(id: string, map: Y.Map<unknown>): TerrainGroup {
  const position = point(map, "position");
  const countX = clampTerrainCount(num(map, "countX", DEFAULT_TERRAIN.countX));
  const countY = clampTerrainCount(num(map, "countY", DEFAULT_TERRAIN.countY));

  return {
    id,
    name: str(map, "name"),
    x: position.x,
    y: position.y,
    zIndex: num(map, "zIndex", 0),
    countX,
    countY,
    tileSize: clampTileSize(num(map, "tileSize", DEFAULT_TERRAIN.tileSize)),
    samples: clampTerrainSamples(num(map, "samples", DEFAULT_TERRAIN.samples)),
    low: num(map, "low", DEFAULT_TERRAIN.low),
    high: num(map, "high", DEFAULT_TERRAIN.high),
    seaLevel: num(map, "seaLevel", DEFAULT_TERRAIN.seaLevel),
    flattenSea: flag(map, "flattenSea", DEFAULT_TERRAIN.flattenSea),
    gradientId: oneOf(str(map, "gradientId"), TERRAIN_GRADIENTS, DEFAULT_TERRAIN.gradientId),
    tiles: readTiles(map, countX, countY)
  };
}

function writeTerrainFields(map: Y.Map<unknown>, terrain: TerrainGroup): void {
  setFields(map, {
    name: terrain.name,
    position: { x: terrain.x, y: terrain.y },
    zIndex: terrain.zIndex,
    countX: clampTerrainCount(terrain.countX),
    countY: clampTerrainCount(terrain.countY),
    tileSize: clampTileSize(terrain.tileSize),
    samples: clampTerrainSamples(terrain.samples),
    low: terrain.low,
    high: terrain.high,
    seaLevel: terrain.seaLevel,
    flattenSea: terrain.flattenSea,
    gradientId: terrain.gradientId
  });
  map.set("tiles", toTileArray(terrain.tiles));
}

function terrainsMap(scene: Y.Map<unknown>): Y.Map<Y.Map<unknown>> | undefined {
  const existing = nestedMapOfMaps(scene, "terrains");
  if (existing) return existing;

  const created = new Y.Map<Y.Map<unknown>>();
  scene.set("terrains", created);
  return created;
}

function readGroup(id: string, map: Y.Map<unknown>): RepeatGroup {
  const position = point(map, "position");

  return {
    id,
    name: str(map, "name"),
    assetIds: strings(map, "assetIds"),
    x: position.x,
    y: position.y,
    cell: size(map, "cell"),
    marginX: num(map, "marginX", 0),
    marginY: num(map, "marginY", 0),
    countX: num(map, "countX", 8),
    countY: num(map, "countY", 8),
    fillX: flag(map, "fillX"),
    fillY: flag(map, "fillY"),
    placement: oneOf(str(map, "placement"), REPEATER_PLACEMENTS, DEFAULT_REPEATER.placement),
    rotate: oneOf(str(map, "rotate"), REPEATER_ROTATES, DEFAULT_REPEATER.rotate),
    scatterCount: num(map, "scatterCount", DEFAULT_REPEATER.scatterCount),
    areaWidth: num(map, "areaWidth", DEFAULT_REPEATER.areaWidth),
    areaHeight: num(map, "areaHeight", DEFAULT_REPEATER.areaHeight),
    scaleJitter: num(map, "scaleJitter", DEFAULT_REPEATER.scaleJitter),
    minGap: num(map, "minGap", DEFAULT_REPEATER.minGap),
    edgeBias: num(map, "edgeBias", DEFAULT_REPEATER.edgeBias),
    background: str(map, "background"),
    zIndex: num(map, "zIndex", 0),
    opacity: num(map, "opacity", 1),
    seed: num(map, "seed", 0)
  };
}

function readProcessing(map: Y.Map<unknown> | undefined): ProcessingSettings {
  if (!map) return DEFAULT_PROCESSING;

  const partial: Record<string, unknown> = {};
  for (const [key, value] of map.entries()) partial[key] = value;

  return withDefaults(partial as Partial<ProcessingSettings>);
}

function rect(map: Y.Map<unknown>, key: string): Rect {
  const value = map.get(key) as Partial<Rect> | undefined;

  return {
    x: typeof value?.x === "number" && Number.isFinite(value.x) ? value.x : 0,
    y: typeof value?.y === "number" && Number.isFinite(value.y) ? value.y : 0,
    width: typeof value?.width === "number" && value.width > 0 ? value.width : 1,
    height: typeof value?.height === "number" && value.height > 0 ? value.height : 1
  };
}

function inset(map: Y.Map<unknown>, key: string): Inset {
  const value = map.get(key) as Partial<Inset> | undefined;
  const side = (raw: unknown): number =>
    typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, raw) : 0;

  return {
    top: side(value?.top),
    right: side(value?.right),
    bottom: side(value?.bottom),
    left: side(value?.left)
  };
}

function readFrame(map: Y.Map<unknown>, index: number): SequenceFrame {
  return {
    // Ordinarily written at creation. The positional fallback keeps a frame
    // addressable rather than letting one missing key break the whole strip.
    id: str(map, "id") || `frame-${index}`,
    sourceAssetId: str(map, "sourceAssetId"),
    rect: rect(map, "rect"),
    edits: normalizeEdits(map.get("edits")),
    hold: clampHold(num(map, "hold", 1))
  };
}

function readSequence(id: string, map: Y.Map<unknown>): Sequence {
  const frames = map.get("frames");

  return {
    id,
    name: str(map, "name", "animation"),
    kind: str(map, "kind") === "set" ? "set" : undefined,
    fps: clampFps(num(map, "fps", DEFAULT_FPS)),
    playback: PLAYBACK_MODES.includes(str(map, "playback") as PlaybackMode)
      ? (str(map, "playback") as PlaybackMode)
      : "loop",
    inset: inset(map, "inset"),
    frames:
      frames instanceof Y.Array
        ? frames
            .toArray()
            .filter((entry): entry is Y.Map<unknown> => entry instanceof Y.Map)
            .map(readFrame)
        : []
  };
}

function readSequences(map: Y.Map<unknown> | undefined): Record<string, Sequence> {
  const nested = map ? nestedMapOfMaps(map, "sequences") : undefined;
  if (!nested) return {};

  const result: Record<string, Sequence> = {};
  for (const [id, entry] of nested.entries()) result[id] = readSequence(id, entry);

  return result;
}

function nested(map: Y.Map<unknown>, key: string): Y.Map<unknown> | undefined {
  const value = map.get(key);
  return value instanceof Y.Map ? value : undefined;
}

function nestedMapOfMaps(map: Y.Map<unknown>, key: string): Y.Map<Y.Map<unknown>> | undefined {
  const value = map.get(key);
  return value instanceof Y.Map ? (value as Y.Map<Y.Map<unknown>>) : undefined;
}

/**
 * Stacking order. `zIndex` alone is not a total order: two clients that
 * independently bring something to the front both compute the same
 * `max + 1`. Breaking the tie on id keeps every client agreeing on which one
 * ended up on top, which is the property that actually matters -- the
 * alternative, one client rendering a different stack than another, is the
 * bug users notice.
 */
export function compareStacking(
  a: { zIndex: number; id: string },
  b: { zIndex: number; id: string }
): number {
  return a.zIndex - b.zIndex || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * The prompt wrapper the whole project generates under.
 *
 * In the document rather than on the user, because a project's house style is
 * a property of the project: a collaborator should inherit "16-bit sprite,
 * transparent background" rather than have to be told it. Being here also
 * makes editing it undoable and visible to everyone, which is what you want
 * from something that silently changes what every generation produces.
 */
export function readProjectSettings(doc: Y.Doc): ProjectSettings {
  const map = projectMap(doc);

  return {
    promptPrefix: str(map, "promptPrefix", DEFAULT_PROJECT_SETTINGS.promptPrefix),
    promptSuffix: str(map, "promptSuffix", DEFAULT_PROJECT_SETTINGS.promptSuffix)
  };
}

export function patchProjectSettings(doc: Y.Doc, patch: Partial<ProjectSettings>): void {
  transactLocal(doc, () => setFields(projectMap(doc), patch));
}

function readSnippet(id: string, map: Y.Map<unknown>): PromptSnippet | null {
  const kind = str(map, "kind");
  if (kind !== "prefix" && kind !== "suffix" && kind !== "scratch") return null;

  return {
    id,
    name: str(map, "name"),
    kind,
    text: str(map, "text")
  };
}

export function listPromptSnippets(doc: Y.Doc): PromptSnippet[] {
  return [...promptSnippetsMap(doc).entries()]
    .flatMap(([id, map]) => {
      const snippet = readSnippet(id, map);
      return snippet ? [snippet] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function putPromptSnippet(doc: Y.Doc, snippet: PromptSnippet): void {
  transactLocal(doc, () => {
    const map = new Y.Map<unknown>();
    promptSnippetsMap(doc).set(snippet.id, map);
    setFields(map, {
      name: snippet.name,
      kind: snippet.kind,
      text: snippet.text
    });
  });
}

function readSetMember(assetId: string, map: Y.Map<unknown>): AssetSetMember {
  return {
    assetId,
    index: Math.max(0, Math.floor(num(map, "index", 0))),
    col: Math.max(0, Math.floor(num(map, "col", 0))),
    row: Math.max(0, Math.floor(num(map, "row", 0)))
  };
}

function readAssetSet(id: string, map: Y.Map<unknown>): AssetSet {
  const kind: AssetSetKind = str(map, "kind") === "grid" ? "grid" : "animation";
  const viewRaw = str(map, "view");
  const view: AssetSetView =
    viewRaw === "animate" || viewRaw === "grid" ? viewRaw : defaultSetView(kind);
  const members = nestedMapOfMaps(map, "members");

  return {
    id,
    kind,
    columns: Math.max(1, Math.floor(num(map, "columns", 1))),
    rows: Math.max(1, Math.floor(num(map, "rows", 1))),
    view,
    members: members
      ? [...members.entries()]
          .map(([assetId, member]) => readSetMember(assetId, member))
          .sort((left, right) => left.index - right.index)
      : []
  };
}

export function listAssetSets(doc: Y.Doc): AssetSet[] {
  return [...assetSetsMap(doc).entries()]
    .map(([id, map]) => readAssetSet(id, map))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function upsertSetMember(
  doc: Y.Doc,
  spec: { id: string; kind: AssetSetKind; columns: number; rows: number },
  member: AssetSetMember
): void {
  transactLocal(doc, () => {
    const sets = assetSetsMap(doc);
    let map = sets.get(spec.id);

    if (!map) {
      map = new Y.Map<unknown>();
      sets.set(spec.id, map);
      map.set("kind", spec.kind);
      map.set("columns", spec.columns);
      map.set("rows", spec.rows);
      map.set("view", defaultSetView(spec.kind));
      map.set("members", new Y.Map<Y.Map<unknown>>());
    }

    const members = nestedMapOfMaps(map, "members");
    if (!members) return;
    if (members.has(member.assetId)) return;

    const entry = new Y.Map<unknown>();
    members.set(member.assetId, entry);
    entry.set("index", member.index);
    entry.set("col", member.col);
    entry.set("row", member.row);
  });
}

export function patchAssetSet(doc: Y.Doc, id: string, patch: { view?: AssetSetView }): void {
  const map = assetSetsMap(doc).get(id);
  if (!map) return;

  transactLocal(doc, () => {
    if (patch.view) map.set("view", patch.view);
  });
}

export function setAssetHidden(doc: Y.Doc, assetId: string, hidden: boolean): void {
  const map = assetEditsMap(doc).get(assetId);
  if (!map) return;

  transactLocal(doc, () => map.set("hidden", hidden));
}

export function deletePromptSnippet(doc: Y.Doc, id: string): void {
  transactLocal(doc, () => promptSnippetsMap(doc).delete(id));
}

export function readScene(doc: Y.Doc, id: string): Scene | null {
  const map = scenesMap(doc).get(id);
  if (!map) return null;

  const items = nestedMapOfMaps(map, "items");
  const groups = nestedMapOfMaps(map, "groups");
  const terrains = nestedMapOfMaps(map, "terrains");

  return {
    id,
    name: str(map, "name", "scene"),
    unitsPerCell: Math.max(1, num(map, "unitsPerCell", 64)),
    items: items
      ? [...items.entries()].map(([itemId, item]) => readItem(itemId, item)).sort(compareStacking)
      : [],
    groups: groups
      ? [...groups.entries()]
          .map(([groupId, group]) => readGroup(groupId, group))
          .sort(compareStacking)
      : [],
    terrains: terrains
      ? [...terrains.entries()]
          .map(([terrainId, terrain]) => readTerrain(terrainId, terrain))
          .sort(compareStacking)
      : [],
    palettePool: strings(map, "palettePool"),
    palette: str(map, "palette"),
    paletteDither: str(map, "paletteDither", "none") as DitherMode,
    paletteDitherStrength: num(map, "paletteDitherStrength", 1)
  };
}

export function listScenes(doc: Y.Doc): Scene[] {
  return [...scenesMap(doc).keys()]
    .map((id) => readScene(doc, id))
    .filter((entry): entry is Scene => entry !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readAssetEdits(doc: Y.Doc, assetId: string): AssetEdits | null {
  const map = assetEditsMap(doc).get(assetId);
  if (!map) return null;

  return {
    name: str(map, "name"),
    folder: str(map, "folder"),
    tags: strings(map, "tags"),
    processing: readProcessing(nested(map, "processing")),
    sequences: readSequences(map),
    hidden: flag(map, "hidden")
  };
}

/**
 * Merges an asset's two halves for display: the row the worker wrote and the
 * fields a human has since edited. `label` is what the UI shows, so the
 * fallback to the number happens in exactly one place.
 */
export function resolveAsset(record: AssetRecord, edits: AssetEdits | null): ResolvedAsset {
  const name = edits?.name ?? "";

  return {
    ...record,
    label: displayName(record.seq, name),
    name,
    folder: edits?.folder ?? "",
    tags: edits?.tags ?? [],
    processing: edits?.processing ?? withDefaults(record.generatedWith),
    sequences: Object.values(edits?.sequences ?? {}).sort((a, b) => a.name.localeCompare(b.name)),
    hidden: edits?.hidden ?? false,
    set: null
  };
}

// --- writers ---------------------------------------------------------------

function setFields(map: Y.Map<unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) map.set(key, value);
  }
}

/**
 * Position is one CRDT register rather than independent x/y registers. A
 * whole drag racing an inspector edit therefore resolves to one complete
 * position instead of combining coordinates chosen by different people.
 */
function setPosition(
  map: Y.Map<unknown>,
  patch: { x?: number; y?: number }
): void {
  if (patch.x === undefined && patch.y === undefined) return;

  const current = point(map, "position");
  map.set("position", {
    x: patch.x ?? current.x,
    y: patch.y ?? current.y
  });
}

function toYArray(values: string[]): Y.Array<string> {
  const array = new Y.Array<string>();
  array.push(values);
  return array;
}

export function createScene(doc: Y.Doc, id: string, name: string): void {
  transactLocal(doc, () => {
    const map = new Y.Map<unknown>();
    scenesMap(doc).set(id, map);

    map.set("name", name);
    map.set("unitsPerCell", 64);
    map.set("items", new Y.Map<Y.Map<unknown>>());
    map.set("groups", new Y.Map<Y.Map<unknown>>());
    map.set("terrains", new Y.Map<Y.Map<unknown>>());
    map.set("palettePool", new Y.Array<string>());
    map.set("palette", "");
    map.set("paletteDither", "none");
    map.set("paletteDitherStrength", 1);
  });
}

export function deleteScene(doc: Y.Doc, id: string): void {
  transactLocal(doc, () => scenesMap(doc).delete(id));
}

export function patchScene(
  doc: Y.Doc,
  id: string,
  patch: Partial<Omit<Scene, "id" | "items" | "groups" | "terrains" | "palettePool">>
): void {
  const map = scenesMap(doc).get(id);
  if (!map) return;

  transactLocal(doc, () => setFields(map, patch));
}

/** Highest stacking number in use, so a new or raised entry lands on top. */
export function topZIndex(doc: Y.Doc, sceneId: string): number {
  const scene = readScene(doc, sceneId);
  if (!scene) return 0;

  return [...scene.items, ...scene.groups, ...scene.terrains].reduce(
    (top, entry) => Math.max(top, entry.zIndex),
    0
  );
}

export function addItem(doc: Y.Doc, sceneId: string, item: StagedItem): void {
  const scene = scenesMap(doc).get(sceneId);
  if (!scene) return;

  transactLocal(doc, () => {
    const items = nestedMapOfMaps(scene, "items");
    if (!items) return;

    const map = new Y.Map<unknown>();
    items.set(item.id, map);
    setFields(map, {
      assetId: item.assetId,
      position: { x: item.x, y: item.y },
      footprint: item.footprint,
      zIndex: item.zIndex,
      flipHorizontal: item.flipHorizontal,
      flipVertical: item.flipVertical,
      isoTurn: clampIsoTurn(item.isoTurn),
      showSource: item.showSource,
      opacity: item.opacity,
      paused: item.paused,
      sequenceId: item.sequenceId,
      heldFrame: item.heldFrame,
      display: item.display === "sheet" ? "sheet" : "cell",
      rotation: item.rotation
    });
  });
}

export function patchItem(
  doc: Y.Doc,
  sceneId: string,
  itemId: string,
  patch: Partial<Omit<StagedItem, "id">>
): void {
  const items = nestedMapOfMaps(scenesMap(doc).get(sceneId) ?? new Y.Map(), "items");
  const map = items?.get(itemId);
  if (!map) return;

  transactLocal(doc, () => {
    const { x, y, ...fields } = patch;
    setPosition(map, { x, y });
    setFields(map, fields);
  });
}

export function removeItem(doc: Y.Doc, sceneId: string, itemId: string): void {
  const items = nestedMapOfMaps(scenesMap(doc).get(sceneId) ?? new Y.Map(), "items");
  if (!items) return;

  transactLocal(doc, () => items.delete(itemId));
}

export function addGroup(doc: Y.Doc, sceneId: string, group: RepeatGroup): void {
  const scene = scenesMap(doc).get(sceneId);
  if (!scene) return;

  transactLocal(doc, () => {
    const groups = nestedMapOfMaps(scene, "groups");
    if (!groups) return;

    const map = new Y.Map<unknown>();
    groups.set(group.id, map);
    setFields(map, {
      name: group.name,
      position: { x: group.x, y: group.y },
      cell: group.cell,
      marginX: group.marginX,
      marginY: group.marginY,
      countX: group.countX,
      countY: group.countY,
      fillX: group.fillX,
      fillY: group.fillY,
      placement: group.placement,
      rotate: group.rotate,
      scatterCount: group.scatterCount,
      areaWidth: group.areaWidth,
      areaHeight: group.areaHeight,
      scaleJitter: group.scaleJitter,
      minGap: group.minGap,
      edgeBias: group.edgeBias,
      background: group.background,
      zIndex: group.zIndex,
      opacity: group.opacity,
      seed: group.seed
    });
    // A Y.Array so two collaborators dropping different art on the same
    // repeater both land, instead of the later drop replacing the earlier.
    map.set("assetIds", toYArray(group.assetIds));
  });
}

export function patchGroup(
  doc: Y.Doc,
  sceneId: string,
  groupId: string,
  patch: Partial<Omit<RepeatGroup, "id" | "assetIds">>
): void {
  const groups = nestedMapOfMaps(scenesMap(doc).get(sceneId) ?? new Y.Map(), "groups");
  const map = groups?.get(groupId);
  if (!map) return;

  transactLocal(doc, () => {
    const { x, y, ...fields } = patch;
    setPosition(map, { x, y });
    setFields(map, fields);
  });
}

export function setGroupAssets(
  doc: Y.Doc,
  sceneId: string,
  groupId: string,
  assetIds: string[]
): void {
  const groups = nestedMapOfMaps(scenesMap(doc).get(sceneId) ?? new Y.Map(), "groups");
  const map = groups?.get(groupId);
  if (!map) return;

  transactLocal(doc, () => map.set("assetIds", toYArray(assetIds)));
}

export function addGroupAssets(
  doc: Y.Doc,
  sceneId: string,
  groupId: string,
  assetIds: string[]
): void {
  const groups = nestedMapOfMaps(scenesMap(doc).get(sceneId) ?? new Y.Map(), "groups");
  const map = groups?.get(groupId);
  if (!map) return;

  transactLocal(doc, () => {
    const existing = map.get("assetIds");
    if (existing instanceof Y.Array) {
      const have = new Set(existing.toArray());
      const additions = assetIds.filter((id) => !have.has(id));
      if (additions.length > 0) existing.push(additions);
      return;
    }

    map.set("assetIds", toYArray(assetIds));
  });
}

/**
 * Swaps a staged sprite for a repeater at the same origin, one undo step.
 * Returns the new group, or null if the item is already gone.
 */
export function convertItemToRepeater(
  doc: Y.Doc,
  sceneId: string,
  itemId: string,
  groupId: string,
  seed: number
): RepeatGroup | null {
  const items = nestedMapOfMaps(scenesMap(doc).get(sceneId) ?? new Y.Map(), "items");
  const map = items?.get(itemId);
  if (!map) return null;

  const group = repeaterFromItem(readItem(itemId, map), groupId, seed);

  transactLocal(doc, () => {
    removeItem(doc, sceneId, itemId);
    addGroup(doc, sceneId, group);
  });

  return group;
}

export function removeGroup(doc: Y.Doc, sceneId: string, groupId: string): void {
  const groups = nestedMapOfMaps(scenesMap(doc).get(sceneId) ?? new Y.Map(), "groups");
  if (!groups) return;

  transactLocal(doc, () => groups.delete(groupId));
}

export function addTerrain(doc: Y.Doc, sceneId: string, terrain: TerrainGroup): void {
  const scene = scenesMap(doc).get(sceneId);
  if (!scene) return;

  transactLocal(doc, () => {
    const terrains = terrainsMap(scene);
    if (!terrains) return;

    const map = new Y.Map<unknown>();
    terrains.set(terrain.id, map);
    writeTerrainFields(map, {
      ...terrain,
      countX: clampTerrainCount(terrain.countX),
      countY: clampTerrainCount(terrain.countY),
      tiles:
        terrain.tiles.length === clampTerrainCount(terrain.countX) * clampTerrainCount(terrain.countY)
          ? terrain.tiles
          : emptyTiles(terrain.countX, terrain.countY)
    });
  });
}

export function patchTerrain(
  doc: Y.Doc,
  sceneId: string,
  terrainId: string,
  patch: Partial<Omit<TerrainGroup, "id">>
): void {
  const terrains = nestedMapOfMaps(scenesMap(doc).get(sceneId) ?? new Y.Map(), "terrains");
  const map = terrains?.get(terrainId);
  if (!map) return;

  transactLocal(doc, () => {
    const { x, y, tiles, countX, countY, ...fields } = patch;
    setPosition(map, { x, y });

    if (countX !== undefined || countY !== undefined) {
      const current = readTerrain(terrainId, map);
      const nextX = countX ?? current.countX;
      const nextY = countY ?? current.countY;
      map.set("countX", clampTerrainCount(nextX));
      map.set("countY", clampTerrainCount(nextY));
      map.set(
        "tiles",
        toTileArray(resizeTerrainGrid(current.tiles, current.countX, current.countY, nextX, nextY))
      );
    }

    setFields(map, fields);
    if (tiles) map.set("tiles", toTileArray(tiles));
  });
}

export function setTerrainTile(
  doc: Y.Doc,
  sceneId: string,
  terrainId: string,
  index: number,
  patch: Partial<TerrainTile>
): void {
  const terrains = nestedMapOfMaps(scenesMap(doc).get(sceneId) ?? new Y.Map(), "terrains");
  const map = terrains?.get(terrainId);
  if (!map) return;

  transactLocal(doc, () => {
    const tiles = map.get("tiles");
    if (tiles instanceof Y.Array) {
      const entry = tiles.get(index);
      if (entry instanceof Y.Map) {
        if (patch.heightAssetId !== undefined) entry.set("heightAssetId", patch.heightAssetId);
        if (patch.colorAssetId !== undefined) entry.set("colorAssetId", patch.colorAssetId);
        return;
      }
    }

    const current = readTerrain(terrainId, map);
    if (index < 0 || index >= current.tiles.length) return;

    const next = current.tiles.map((tile, tileIndex) =>
      tileIndex === index ? { ...tile, ...patch } : tile
    );
    map.set("tiles", toTileArray(next));
  });
}

export function removeTerrain(doc: Y.Doc, sceneId: string, terrainId: string): void {
  const terrains = nestedMapOfMaps(scenesMap(doc).get(sceneId) ?? new Y.Map(), "terrains");
  if (!terrains) return;

  transactLocal(doc, () => terrains.delete(terrainId));
}

export function clearScene(doc: Y.Doc, sceneId: string): void {
  const scene = scenesMap(doc).get(sceneId);
  if (!scene) return;

  transactLocal(doc, () => {
    scene.set("items", new Y.Map<Y.Map<unknown>>());
    scene.set("groups", new Y.Map<Y.Map<unknown>>());
    scene.set("terrains", new Y.Map<Y.Map<unknown>>());
  });
}

export function addPaletteToPool(doc: Y.Doc, sceneId: string, paletteId: string): void {
  const scene = scenesMap(doc).get(sceneId);
  if (!scene) return;

  transactLocal(doc, () => {
    const pool = scene.get("palettePool");
    if (pool instanceof Y.Array) {
      if (!pool.toArray().includes(paletteId)) pool.push([paletteId]);
    } else {
      scene.set("palettePool", toYArray([paletteId]));
    }
    scene.set("palette", paletteId);
  });
}

export function removePaletteFromPool(doc: Y.Doc, sceneId: string, paletteId: string): void {
  const scene = scenesMap(doc).get(sceneId);
  if (!scene) return;

  transactLocal(doc, () => {
    const pool = scene.get("palettePool");
    if (pool instanceof Y.Array) {
      const index = pool.toArray().indexOf(paletteId);
      if (index >= 0) pool.delete(index, 1);
    }
    if (scene.get("palette") === paletteId) scene.set("palette", "");
  });
}

/**
 * Creates the editable half of an asset if it is missing, seeded from the
 * settings it was generated under.
 *
 * The worker cannot do this -- it writes rows, not Yjs updates -- so the
 * first client to notice a new asset id backfills it. Idempotent, because
 * every client notices.
 */
export function ensureAssetEdits(
  doc: Y.Doc,
  assetId: string,
  seed: { folder: string; processing: ProcessingSettings; hidden?: boolean }
): void {
  const edits = assetEditsMap(doc);
  if (edits.has(assetId)) return;

  transactLocal(doc, () => {
    if (edits.has(assetId)) return;

    const map = new Y.Map<unknown>();
    edits.set(assetId, map);
    map.set("name", "");
    map.set("folder", seed.folder);
    map.set("hidden", seed.hidden === true);
    map.set("tags", new Y.Array<string>());

    const processing = new Y.Map<unknown>();
    map.set("processing", processing);
    for (const [key, value] of Object.entries(withDefaults(seed.processing))) {
      processing.set(key, value);
    }
  });
}

export function patchAssetEdits(
  doc: Y.Doc,
  assetId: string,
  patch: Partial<Pick<AssetEdits, "name" | "folder">>
): void {
  const map = assetEditsMap(doc).get(assetId);
  if (!map) return;

  transactLocal(doc, () => setFields(map, patch));
}

export function setAssetTags(doc: Y.Doc, assetId: string, tags: string[]): void {
  const map = assetEditsMap(doc).get(assetId);
  if (!map) return;

  transactLocal(doc, () => map.set("tags", toYArray(tags)));
}

/**
 * Merges a partial change into an asset's processing settings.
 *
 * Field by field rather than replacing the object, so two collaborators
 * adjusting different sliders on the same sprite both keep their change. A
 * whole-object write would make the second one silently discard the first.
 */
export function patchAssetProcessing(
  doc: Y.Doc,
  assetId: string,
  patch: Partial<ProcessingSettings>
): void {
  const map = assetEditsMap(doc).get(assetId);
  if (!map) return;

  transactLocal(doc, () => {
    let processing = nested(map, "processing");
    if (!processing) {
      processing = new Y.Map<unknown>();
      map.set("processing", processing);
    }

    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) processing.set(key, value);
    }
  });
}

export function deleteAssetEdits(doc: Y.Doc, assetId: string): void {
  transactLocal(doc, () => assetEditsMap(doc).delete(assetId));
}

// --- sequences -------------------------------------------------------------

function sequencesFor(doc: Y.Doc, assetId: string): Y.Map<Y.Map<unknown>> | null {
  const map = assetEditsMap(doc).get(assetId);
  return map ? nestedMapOfMaps(map, "sequences") ?? null : null;
}

/**
 * The sequences container, created on first write rather than seeded into
 * every asset. Must be called inside a transaction: creating it is a document
 * write, and outside `transactLocal` it would land unattributed and outside
 * the undo stack.
 */
function ensureSequences(doc: Y.Doc, assetId: string): Y.Map<Y.Map<unknown>> | null {
  const map = assetEditsMap(doc).get(assetId);
  if (!map) return null;

  const existing = nestedMapOfMaps(map, "sequences");
  if (existing) return existing;

  const created = new Y.Map<Y.Map<unknown>>();
  map.set("sequences", created);
  return created;
}

/**
 * Frames are a `Y.Array` of `Y.Map`, not a plain array on the sequence.
 *
 * Order is meaningful here in a way it is not for processing settings, and a
 * plain array is one register: two people adding a frame at the same moment
 * would resolve to whichever write landed second, silently losing the other.
 * Each frame carries its own id because array positions are not addresses.
 */
function frameMap(frame: SequenceFrame): Y.Map<unknown> {
  const map = new Y.Map<unknown>();

  map.set("id", frame.id);
  map.set("sourceAssetId", frame.sourceAssetId);
  map.set("rect", { ...frame.rect });
  map.set("edits", frame.edits);
  map.set("hold", clampHold(frame.hold));

  return map;
}

function frameArray(frames: SequenceFrame[]): Y.Array<Y.Map<unknown>> {
  const array = new Y.Array<Y.Map<unknown>>();
  array.push(frames.map(frameMap));
  return array;
}

function findFrame(
  sequence: Y.Map<unknown>,
  frameId: string
): Y.Map<unknown> | null {
  const frames = sequence.get("frames");
  if (!(frames instanceof Y.Array)) return null;

  for (const entry of frames.toArray()) {
    if (entry instanceof Y.Map && entry.get("id") === frameId) return entry;
  }

  return null;
}

function writeSequence(sequences: Y.Map<Y.Map<unknown>>, sequence: Sequence): void {
  const map = new Y.Map<unknown>();
  sequences.set(sequence.id, map);
  map.set("name", sequence.name);
  if (sequence.kind === "set") map.set("kind", "set");
  map.set("fps", clampFps(sequence.fps));
  map.set("playback", sequence.playback);
  map.set("inset", { ...sequence.inset });
  map.set("frames", frameArray(sequence.frames));
}

export function putSequence(doc: Y.Doc, assetId: string, sequence: Sequence): void {
  transactLocal(doc, () => {
    const sequences = ensureSequences(doc, assetId);
    if (!sequences) return;
    writeSequence(sequences, sequence);
  });
}

/** One undo step: drop every animation on the asset and write this set. */
export function replaceSequences(doc: Y.Doc, assetId: string, next: Sequence[]): void {
  transactLocal(doc, () => {
    const sequences = ensureSequences(doc, assetId);
    if (!sequences) return;

    for (const id of [...sequences.keys()]) sequences.delete(id);
    for (const sequence of next) writeSequence(sequences, sequence);
  });
}

export function patchSequence(
  doc: Y.Doc,
  assetId: string,
  sequenceId: string,
  patch: Partial<Omit<Sequence, "id" | "frames">>
): void {
  const map = sequencesFor(doc, assetId)?.get(sequenceId);
  if (!map) return;

  transactLocal(doc, () =>
    setFields(map, {
      ...patch,
      fps: patch.fps === undefined ? undefined : clampFps(patch.fps)
    })
  );
}

export function deleteSequence(doc: Y.Doc, assetId: string, sequenceId: string): void {
  const sequences = sequencesFor(doc, assetId);
  if (!sequences) return;

  transactLocal(doc, () => sequences.delete(sequenceId));
}

/**
 * Swaps in a whole new frame list, which is what re-slicing produces.
 *
 * Wholesale rather than diffed: a re-slice changes every rectangle, and there
 * is no correspondence between an old frame and a new one worth preserving.
 */
export function replaceSequenceFrames(
  doc: Y.Doc,
  assetId: string,
  sequenceId: string,
  frames: SequenceFrame[]
): void {
  const map = sequencesFor(doc, assetId)?.get(sequenceId);
  if (!map) return;

  transactLocal(doc, () => map.set("frames", frameArray(frames)));
}

export function patchSequenceFrame(
  doc: Y.Doc,
  assetId: string,
  sequenceId: string,
  frameId: string,
  patch: Partial<Omit<SequenceFrame, "id">>
): void {
  const sequence = sequencesFor(doc, assetId)?.get(sequenceId);
  if (!sequence) return;

  const frame = findFrame(sequence, frameId);
  if (!frame) return;

  transactLocal(doc, () => setFields(frame, patch));
}

/**
 * Removes every trace of an asset from the document: its editable half, any
 * staged copies, and its membership in any repeater. One transaction, so
 * deleting is one undo step rather than several.
 */
export function purgeAsset(doc: Y.Doc, assetId: string): void {
  transactLocal(doc, () => {
    assetEditsMap(doc).delete(assetId);

    for (const [setId, set] of [...assetSetsMap(doc).entries()]) {
      const members = nestedMapOfMaps(set, "members");
      if (!members) continue;
      members.delete(assetId);
      if (members.size === 0) assetSetsMap(doc).delete(setId);
    }

    for (const scene of scenesMap(doc).values()) {
      const items = nestedMapOfMaps(scene, "items");
      if (items) {
        for (const [itemId, item] of [...items.entries()]) {
          if (str(item, "assetId") === assetId) items.delete(itemId);
        }
      }

      const groups = nestedMapOfMaps(scene, "groups");
      if (groups) {
        for (const [groupId, group] of [...groups.entries()]) {
          const assetIds = group.get("assetIds");
          if (!(assetIds instanceof Y.Array)) continue;

          for (let index = assetIds.length - 1; index >= 0; index--) {
            if (assetIds.get(index) === assetId) assetIds.delete(index, 1);
          }

          if (assetIds.length === 0) groups.delete(groupId);
        }
      }

      const terrains = nestedMapOfMaps(scene, "terrains");
      if (!terrains) continue;

      for (const terrain of terrains.values()) {
        const tiles = terrain.get("tiles");
        if (!(tiles instanceof Y.Array)) continue;

        for (let index = 0; index < tiles.length; index++) {
          const entry = tiles.get(index);
          if (!(entry instanceof Y.Map)) continue;
          if (str(entry, "heightAssetId") === assetId) entry.set("heightAssetId", "");
          if (str(entry, "colorAssetId") === assetId) entry.set("colorAssetId", "");
        }
      }
    }
  });
}
