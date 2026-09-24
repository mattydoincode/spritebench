/**
 * Starts `next dev --turbopack` and, after the server is idle, hits the
 * common pages so they compile on this process instead of on the next click.
 *
 * Warmup shares Next's compiler lock, so it waits for file-watch quiet
 * rather than running during HMR.
 */
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  createDebouncedIdle,
  isDevReadyLine,
  warmupUrls,
  WARMUP_COOKIE,
  WARMUP_PATHS
} from "@/dev/warmup";

const root = path.resolve(import.meta.dirname, "..");
const port = process.env.PORT || "4300";
const origin = `http://127.0.0.1:${port}`;
const idleMs = Number(process.env.DEV_WARMUP_IDLE_MS) || 2000;
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

let ready = false;
let warming = false;

async function warm(): Promise<void> {
  if (!ready || warming) return;
  warming = true;
  try {
    for (const url of warmupUrls(origin)) {
      try {
        await fetch(url, {
          redirect: "manual",
          headers: { cookie: WARMUP_COOKIE },
          signal: AbortSignal.timeout(30_000)
        });
      } catch {
        // Server restarted or the compile threw; the next idle pass retries.
      }
    }
    console.log(`warmup ${WARMUP_PATHS.join(" ")}`);
  } finally {
    warming = false;
  }
}

const idle = createDebouncedIdle(idleMs, () => {
  void warm();
});

function onNextLine(chunk: Buffer): void {
  const text = chunk.toString();
  process.stdout.write(chunk);
  if (!ready && text.split(/\r?\n/).some(isDevReadyLine)) {
    ready = true;
    idle.bump();
  }
}

const child = spawn(process.execPath, [nextBin, "dev", "--turbopack", "-p", port, ...process.argv.slice(2)], {
  cwd: root,
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"]
});

child.stdout?.on("data", onNextLine);
child.stderr?.on("data", (chunk: Buffer) => {
  process.stderr.write(chunk);
});

for (const target of ["app", "src", "middleware.ts"]) {
  watch(path.join(root, target), { recursive: true }, () => {
    if (ready) idle.bump();
  });
}

const stop = (signal: NodeJS.Signals) => {
  idle.cancel();
  child.kill(signal);
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

child.on("exit", (code, signal) => {
  idle.cancel();
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
