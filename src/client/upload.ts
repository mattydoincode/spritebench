"use client";

import { projectApi, rejectIfNotOk } from "@/client/api";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES } from "@/shared/uploadLimits";

/**
 * Uploads go browser → storage directly on a signed URL, then the worker
 * turns each into an asset (see `src/server/uploads.ts`). This drives the
 * three steps and waits for the worker, so the caller gets asset ids back
 * the same way it did when the server took the bytes itself.
 */

type UploadState = "done" | "pending" | "failed";

/** Files in flight to storage at once. */
const PUT_CONCURRENCY = 4;
const POLL_MS = 1000;
/** A worker busy with generations can take a while; after this, stop waiting. */
const WAIT_MS = 2 * 60 * 1000;

export interface UploadResult {
  assetIds: string[];
  skipped: string[];
  /** Still with the worker when we stopped waiting; they appear on their own. */
  stillProcessing: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function inParallel<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await run(items[next++]);
    })
  );
}

export async function uploadFiles(
  projectId: string,
  files: File[],
  onProgress: (message: string) => void
): Promise<UploadResult> {
  const skipped: string[] = [];
  const accepted = files.filter((file) => {
    if (file.size <= MAX_UPLOAD_BYTES) return true;
    skipped.push(`${file.name} is over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
    return false;
  });

  const sent: { id: string; file: File }[] = [];
  let put = 0;

  for (const group of chunk(accepted, MAX_UPLOAD_FILES)) {
    const { uploads } = await projectApi<{ uploads: { id: string; url: string }[] }>(
      projectId,
      "/assets/upload",
      {
        method: "POST",
        body: JSON.stringify({
          files: group.map((file) => ({ name: file.name, size: file.size, type: file.type }))
        })
      }
    );

    const done: { id: string; file: File }[] = [];
    await inParallel(
      uploads.map((upload, index) => ({ ...upload, file: group[index] })),
      PUT_CONCURRENCY,
      async ({ id, url, file }) => {
        try {
          // Content-Type must match what was signed, or storage refuses it.
          const response = await fetch(url, {
            method: "PUT",
            body: file,
            headers: { "Content-Type": file.type }
          });
          await rejectIfNotOk(response);
          done.push({ id, file });
        } catch {
          skipped.push(`${file.name} did not upload`);
        }
        onProgress(`uploading ${++put}/${accepted.length}`);
      }
    );

    if (done.length > 0) {
      await projectApi(projectId, "/assets/upload/complete", {
        method: "POST",
        body: JSON.stringify({ uploads: done.map(({ id, file }) => ({ id, name: file.name })) })
      });
      sent.push(...done);
    }
  }

  const names = new Map(sent.map(({ id, file }) => [id, file.name]));
  const assetIds: string[] = [];
  let pending = sent.map(({ id }) => id);
  const deadline = Date.now() + WAIT_MS;

  while (pending.length > 0 && Date.now() < deadline) {
    onProgress(`processing ${sent.length - pending.length}/${sent.length}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));

    const still: string[] = [];
    for (const ids of chunk(pending, MAX_UPLOAD_FILES)) {
      const { states } = await projectApi<{ states: Record<string, UploadState> }>(
        projectId,
        `/assets/upload?ids=${ids.join(",")}`
      );
      for (const id of ids) {
        const state = states[id] ?? "pending";
        if (state === "done") assetIds.push(id);
        else if (state === "failed") skipped.push(`${names.get(id)} is not an image, or is too large`);
        else still.push(id);
      }
    }
    pending = still;
  }

  // Keep the order the files were chosen in.
  const order = new Map(sent.map(({ id }, index) => [id, index]));
  assetIds.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

  return { assetIds, skipped, stillProcessing: pending.length };
}
