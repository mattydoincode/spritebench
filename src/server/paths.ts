import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let cachedRoot: string | null = null;

export function dataRoot(): string {
  if (cachedRoot) return cachedRoot;

  const configured = process.env.ART_STUDIO_DATA_DIR?.trim();

  cachedRoot = configured
    ? path.resolve(configured.startsWith("~") ? configured.replace("~", os.homedir()) : configured)
    : path.join(process.cwd(), "data");

  return cachedRoot;
}

export const paths = {
  get root() {
    return dataRoot();
  },
  get sources() {
    return path.join(dataRoot(), "sources");
  },
  get templates() {
    return path.join(dataRoot(), "templates");
  },
  get jobs() {
    return path.join(dataRoot(), "jobs");
  },
  get library() {
    return path.join(dataRoot(), "library");
  },
  get assets() {
    return path.join(dataRoot(), "library", "assets");
  },
  get compositions() {
    return path.join(dataRoot(), "library", "compositions");
  },
  get exports() {
    return path.join(dataRoot(), "exports", "props");
  },
  get palettes() {
    return path.join(dataRoot(), "palettes");
  }
};

let prepared = false;

export function ensureFolders(): void {
  if (prepared) return;

  for (const key of [
    "sources",
    "templates",
    "jobs",
    "library",
    "assets",
    "compositions",
    "exports",
    "palettes"
  ] as const) {
    fs.mkdirSync(paths[key], { recursive: true });
  }

  prepared = true;
}

export function toStoragePath(absolute: string): string {
  return path.relative(dataRoot(), absolute).split(path.sep).join("/");
}
