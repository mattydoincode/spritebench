"use client";

import { projectApi } from "@/client/api";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES } from "@/shared/uploadLimits";

/**
 * Uploads go browser → storage directly on a signed URL, then the worker
 * turns each into an asset (see `src/server/uploads.ts`). This drives the
 * three steps and reports each file's progress as it goes, so the library
 * can draw a placeholder per file.
 */

type UploadState = "done" | "pending" | "failed";

/** Files in flight to storage at once. */
const PUT_CONCURRENCY = 4;
const POLL_MS = 1000;
/** A worker busy with generations can take a while; after this, stop waiting. */
const WAIT_MS = 2 * 60 * 1000;

export interface UploadCallbacks {
  /** Bytes going up, 0..1. */
  progress: (id: string, fraction: number) => void;
  /** In storage; waiting on the worker. */
  processing: (id: string) => void;
  failed: (id: string, reason: string) => void;
  /** Newly finished, in the order the files were chosen. */
  done: (finished: { id: string; assetId: string }[]) => Promise<void>;
}

/** Ids here are the caller's own; the server's are mapped back before any callback. */
export interface OutgoingFile {
  id: string;
  file: File;
}

export interface UploadResult {
  assetIds: string[];
  failed: number;
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

/** A PUT with upload progress, which `fetch` cannot report. */
function put(url: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    // Must match what was signed, or storage refuses it.
    request.setRequestHeader("Content-Type", file.type);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error(`upload refused (${request.status})`));
    request.onerror = () => reject(new Error("upload failed"));
    request.send(file);
  });
}

export async function uploadFiles(
  projectId: string,
  files: OutgoingFile[],
  callbacks: UploadCallbacks
): Promise<UploadResult> {
  let failed = 0;
  const fail = (id: string, reason: string) => {
    failed++;
    callbacks.failed(id, reason);
  };

  const accepted = files.filter(({ id, file }) => {
    if (file.size <= MAX_UPLOAD_BYTES) return true;
    fail(id, `over ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
    return false;
  });

  /** Server upload id → caller's id. */
  const local = new Map<string, string>();
  const sent: string[] = [];

  for (const group of chunk(accepted, MAX_UPLOAD_FILES)) {
    let uploads: { id: string; url: string }[];
    try {
      ({ uploads } = await projectApi<{ uploads: { id: string; url: string }[] }>(
        projectId,
        "/assets/upload",
        {
          method: "POST",
          body: JSON.stringify({
            files: group.map(({ file }) => ({ name: file.name, size: file.size, type: file.type }))
          })
        }
      ));
    } catch (error) {
      for (const { id } of group) fail(id, error instanceof Error ? error.message : "refused");
      continue;
    }

    const stored: { serverId: string; file: File }[] = [];
    await inParallel(
      uploads.map((upload, index) => ({
        serverId: upload.id,
        url: upload.url,
        id: group[index].id,
        file: group[index].file
      })),
      PUT_CONCURRENCY,
      async ({ serverId, url, id, file }) => {
        local.set(serverId, id);
        try {
          await put(url, file, (fraction) => callbacks.progress(id, fraction));
          callbacks.processing(id);
          stored.push({ serverId, file });
        } catch (error) {
          fail(id, error instanceof Error ? error.message : "upload failed");
        }
      }
    );

    if (stored.length === 0) continue;
    try {
      await projectApi(projectId, "/assets/upload/complete", {
        method: "POST",
        body: JSON.stringify({
          uploads: stored.map(({ serverId, file }) => ({ id: serverId, name: file.name }))
        })
      });
      sent.push(...stored.map(({ serverId }) => serverId));
    } catch (error) {
      for (const { serverId } of stored) {
        fail(local.get(serverId)!, error instanceof Error ? error.message : "refused");
      }
    }
  }

  // Keep the order the files were chosen in.
  const order = new Map(files.map(({ id }, index) => [id, index]));
  const assetIds: string[] = [];
  let pending = sent;
  const deadline = Date.now() + WAIT_MS;

  while (pending.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));

    const still: string[] = [];
    const finished: { id: string; assetId: string }[] = [];
    for (const ids of chunk(pending, MAX_UPLOAD_FILES)) {
      let states: Record<string, UploadState>;
      try {
        ({ states } = await projectApi<{ states: Record<string, UploadState> }>(
          projectId,
          `/assets/upload?ids=${ids.join(",")}`
        ));
      } catch {
        // A dropped poll is not a failed upload; ask again next tick.
        still.push(...ids);
        continue;
      }
      for (const serverId of ids) {
        const state = states[serverId] ?? "pending";
        const id = local.get(serverId)!;
        if (state === "done") finished.push({ id, assetId: serverId });
        else if (state === "failed") fail(id, "not an image, or too large");
        else still.push(serverId);
      }
    }

    if (finished.length > 0) {
      finished.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      assetIds.push(...finished.map(({ assetId }) => assetId));
      await callbacks.done(finished);
    }
    pending = still;
  }

  return { assetIds, failed, stillProcessing: pending.length };
}
