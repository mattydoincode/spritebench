/**
 * One-shot migration from the filesystem-and-JSON layout into Postgres plus
 * object storage.
 *
 * Reads the legacy directory with plain `fs` and writes through the configured
 * storage driver, so the same script seeds a local data directory or uploads
 * everything to R2.
 *
 * Asset and composition ids are preserved deliberately: compositions reference
 * assets by id, so reassigning them would silently empty every saved scene.
 *
 *   npm run import:legacy               # import, skipping anything already there
 *   npm run import:legacy -- --reset    # wipe this user's rows first
 *   npm run import:legacy -- --from ./old-data
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { withDefaults } from "@/core/settings";
import { closeDb, db } from "@/db";
import { assets, compositions, palettes, templates, userSettings } from "@/db/schema";
import { currentUserId } from "@/db/repo/users";
import { parsePalette } from "@/server/palettes";
import { readPngSize } from "@/server/png";
import { buildThumbnail } from "@/server/thumbnails";
import { dataRoot, storage } from "@/storage";
import { exportKey, paletteKey, sourceKey, templateKey, thumbKey } from "@/storage/keys";
import {
  DEFAULT_GENERATION,
  type AssetRecord,
  type Composition,
  type StudioSettings
} from "@/shared/model";

interface Options {
  from: string;
  reset: boolean;
}

function parseArgs(argv: string[]): Options {
  const fromIndex = argv.indexOf("--from");

  return {
    from: fromIndex >= 0 ? path.resolve(argv[fromIndex + 1] ?? "") : dataRoot(),
    reset: argv.includes("--reset")
  };
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function listFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

const counts = {
  settings: 0,
  palettes: 0,
  templates: 0,
  sources: 0,
  thumbnails: 0,
  exports: 0,
  compositions: 0,
  skipped: 0
};

async function importSettings(userId: string, from: string): Promise<void> {
  const file = path.join(from, "library", "studio.json");
  if (!fs.existsSync(file)) return;

  const stored = readJson<Partial<StudioSettings> & { concurrency?: number }>(file, {});

  await db()
    .update(userSettings)
    .set({
      promptPrefix: stored.promptPrefix ?? "",
      promptSuffix: stored.promptSuffix ?? "",
      assetSlug: stored.assetSlug ?? "prop",
      generation: { ...DEFAULT_GENERATION, ...(stored.generation ?? {}) },
      processing: withDefaults(stored.processing),
      // `concurrency` is intentionally dropped: it is server configuration now.
      activeCompositionId: stored.activeCompositionId ?? null,
      cutTemplateBackgroundOnPaste: stored.cutTemplateBackgroundOnPaste ?? true,
      templateCutTolerance: stored.templateCutTolerance ?? 0.28,
      updatedAt: new Date()
    })
    .where(eq(userSettings.userId, userId));

  counts.settings = 1;
}

async function importPalettes(userId: string, from: string): Promise<void> {
  const dir = path.join(from, "palettes");

  for (const file of listFiles(dir)) {
    const bytes = fs.readFileSync(path.join(dir, file));
    const colors = parsePalette(file, bytes);

    if (colors.length === 0) {
      console.warn(`  ! ${file}: no colours could be read, skipping`);
      counts.skipped++;
      continue;
    }

    await storage().put(paletteKey(file), bytes, {
      contentType: file.toLowerCase().endsWith(".png") ? "image/png" : "text/plain"
    });

    await db()
      .insert(palettes)
      .values({ userId, filename: file, storageKey: paletteKey(file), colors })
      .onConflictDoUpdate({
        target: [palettes.userId, palettes.filename],
        set: { storageKey: paletteKey(file), colors }
      });

    counts.palettes++;
  }
}

async function importTemplates(userId: string, from: string): Promise<void> {
  const dir = path.join(from, "templates");

  for (const file of listFiles(dir)) {
    // `_edit_base.png` and `_edit_mask.png` were scratch files written by every
    // template job to the same two paths. They are not templates.
    if (!file.toLowerCase().endsWith(".png") || file.startsWith("_edit_")) continue;

    const bytes = fs.readFileSync(path.join(dir, file));

    let size;
    try {
      size = readPngSize(bytes);
    } catch {
      console.warn(`  ! ${file}: not a readable PNG, skipping`);
      counts.skipped++;
      continue;
    }

    await storage().put(templateKey(file), bytes, { contentType: "image/png" });

    await db()
      .insert(templates)
      .values({
        userId,
        filename: file,
        storageKey: templateKey(file),
        width: size.width,
        height: size.height
      })
      .onConflictDoUpdate({
        target: [templates.userId, templates.filename],
        set: { storageKey: templateKey(file), width: size.width, height: size.height }
      });

    counts.templates++;
  }
}

/**
 * Legacy `approvedPath` values are Godot resource paths like
 * `res://art/approved/props/name.png`. Only the trailing folder and filename
 * carry over.
 */
function exportKeyFor(approvedPath: string): string {
  const parts = approvedPath.split("/").filter((part) => part.length > 0);
  const file = parts[parts.length - 1] ?? "";
  const folder = parts.length >= 2 ? parts[parts.length - 2] : "props";

  return exportKey(folder, file);
}

async function importAssets(userId: string, from: string): Promise<void> {
  const indexFile = path.join(from, "library", "index.json");
  if (!fs.existsSync(indexFile)) {
    console.warn("  ! no library/index.json found, no assets to import");
    return;
  }

  const records = readJson<AssetRecord[]>(indexFile, []);
  const sourceDir = path.join(from, "sources");

  for (const record of records) {
    const sourcePath = path.join(sourceDir, record.sourceFile);

    if (!record.sourceFile || !fs.existsSync(sourcePath)) {
      console.warn(`  ! ${record.name}: source ${record.sourceFile} is missing, skipping`);
      counts.skipped++;
      continue;
    }

    const bytes = fs.readFileSync(sourcePath);
    const key = sourceKey(record.sourceFile);

    await storage().put(key, bytes, {
      contentType: "image/png",
      cacheControl: "public, max-age=31536000, immutable"
    });
    counts.sources++;

    // Thumbnails did not exist before; generate them so the library grid gets
    // the cheap path immediately rather than on next generation.
    let thumb: string | null = null;
    try {
      await storage().put(thumbKey(record.name), await buildThumbnail(bytes), {
        contentType: "image/webp",
        cacheControl: "public, max-age=31536000, immutable"
      });
      thumb = thumbKey(record.name);
      counts.thumbnails++;
    } catch (error) {
      console.warn(`  ! ${record.name}: could not build a thumbnail`, error);
    }

    const legacyExport = record.approvedPath ? exportKeyFor(record.approvedPath) : null;

    await db()
      .insert(assets)
      .values({
        // Preserved so saved compositions keep resolving.
        id: record.id,
        userId,
        name: record.name,
        folder: record.folder ?? "",
        tags: record.tags ?? [],
        sourceKey: key,
        thumbKey: thumb,
        sourceWidth: record.sourceWidth,
        sourceHeight: record.sourceHeight,
        byteSize: bytes.length,
        prompt: record.prompt,
        composedPrompt: record.composedPrompt ?? "",
        generation: { ...DEFAULT_GENERATION, ...(record.generation ?? {}) },
        processing: withDefaults(record.processing),
        processingDescription: record.processingDescription ?? "",
        exportKey: legacyExport,
        exportName: record.approvedName ?? null,
        rerunOf: record.rerunOf ?? null,
        // Legacy job ids lived in loose JSON files that are not being imported.
        jobId: null,
        template: record.template ?? null,
        usage: record.usage ?? null,
        elapsedSeconds: record.elapsedSeconds ?? null,
        createdAt: record.createdAt ? new Date(record.createdAt) : new Date(),
        // Imported assets are not put on the roll-off clock: nobody expects a
        // migration to start a 30-day timer on work they already have.
        expiresAt: null
      })
      .onConflictDoNothing();
  }
}

async function importExports(from: string): Promise<void> {
  const root = path.join(from, "exports");
  if (!fs.existsSync(root)) return;

  const stack = [root];

  while (stack.length > 0) {
    const dir = stack.pop() as string;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;

      const relative = path.relative(root, full).split(path.sep).join("/");
      await storage().put(`exports/${relative}`, fs.readFileSync(full), {
        contentType: entry.name.endsWith(".json") ? "application/json" : "image/png"
      });

      counts.exports++;
    }
  }
}

/** Folds forward field renames that accumulated over the tool's life. */
function normalizeComposition(raw: unknown): Composition {
  const legacy = raw as Composition & { paletteOverride?: string | null };

  return {
    id: legacy.id,
    name: legacy.name ?? "playground",
    updatedAt: legacy.updatedAt ?? new Date().toISOString(),
    unitsPerCell: legacy.unitsPerCell ?? 64,
    camera: legacy.camera ?? { x: 0, y: 0, zoom: 4 },
    items: (legacy.items ?? []).map((item) => {
      // `repeat` was superseded by top-level groups.
      const { repeat: _repeat, ...rest } = item as typeof item & { repeat?: unknown };
      return rest;
    }),
    groups: (legacy.groups ?? []).map((group) => ({
      ...group,
      randomRotate: group.randomRotate ?? false,
      background: group.background ?? ""
    })),
    palettePool: legacy.palettePool ?? [],
    palette: legacy.palette ?? legacy.paletteOverride ?? "",
    paletteDither: legacy.paletteDither ?? "none",
    paletteDitherStrength: legacy.paletteDitherStrength ?? 1
  };
}

async function importCompositions(userId: string, from: string): Promise<void> {
  const dir = path.join(from, "library", "compositions");

  for (const file of listFiles(dir)) {
    if (!file.endsWith(".json")) continue;

    const raw = readJson<Record<string, unknown> | null>(path.join(dir, file), null);
    if (!raw?.id) {
      console.warn(`  ! ${file}: no id, skipping`);
      counts.skipped++;
      continue;
    }

    const doc = normalizeComposition(raw);

    await db()
      .insert(compositions)
      .values({ id: doc.id, userId, name: doc.name, doc, version: 1 })
      .onConflictDoNothing();

    counts.compositions++;
  }
}

async function reset(userId: string): Promise<void> {
  console.log("  resetting existing rows for this user");

  await db().delete(compositions).where(eq(compositions.userId, userId));
  await db().delete(assets).where(eq(assets.userId, userId));
  await db().delete(templates).where(eq(templates.userId, userId));
  await db().delete(palettes).where(eq(palettes.userId, userId));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(options.from)) {
    throw new Error(`legacy data directory not found: ${options.from}`);
  }

  console.log(`[import] reading ${options.from}`);

  const userId = await currentUserId();
  console.log(`[import] importing as user ${userId}`);

  if (options.reset) await reset(userId);

  console.log("[import] settings");
  await importSettings(userId, options.from);

  console.log("[import] palettes");
  await importPalettes(userId, options.from);

  console.log("[import] templates");
  await importTemplates(userId, options.from);

  console.log("[import] assets and sources");
  await importAssets(userId, options.from);

  console.log("[import] exports");
  await importExports(options.from);

  console.log("[import] compositions");
  await importCompositions(userId, options.from);

  console.log("\n[import] done");
  for (const [key, value] of Object.entries(counts)) {
    console.log(`  ${key.padEnd(13)} ${value}`);
  }
}

main()
  .catch((error) => {
    console.error("[import] failed", error);
    process.exitCode = 1;
  })
  .finally(() => void closeDb());
