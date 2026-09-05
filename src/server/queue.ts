import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { applyPipeline } from "@/core/pipeline";
import { withDefaults, type ProcessingSettings } from "@/core/settings";
import type { Size } from "@/core/types";
import {
  composePrompt,
  type AssetRecord,
  type GenerationParams,
  type JobRecord,
  type PromptSpec,
  type TemplateSpec
} from "@/shared/model";
import { buildEditInputs } from "./template";
import { editImage, generateImages } from "./openai";
import {
  readSettings,
  sanitizeName,
  serialize,
  timestamp,
  uniqueFilePath,
  upsertAsset
} from "./library";
import { decodePng } from "./png";
import { ensureFolders, paths } from "./paths";

export interface EnqueueOptions {
  prompt: PromptSpec;
  generation: GenerationParams;
  processing: ProcessingSettings;
  folder: string;
  label?: string;
  template?: TemplateSpec | null;
  rerunOf?: string | null;
  batchId?: string | null;
  batchIndex?: number;
  batchSize?: number;
}

const jobs = new Map<string, JobRecord>();
let running = 0;
let loaded = false;

function jobFile(id: string): string {
  return path.join(paths.jobs, `${id}.json`);
}

function persist(job: JobRecord): void {
  ensureFolders();
  fs.writeFileSync(jobFile(job.id), `${JSON.stringify(job, null, 2)}\n`);
}

function loadFromDisk(): void {
  if (loaded) return;
  loaded = true;
  ensureFolders();

  for (const file of fs.readdirSync(paths.jobs)) {
    if (!file.endsWith(".json")) continue;

    try {
      const job = JSON.parse(fs.readFileSync(path.join(paths.jobs, file), "utf8")) as JobRecord;

      job.batchId = job.batchId ?? null;
      job.batchIndex = job.batchIndex ?? 1;
      job.batchSize = job.batchSize ?? 1;

      if (job.status === "running" || job.status === "queued") {
        job.status = "error";
        job.error = "interrupted by a server restart";
        job.finishedAt = new Date().toISOString();
        persist(job);
      }

      jobs.set(job.id, job);
    } catch {
      continue;
    }
  }
}

export function listJobs(): JobRecord[] {
  loadFromDisk();
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function clearFinishedJobs(): void {
  loadFromDisk();

  for (const [id, job] of [...jobs.entries()]) {
    if (job.status === "queued" || job.status === "running") continue;

    jobs.delete(id);
    const file = jobFile(id);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

export function cancelJob(id: string): boolean {
  loadFromDisk();
  const job = jobs.get(id);
  if (!job || job.status !== "queued") return false;

  job.status = "cancelled";
  job.finishedAt = new Date().toISOString();
  persist(job);
  return true;
}

export function enqueue(options: EnqueueOptions): JobRecord {
  loadFromDisk();

  const composed = composePrompt(options.prompt);
  const job: JobRecord = {
    id: crypto.randomUUID(),
    status: "queued",
    label: options.label?.trim() || options.prompt.body.trim().slice(0, 60) || "untitled",
    batchId: options.batchId ?? null,
    batchIndex: options.batchIndex ?? 1,
    batchSize: options.batchSize ?? 1,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    prompt: options.prompt,
    composedPrompt: composed,
    generation: options.generation,
    processing: { ...withDefaults(options.processing), edits: [] },
    folder: options.folder ?? "",
    template: options.template ?? null,
    rerunOf: options.rerunOf ?? null,
    assetIds: [],
    resolvedSize: null,
    error: null
  };

  jobs.set(job.id, job);
  persist(job);
  void pump();

  return job;
}

async function pump(): Promise<void> {
  loadFromDisk();
  const limit = Math.max(1, readSettings().concurrency);

  while (running < limit) {
    const next = [...jobs.values()]
      .filter((job) => job.status === "queued")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

    if (!next) return;

    running++;
    void runJob(next).finally(() => {
      running--;
      void pump();
    });
  }
}

async function runJob(job: JobRecord): Promise<void> {
  job.status = "running";
  job.startedAt = new Date().toISOString();
  job.error = null;
  persist(job);

  try {
    const result = job.template?.useAsMask
      ? await runTemplateEdit(job)
      : await generateImages(job.composedPrompt, job.generation);

    job.resolvedSize = result.resolvedSize;

    const settings = readSettings();
    const slug = sanitizeName(settings.assetSlug, "asset");
    const stamp = timestamp();

    for (let index = 0; index < result.images.length; index++) {
      const bytes = result.images[index];
      const filename = `${slug}_${stamp}_${index + 1}.png`;

      const target = await serialize(() => uniqueFilePath(paths.sources, filename));
      fs.writeFileSync(target, bytes);

      const decoded = decodePng(bytes);
      const processed = applyPipeline(decoded, job.processing, []);

      const record: AssetRecord = {
        id: crypto.randomUUID(),
        name: path.basename(target, ".png"),
        folder: job.folder,
        tags: [],
        createdAt: new Date().toISOString(),
        sourceFile: path.basename(target),
        sourceWidth: decoded.width,
        sourceHeight: decoded.height,
        prompt: job.prompt,
        composedPrompt: job.composedPrompt,
        generation: job.generation,
        processing: job.processing,
        processingDescription: processed.description,
        approvedPath: null,
        approvedName: null,
        rerunOf: job.rerunOf,
        jobId: job.id,
        template: job.template ?? null,
        usage: result.usage,
        elapsedSeconds: result.elapsedSeconds
      };

      await serialize(() => upsertAsset(record));
      job.assetIds.push(record.id);
      persist(job);
    }

    job.status = "done";
  } catch (error) {
    job.status = "error";
    job.error = error instanceof Error ? error.message : String(error);
  } finally {
    job.finishedAt = new Date().toISOString();
    persist(job);
  }
}

async function runTemplateEdit(job: JobRecord) {
  if (!job.template) throw new Error("job has no template");

  const inputs = await buildEditInputs(job.template, job.generation);
  const size: Size = inputs.size;

  return editImage(job.composedPrompt, job.generation, inputs.basePath, inputs.maskPath, size);
}
