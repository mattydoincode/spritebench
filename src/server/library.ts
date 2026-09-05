import fs from "node:fs";
import path from "node:path";
import { DEFAULT_PROCESSING, withDefaults } from "@/core/settings";
import {
  DEFAULT_GENERATION,
  type AssetRecord,
  type Composition,
  type StudioSettings
} from "@/shared/model";
import { ensureFolders, paths } from "./paths";

let chain: Promise<unknown> = Promise.resolve();

export function serialize<T>(work: () => T | Promise<T>): Promise<T> {
  const run = chain.then(work, work);
  chain = run.catch(() => undefined);
  return run;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const indexFile = () => path.join(paths.library, "index.json");
const settingsFile = () => path.join(paths.library, "studio.json");

export const DEFAULT_STUDIO_SETTINGS: StudioSettings = {
  promptPrefix:
    "You are generating game art from a 100% top-down perspective. This means we'll only see the tops of objects, never the sides. Schematic like, no perspective, perfectly top down.",
  promptSuffix: "Transparent Background",
  assetSlug: "prop",
  generation: DEFAULT_GENERATION,
  processing: DEFAULT_PROCESSING,
  concurrency: 4,
  activeCompositionId: null,
  cutTemplateBackgroundOnPaste: true,
  templateCutTolerance: 0.28
};

export function readSettings(): StudioSettings {
  ensureFolders();
  const stored = readJson<Partial<StudioSettings>>(settingsFile(), {});

  return {
    ...DEFAULT_STUDIO_SETTINGS,
    ...stored,
    generation: { ...DEFAULT_GENERATION, ...(stored.generation ?? {}) },
    processing: withDefaults(stored.processing)
  };
}

export function writeSettings(settings: StudioSettings): StudioSettings {
  ensureFolders();
  writeJson(settingsFile(), settings);
  return settings;
}

export function readAssets(): AssetRecord[] {
  ensureFolders();
  const records = readJson<AssetRecord[]>(indexFile(), []);

  return records.map((record) => ({
    ...record,
    processing: withDefaults(record.processing),
    tags: record.tags ?? [],
    folder: record.folder ?? ""
  }));
}

export function writeAssets(records: AssetRecord[]): void {
  ensureFolders();
  writeJson(indexFile(), records);
}

export function upsertAsset(record: AssetRecord): AssetRecord {
  const records = readAssets();
  const index = records.findIndex((entry) => entry.id === record.id);

  if (index >= 0) records[index] = record;
  else records.push(record);

  writeAssets(records);
  return record;
}

export function getAsset(id: string): AssetRecord | undefined {
  return readAssets().find((record) => record.id === id);
}

export function deleteAsset(id: string, removeFiles: boolean): void {
  const records = readAssets();
  const target = records.find((record) => record.id === id);
  writeAssets(records.filter((record) => record.id !== id));

  if (!target || !removeFiles) return;

  const source = path.join(paths.sources, target.sourceFile);
  if (fs.existsSync(source)) fs.unlinkSync(source);
}

export function sanitizeName(value: string, fallback: string): string {
  const cleaned = (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return cleaned.length > 0 ? cleaned : fallback;
}

export function timestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

export function uniqueFilePath(folder: string, filename: string): string {
  const extension = path.extname(filename);
  const base = path.basename(filename, extension);

  let candidate = path.join(folder, filename);
  let counter = 2;

  while (fs.existsSync(candidate)) {
    candidate = path.join(folder, `${base}_${counter}${extension}`);
    counter++;
  }

  return candidate;
}

export function readCompositions(): Composition[] {
  ensureFolders();
  const files = fs
    .readdirSync(paths.compositions)
    .filter((file) => file.endsWith(".json"))
    .sort();

  return files
    .map((file) => readJson<Composition | null>(path.join(paths.compositions, file), null))
    .filter((entry): entry is Composition => entry !== null)
    .map((entry) => ({
      ...entry,
      items: entry.items ?? [],
      groups: (entry.groups ?? []).map((group) => ({
        ...group,
        randomRotate: group.randomRotate ?? false,
        background: group.background ?? ""
      })),
      palettePool: entry.palettePool ?? [],
      palette: entry.palette ?? (entry as { paletteOverride?: string | null }).paletteOverride ?? "",
      paletteDither: entry.paletteDither ?? "none",
      paletteDitherStrength: entry.paletteDitherStrength ?? 1
    }));
}

export function writeComposition(composition: Composition): Composition {
  ensureFolders();
  writeJson(path.join(paths.compositions, `${composition.id}.json`), composition);
  return composition;
}

export function deleteComposition(id: string): void {
  const file = path.join(paths.compositions, `${id}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
