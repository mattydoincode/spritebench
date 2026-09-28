"use client";

import { create } from "zustand";
import type { UploadPlaceholder } from "@/shared/libraryItems";

/**
 * Files on their way into the library, drawn as placeholder tiles the way a
 * running generation is. Client-only: nothing here survives a reload, and the
 * worker carries on with anything already sent.
 */
interface UploadsState {
  uploads: UploadPlaceholder[];
  add: (files: { id: string; file: File }[], folderId: string) => void;
  update: (id: string, patch: Partial<Omit<UploadPlaceholder, "id">>) => void;
  remove: (ids: string[]) => void;
}

/** How long a refused upload stays on screen saying why. */
const FAILED_LINGER_MS = 8000;

export const useUploads = create<UploadsState>((set, get) => ({
  uploads: [],

  add(files, folderId) {
    const createdAt = new Date().toISOString();
    set({
      uploads: [
        ...files.map(({ id, file }) => ({
          id,
          name: file.name,
          folderId,
          createdAt,
          phase: "waiting" as const,
          progress: 0,
          previewUrl: URL.createObjectURL(file)
        })),
        ...get().uploads
      ]
    });
  },

  update(id, patch) {
    set({
      uploads: get().uploads.map((upload) => (upload.id === id ? { ...upload, ...patch } : upload))
    });
    if (patch.phase === "failed") setTimeout(() => get().remove([id]), FAILED_LINGER_MS);
  },

  remove(ids) {
    const gone = new Set(ids);
    for (const upload of get().uploads) {
      if (gone.has(upload.id)) URL.revokeObjectURL(upload.previewUrl);
    }
    set({ uploads: get().uploads.filter((upload) => !gone.has(upload.id)) });
  }
}));
