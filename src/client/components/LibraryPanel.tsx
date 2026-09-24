"use client";

import { useMemo, useState } from "react";
import { requestPartUrl } from "@/client/api";
import { startAssetDrag } from "@/client/dragAssets";
import { resolveAssetsNow, useActiveScene, useAssets } from "@/client/stores/assets";
import { useDoc } from "@/client/stores/doc";
import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";
import { useNow } from "@/client/useNow";
import { isoProjectionFromSource } from "@/core/isoMask";
import { describeSettings } from "@/core/describe";
import { faceId, isLibraryVisible, setBadge } from "@/shared/assetSet";
import { folderSwatch, groupByFolder, type FolderSwatch } from "@/shared/folder";
import {
  FOLDER_PEEK,
  flattenLibrary,
  folderIsCollapsed,
  isFailedJob,
  libraryItemMatches,
  libraryItems,
  type LibraryEntry
} from "@/shared/libraryItems";
import { formatElapsed, jobElapsedSeconds } from "@/shared/jobTime";
import type { JobRecord, JobStatus, ResolvedAsset } from "@/shared/model";
import { providerAttachmentPlan } from "@/shared/providerPrompt";
import { isSetAsset } from "@/shared/repeaterMix";
import { AssetThumb } from "./AssetBitmap";
import { ExportDialog } from "./ExportDialog";
import { Button, Panel, Row } from "./ui";

const TITLE_PAD = "pt-4";

const JOB_STATUS_STYLES: Record<JobStatus, string> = {
  queued: "border-slate-600 text-slate-400",
  blocked: "border-slate-700 text-slate-500",
  running: "border-sky-600 text-sky-300",
  done: "border-emerald-700 text-emerald-300",
  error: "border-rose-700 text-rose-300",
  cancelled: "border-slate-700 text-slate-500"
};

function LibraryThumb({
  asset,
  selected,
  selectedAssetIds,
  thumbSize,
  sceneId,
  stageIndex,
  preferSource,
  onClick
}: {
  asset: ResolvedAsset;
  selected: boolean;
  selectedAssetIds: string[];
  thumbSize: number;
  sceneId: string | null;
  stageIndex: number;
  preferSource: boolean;
  onClick: (event: React.MouseEvent, id: string) => void;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) =>
        startAssetDrag(
          event,
          selected && selectedAssetIds.length > 1 ? selectedAssetIds : [asset.id]
        )
      }
      onClick={(event) => onClick(event, asset.id)}
      onDoubleClick={() => {
        if (sceneId) stageMany(sceneId, [asset.id], stageIndex);
      }}
      title={`${asset.label}\n${asset.prompt.body}\n${describeSettings(
        asset.processing,
        { width: asset.sourceWidth, height: asset.sourceHeight },
        []
      )}\n\ndrag onto the scene to stage it, onto a repeater to add it to the mix, or onto the template slot to generate from it`}
      style={{ width: thumbSize }}
      className={`box-content flex shrink-0 flex-col overflow-hidden rounded border text-left transition ${
        selected
          ? "border-[var(--color-accent)] bg-[var(--color-ink-600)]"
          : "border-[var(--color-edge)] hover:border-slate-500"
      }`}
    >
      <AssetThumb asset={asset} size={thumbSize} variant={preferSource ? "source" : "thumb"} />
      <div className="truncate px-1 py-0.5 text-[10px] text-slate-400">
        {asset.set && faceId(asset.set) === asset.id ? `${asset.label} · ${setBadge(asset.set)}` : asset.label}
      </div>
      {asset.exportPath ? <div className="truncate px-1 text-[9px] text-emerald-400">exported</div> : null}
      {asset.rerunOf ? <div className="truncate px-1 text-[9px] text-sky-400">rerun</div> : null}
    </button>
  );
}

function JobThumb({
  job,
  selected,
  thumbSize,
  now,
  projectId,
  onClick
}: {
  job: JobRecord;
  selected: boolean;
  thumbSize: number;
  now: number;
  projectId: string | null;
  onClick: (event: React.MouseEvent, id: string) => void;
}) {
  const elapsed = jobElapsedSeconds(job, now);
  const failed = isFailedJob(job.status);
  const attachments = providerAttachmentPlan({
    prompt: job.prompt,
    composedPrompt: job.composedPrompt,
    generation: job.generation,
    inputs: job.inputs,
    sequencePlan: job.sequencePlan
  });
  const previews =
    projectId && attachments.length > 0
      ? attachments.map((part) => ({
          src: requestPartUrl(projectId, { jobId: job.id }, part.id),
          label: part.label
        }))
      : [];

  return (
    <button
      type="button"
      onClick={(event) => onClick(event, job.id)}
      title={`${job.label}\n${job.status}${job.error ? `\n${job.error}` : ""}\n${job.prompt.body}`}
      style={{ width: thumbSize }}
      className={`box-content flex shrink-0 flex-col overflow-hidden rounded border text-left transition ${
        selected
          ? "border-[var(--color-accent)] bg-[var(--color-ink-600)]"
          : failed
            ? "border-rose-800 hover:border-rose-600"
            : `${JOB_STATUS_STYLES[job.status]} hover:border-slate-500`
      }`}
    >
      <div className="checkerboard relative overflow-hidden" style={{ width: thumbSize, height: thumbSize }}>
        {previews.length > 0 ? (
          <div
            className={`absolute inset-0 grid ${previews.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
          >
            {previews.map((preview) => (
              <img
                key={preview.src}
                src={preview.src}
                alt={preview.label}
                className="h-full w-full object-contain"
              />
            ))}
          </div>
        ) : null}
        <span
          className={`absolute flex items-center justify-center text-[10px] ${JOB_STATUS_STYLES[job.status]} ${
            previews.length > 0
              ? "inset-x-0 bottom-0 bg-black/55 py-0.5"
              : "inset-0"
          }`}
        >
          {job.status}
        </span>
      </div>
      <div className="truncate px-1 py-0.5 text-[10px] text-slate-400">{job.label}</div>
      {elapsed !== null ? (
        <div className="truncate text-[9px] text-slate-500 tabular-nums">{formatElapsed(elapsed)}</div>
      ) : null}
      {job.error ? <div className="truncate text-[9px] text-rose-400">{job.error}</div> : null}
    </button>
  );
}

function FolderToggle({
  collapsed,
  hidden,
  swatch,
  onClick
}: {
  collapsed: boolean;
  hidden: number;
  swatch: FolderSwatch;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={collapsed ? `Show ${hidden} more` : "Collapse folder"}
      onClick={onClick}
      className="flex w-5 shrink-0 flex-col items-center justify-center self-stretch rounded text-[10px] leading-none"
      style={{ color: swatch.label }}
    >
      <span>{collapsed ? "▸" : "▾"}</span>
      {collapsed ? <span className="mt-1 tabular-nums">+{hidden}</span> : null}
    </button>
  );
}

/** One-per-row staging, so dropping ten assets on the canvas is one undo. */
function stageMany(sceneId: string, assetIds: string[], startIndex: number): void {
  const resolved = resolveAssetsNow();

  useDoc.getState().batch(() => {
    for (const [offset, assetId] of assetIds.entries()) {
      const slot = startIndex + offset;
      const asset = resolved.find((entry) => entry.id === assetId);

      useDoc.getState().addItem(sceneId, {
        id: crypto.randomUUID(),
        assetId,
        x: (slot % 6) * 96,
        y: Math.floor(slot / 6) * 96,
        footprint: { width: 0, height: 0 },
        flipHorizontal: false,
        flipVertical: false,
        isoTurn: 0,
        isoProjection: isoProjectionFromSource(useUi.getState().mask?.source),
        showSource: false,
        opacity: 1,
        paused: false,
        sequenceId: "",
        heldFrame: 0,
        rotation: 0,
        display: isSetAsset(asset ?? { sequences: [] }) ? "sheet" : "cell"
      });
    }
  });
}

export function LibraryPanel() {
  const projectId = useServer((state) => state.project?.id ?? null);
  const assets = useAssets();
  const jobs = useServer((state) => state.jobs);
  const selectedIds = useUi((state) => state.selectedIds);
  const busy = useUi((state) => state.busy);
  const scene = useActiveScene();
  const store = useServer.getState;
  const ui = useUi.getState;

  const collapsedFolders = useUi((state) => state.collapsedFolders);

  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [thumbSize, setThumbSize] = useState(88);
  const [exporting, setExporting] = useState(false);

  const visibleAssets = useMemo(
    () => assets.filter((asset) => isLibraryVisible(asset.id, asset.hidden, asset.set)),
    [assets]
  );

  const items = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return libraryItems(visibleAssets, jobs)
      .filter((entry) => (folderFilter ? entry.folder === folderFilter : true))
      .filter((entry) => libraryItemMatches(entry, needle));
  }, [folderFilter, jobs, search, visibleAssets]);

  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const entry of libraryItems(visibleAssets, jobs)) {
      if (entry.folder) set.add(entry.folder);
    }
    return [...set].sort();
  }, [jobs, visibleAssets]);

  const groups = useMemo(() => groupByFolder(items), [items]);
  const cells = useMemo(
    () => flattenLibrary(groups, collapsedFolders, FOLDER_PEEK),
    [collapsedFolders, groups]
  );
  const ordered = useMemo(
    () => cells.filter((cell): cell is { type: "item"; item: LibraryEntry<ResolvedAsset> } => cell.type === "item").map((cell) => cell.item),
    [cells]
  );

  const selectedAssets = useMemo(
    () => visibleAssets.filter((asset) => selectedIds.includes(asset.id)),
    [selectedIds, visibleAssets]
  );
  const failedJobs = useMemo(
    () => jobs.filter((job) => isFailedJob(job.status)),
    [jobs]
  );
  const selectedJob =
    selectedIds.length === 1 ? jobs.find((job) => job.id === selectedIds[0] && job.status !== "done") : undefined;

  const now = useNow(items.some((entry) => entry.kind === "job" && entry.job.status === "running"));

  const onThumbClick = (event: React.MouseEvent, id: string) => {
    const index = ordered.findIndex((entry) => entry.id === id);

    if (event.shiftKey && selectedIds.length > 0) {
      const anchorId = selectedIds[selectedIds.length - 1];
      const anchorIndex = ordered.findIndex((entry) => entry.id === anchorId);

      if (anchorIndex >= 0 && index >= 0) {
        const [from, to] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
        ui().selectMany(ordered.slice(from, to + 1).map((entry) => entry.id));
        return;
      }
    }

    ui().select(id, event.ctrlKey || event.metaKey);
  };

  const thumb = (entry: LibraryEntry<ResolvedAsset>) =>
    entry.kind === "job" ? (
      <JobThumb
        key={entry.id}
        job={entry.job}
        selected={selectedIds.includes(entry.id)}
        thumbSize={thumbSize}
        now={now}
        projectId={projectId}
        onClick={onThumbClick}
      />
    ) : (
      <LibraryThumb
        key={entry.id}
        asset={entry.asset}
        selected={selectedIds.includes(entry.id)}
        selectedAssetIds={selectedAssets.map((asset) => asset.id)}
        thumbSize={thumbSize}
        sceneId={scene?.id ?? null}
        stageIndex={scene?.items.length ?? 0}
        preferSource={entry.id === selectedIds[selectedIds.length - 1]}
        onClick={onThumbClick}
      />
    );

  return (
    <Panel
      title={`Library (${items.length})`}
      pane="library"
      actions={
        <>
          {failedJobs.length > 0 ? (
            <Button
              variant="ghost"
              title="Remove every failed or cancelled job from the library"
              onClick={() => void store().clearFailedJobs()}
            >
              clear failed
            </Button>
          ) : null}
          <Button
            variant="ghost"
            disabled={selectedIds.length !== 1 || busy !== null}
            title="Load this item's prompt, model, templates, and modes into the generate panel"
            onClick={() => {
              const asset = selectedAssets[0];
              if (asset) {
                store().restoreFromAsset(asset);
                return;
              }
              if (selectedJob) {
                store().restoreFromAsset({
                  prompt: selectedJob.prompt,
                  generation: selectedJob.generation,
                  generatedWith: selectedJob.processing,
                  inputs: selectedJob.inputs,
                  sequencePlan: selectedJob.sequencePlan,
                  folder: selectedJob.folder,
                  label: selectedJob.label
                });
              }
            }}
          >
            use setup
          </Button>
          <Button
            variant="primary"
            disabled={selectedAssets.length === 0 || busy !== null}
            title="Queue a fresh generation for each selected asset, reusing its stored prompt and inputs"
            onClick={() => void store().rerunSelected()}
          >
            rerun {selectedAssets.length > 0 ? selectedAssets.length : ""}
          </Button>
        </>
      }
    >
      <Row className="mb-2">
        <input
          type="text"
          placeholder="search name, prompt, tag, error"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Row>

      <Row className="mb-3">
        <select value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)}>
          <option value="">all folders</option>
          {folders.map((folder) => (
            <option key={folder} value={folder}>
              {folder}
            </option>
          ))}
        </select>
        <input
          type="range"
          min={48}
          max={160}
          step={8}
          value={thumbSize}
          onChange={(event) => setThumbSize(Number.parseInt(event.target.value, 10))}
        />
      </Row>

      {selectedIds.length > 0 ? (
        <Row className="mb-2">
          <Button variant="ghost" onClick={() => ui().clearSelection()}>
            clear selection
          </Button>
          <Button
            disabled={!scene || selectedAssets.length === 0}
            onClick={() => {
              if (scene && selectedAssets.length > 0) {
                stageMany(
                  scene.id,
                  selectedAssets.map((asset) => asset.id),
                  scene.items.length
                );
              }
            }}
          >
            stage {selectedAssets.length}
          </Button>
          <Button
            variant="primary"
            disabled={selectedAssets.length === 0}
            title={
              selectedAssets.length === 1
                ? "Download this image"
                : `Download all ${selectedAssets.length} as a zip, packaged in your browser`
            }
            onClick={() => setExporting(true)}
          >
            download {selectedAssets.length}
          </Button>
        </Row>
      ) : null}

      {exporting ? (
        <ExportDialog assets={selectedAssets} onClose={() => setExporting(false)} />
      ) : null}

      {items.length === 0 ? (
        <p className="text-[11px] leading-snug text-slate-500">
          Nothing here yet. Write a prompt and hit Create.
        </p>
      ) : (
        <div className="flex flex-wrap items-start gap-2">
          {groups.map((group) => {
            if (!group.folder) {
              return group.items.map((entry) => (
                <div key={entry.id} className={TITLE_PAD}>
                  {thumb(entry)}
                </div>
              ));
            }

            const overflow = group.items.length > FOLDER_PEEK;
            const collapsed = folderIsCollapsed(
              group.folder,
              group.items.length,
              FOLDER_PEEK,
              collapsedFolders
            );
            const shown = collapsed ? group.items.slice(0, FOLDER_PEEK) : group.items;
            const hidden = group.items.length - shown.length;
            const swatch = folderSwatch(group.folder);

            return (
              <div
                key={group.folder}
                className={collapsed ? undefined : "max-w-full"}
              >
                <button
                  type="button"
                  disabled={!overflow}
                  title={
                    overflow ? (collapsed ? "Expand folder" : "Collapse folder") : undefined
                  }
                  onClick={() => {
                    if (overflow) ui().toggleFolder(group.folder);
                  }}
                  className="mb-0.5 flex max-w-full items-baseline gap-1 px-1 text-left text-[10px] leading-4 disabled:cursor-default"
                  style={{ color: swatch.label }}
                >
                  {overflow ? <span className="w-2.5">{collapsed ? "▸" : "▾"}</span> : null}
                  <span className="min-w-0 truncate font-medium">{group.folder}</span>
                  <span className="shrink-0 opacity-70">{group.items.length}</span>
                </button>
                <div
                  className="flex flex-wrap gap-2 rounded border p-1.5"
                  style={{ background: swatch.fill, borderColor: swatch.stroke }}
                >
                  {shown.map((entry) => thumb(entry))}
                  {overflow ? (
                    <FolderToggle
                      collapsed={collapsed}
                      hidden={hidden}
                      swatch={swatch}
                      onClick={() => ui().toggleFolder(group.folder)}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
