import os from "node:os";
import path from "node:path";
import { LocalFsStorage } from "./local";
import { R2Storage } from "./r2";
import type { Storage } from "./types";

export * from "./types";
export { LocalFsStorage } from "./local";
export { R2Storage } from "./r2";

export type StorageDriver = "local" | "r2";

function expandHome(value: string): string {
  return value.startsWith("~") ? path.join(os.homedir(), value.slice(1)) : value;
}

export function dataRoot(): string {
  const configured = process.env.SPRITEBENCH_DATA_DIR?.trim();
  return configured ? path.resolve(expandHome(configured)) : path.join(process.cwd(), "data");
}

export function storageDriver(): StorageDriver {
  const configured = process.env.STORAGE_DRIVER?.trim().toLowerCase();
  if (!configured || configured === "local") return "local";
  if (configured === "r2") return "r2";

  throw new Error(`unknown STORAGE_DRIVER "${configured}", expected "local" or "r2"`);
}

let cached: Storage | null = null;

export function storage(): Storage {
  if (cached) return cached;

  cached = storageDriver() === "r2" ? R2Storage.fromEnv() : new LocalFsStorage(dataRoot());
  return cached;
}

/** Test seam: swap the driver without touching env. */
export function setStorage(next: Storage | null): void {
  cached = next;
}
