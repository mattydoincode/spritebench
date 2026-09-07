/**
 * Reads configuration from the environment.
 *
 * `.env` declares every variable the app knows about, with values that suit
 * production, and it ships inside the image. So there are no fallbacks in
 * code: one variable, one place it is written down. A missing value is a
 * thrown error naming it, not a silent default.
 *
 * Precedence belongs to the platform. Node and Next both decline to overwrite
 * a variable that is already set, so DigitalOcean's injected values beat the
 * file, and `.env.local` beats `.env` locally.
 */
import { existsSync } from "node:fs";

let loaded = false;

/**
 * Loads `.env` for processes Next does not start -- the worker, the migrator,
 * the scripts. Next reads these files itself, so this is a no-op there.
 *
 * `.env.local` goes first because `loadEnvFile` will not overwrite a variable
 * that is already set, which makes whichever file is read first the winner.
 */
export function loadEnvDefaults(): void {
  if (loaded) return;
  loaded = true;

  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

export function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

export function str(name: string): string {
  const value = optional(name);
  if (!value) throw new Error(`${name} is not set (declared in .env)`);
  return value;
}

export function num(name: string): number {
  const raw = str(name);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number, got "${raw}"`);
  return parsed;
}

/** A count, so fractional or negative input is a mistake rather than a mode. */
export function count(name: string): number {
  return Math.max(1, Math.floor(num(name)));
}
