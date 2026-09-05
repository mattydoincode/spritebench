import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { withDefaults } from "@/core/settings";
import { readAssets, readSettings, serialize, writeAssets } from "@/server/library";
import { ensureFolders, paths, toStoragePath } from "@/server/paths";
import { decodePng } from "@/server/png";
import type { AssetRecord } from "@/shared/model";

export const dynamic = "force-dynamic";

interface LegacySidecar {
  prompt?: string;
  model?: string;
  post_processing?: string;
  total_tokens?: number;
  elapsed_seconds?: number;
}

function readSidecar(pngPath: string): LegacySidecar {
  const sidecar = `${pngPath.slice(0, -path.extname(pngPath).length)}.json`;
  if (!fs.existsSync(sidecar)) return {};

  try {
    return JSON.parse(fs.readFileSync(sidecar, "utf8")) as LegacySidecar;
  } catch {
    return {};
  }
}

function findApproved(baseName: string): string | null {
  const approvedRoot = path.dirname(paths.exports);
  if (!fs.existsSync(approvedRoot)) return null;

  const stack = [approvedRoot];
  while (stack.length > 0) {
    const dir = stack.pop() as string;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === `${baseName}.png`) return full;
    }
  }

  return null;
}

export async function POST() {
  ensureFolders();

  const extraImportDir = process.env.ART_STUDIO_IMPORT_DIR?.trim() ?? "";

  const result = await serialize(() => {
    const settings = readSettings();
    const existing = readAssets();
    const known = new Set(existing.map((asset) => asset.sourceFile));
    const added: AssetRecord[] = [];

    const candidates: string[] = [];

    for (const dir of [paths.sources, extraImportDir].filter((dir) => dir.length > 0)) {
      if (!fs.existsSync(dir)) continue;

      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".png")) continue;
        candidates.push(path.join(dir, entry.name));
      }
    }

    for (const file of candidates) {
      const filename = path.basename(file);
      if (known.has(filename)) continue;

      let decoded;
      try {
        decoded = decodePng(fs.readFileSync(file));
      } catch {
        continue;
      }

      const target = path.join(paths.sources, filename);
      if (!fs.existsSync(target)) fs.copyFileSync(file, target);

      const baseName = path.basename(filename, ".png");
      const sidecar = readSidecar(file);
      const approved = findApproved(baseName);

      const record: AssetRecord = {
        id: crypto.randomUUID(),
        name: baseName,
        folder: "imported",
        tags: ["imported"],
        createdAt: fs.statSync(file).mtime.toISOString(),
        sourceFile: filename,
        sourceWidth: decoded.width,
        sourceHeight: decoded.height,
        prompt: {
          prefix: "",
          body: sidecar.prompt ?? "",
          suffix: ""
        },
        composedPrompt: sidecar.prompt ?? "",
        generation: {
          ...settings.generation,
          model: sidecar.model || settings.generation.model,
          size: { width: decoded.width, height: decoded.height }
        },
        processing: withDefaults(settings.processing),
        processingDescription: sidecar.post_processing ?? "",
        approvedPath: approved ? toStoragePath(approved) : null,
        approvedName: approved ? path.basename(approved, ".png") : null,
        rerunOf: null,
        jobId: null,
        template: null,
        usage: sidecar.total_tokens
          ? { totalTokens: sidecar.total_tokens, inputTokens: 0, outputTokens: 0 }
          : null,
        elapsedSeconds: sidecar.elapsed_seconds ?? null
      };

      known.add(filename);
      added.push(record);
    }

    if (added.length > 0) writeAssets([...existing, ...added]);
    return { imported: added.length, total: existing.length + added.length };
  });

  return NextResponse.json(result);
}
