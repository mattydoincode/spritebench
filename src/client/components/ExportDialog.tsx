"use client";

import { useState } from "react";
import {
  EXPORT_KINDS,
  EXPORT_KIND_LABELS,
  downloadAsset,
  isSequenceKind,
  downloadZip,
  zipFilename,
  type ExportKind,
  type ExportProgress
} from "@/client/export";
import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";
import type { ResolvedAsset } from "@/shared/model";
import { Button, Field, Modal, Row, Select } from "./ui";

/**
 * Everything here runs in the browser: originals stream from storage straight
 * to the user, and processed images are encoded from the bitmap the preview
 * worker already computed. The server is not in the path.
 */
export function ExportDialog({
  assets,
  nameOverride,
  onClose
}: {
  assets: ResolvedAsset[];
  nameOverride?: string;
  onClose: () => void;
}) {
  const project = useServer((state) => state.project);

  const [kind, setKind] = useState<ExportKind>("processed");
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [failures, setFailures] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const single = assets.length === 1;
  const rolledOff = assets.filter((asset) => asset.hasSource === false);
  const running = progress !== null;

  // An asset whose original has rolled off can still be processed from its
  // thumbnail, but there is no original left to hand over.
  const animated = assets.filter((asset) => asset.sequences.some((s) => s.frames.length > 0));
  const wantsSequence = isSequenceKind(kind);

  const blocked =
    (kind !== "processed" && rolledOff.length === assets.length && assets.length > 0) ||
    (wantsSequence && animated.length === 0);

  const run = async () => {
    if (!project) return;

    setError(null);
    setFailures([]);
    setProgress({ done: 0, total: assets.length, label: "" });

    const context = { projectId: project.id, projectName: project.name };
    const lookup = (paletteId: string) => useServer.getState().ensurePalette(paletteId);

    try {
      if (single && !wantsSequence) {
        await downloadAsset(context, assets[0], kind, lookup, nameOverride);
        onClose();
        return;
      }

      const result = await downloadZip(
        context,
        assets,
        kind,
        lookup,
        zipFilename(assets.length, kind),
        setProgress
      );

      if (result.failures.length === 0) {
        onClose();
        return;
      }

      setFailures(result.failures);
      useUi
        .getState()
        .setNotice(
          `downloaded ${result.entries} file(s); ${result.failures.length} could not be exported`
        );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setProgress(null);
    }
  };

  return (
    <Modal
      title={single ? "Download image" : `Download ${assets.length} images`}
      onClose={onClose}
      width={460}
    >
      <Field
        label="What to include"
        hint={single ? undefined : `${assets.length} selected`}
      >
        <Select
          value={kind}
          options={EXPORT_KINDS}
          labels={EXPORT_KIND_LABELS}
          onChange={setKind}
          disabled={running}
        />
      </Field>

      <p className="mb-3 text-[10px] leading-snug text-slate-500">
        {kind === "original"
          ? "The image exactly as the model returned it, before any cutout, downsampling or palette work."
          : kind === "processed"
            ? "The image as you see it in the studio, with this asset's saved processing applied."
            : kind === "both"
              ? "Both, in separate folders inside the archive."
              : kind === "sequenceSheet"
                ? "Each animation packed into one PNG on a uniform grid, with a JSON manifest giving every frame's rectangle and duration."
                : "Each animation as a folder of numbered PNGs, with a JSON manifest listing them in order."}
        {single && !wantsSequence ? null : " Packaged as a single zip, built in your browser."}
      </p>

      {wantsSequence ? (
        <p className="mb-3 text-[10px] leading-snug text-amber-400">
          {animated.length === 0
            ? "None of these have an animation yet. Slice one in the inspector first."
            : animated.length < assets.length
              ? `${animated.length} of ${assets.length} have an animation; the rest are skipped.`
              : `${animated.reduce((sum, asset) => sum + asset.sequences.length, 0)} animation(s) across ${animated.length} asset(s).`}
        </p>
      ) : null}

      {rolledOff.length > 0 && kind !== "processed" ? (
        <p className="mb-3 text-[10px] leading-snug text-amber-400">
          {rolledOff.length === assets.length
            ? "The original is no longer stored for these, so only the processed version is available."
            : `${rolledOff.length} of these have had their original rolled off and will be skipped.`}
        </p>
      ) : null}

      {error ? (
        <p className="mb-3 text-[10px] leading-snug text-rose-400">{error}</p>
      ) : null}

      {failures.length > 0 ? (
        <div className="mb-3 max-h-32 overflow-y-auto rounded border border-[#73293c] bg-[#3a1e26] p-2">
          {failures.map((failure) => (
            <p key={failure} className="text-[10px] leading-snug break-all text-rose-300">
              {failure}
            </p>
          ))}
        </div>
      ) : null}

      <Row>
        <Button variant="primary" disabled={running || blocked} onClick={() => void run()}>
          {running
            ? progress.total > 1
              ? `${progress.label === "packaging" ? "packaging" : `${progress.done} of ${progress.total}`}...`
              : "preparing..."
            : single
              ? "download"
              : "download zip"}
        </Button>
        <Button variant="ghost" disabled={running} onClick={onClose}>
          cancel
        </Button>
      </Row>

      {running && progress.total > 1 ? (
        <div className="mt-3 h-1 overflow-hidden rounded bg-[var(--color-ink-600)]">
          <div
            className="h-full bg-[var(--color-accent)] transition-all"
            style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
          />
        </div>
      ) : null}
    </Modal>
  );
}
