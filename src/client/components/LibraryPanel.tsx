"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { requestPartUrl } from "@/client/api";
import { isAssetDrag, readAssetDrag, startAssetDrag } from "@/client/dragAssets";
import { stageAtCamera } from "@/client/stage";
import { useAssets } from "@/client/stores/assets";
import { useDoc } from "@/client/stores/doc";
import { useProjectLoaded, useServer } from "@/client/stores/server";
import { sectionCollapsed, useUi } from "@/client/stores/ui";
import { useNow } from "@/client/useNow";
import { describeSettings } from "@/core/describe";
import { faceId, isLibraryVisible, setBadge } from "@/shared/assetSet";
import { batchSwatch, groupByBatch, type BatchSwatch } from "@/shared/batch";
import {
  BATCH_PEEK,
  batchIsCollapsed,
  flattenLibrary,
  isFailedJob,
  libraryItemMatches,
  libraryItems,
  type LibraryEntry
} from "@/shared/libraryItems";
import { formatElapsed, jobElapsedSeconds } from "@/shared/jobTime";
import type { JobRecord, JobStatus, ResolvedAsset } from "@/shared/model";
import { providerAttachmentPlan } from "@/shared/providerPrompt";
import { AssetThumb } from "./AssetBitmap";
import { Button, ConfirmTextButton, Panel, Skeleton, TextButton } from "./ui";

/**
 * A batch is a label row (16px plus a 2px gap) above a tinted box whose
 * border and padding add 14px around its thumbs. An image outside any batch
 * leaves the label row blank and fills the box's height instead, so its top
 * lines up with the tint and a lone image reads as one bigger thing rather
 * than a group of one.
 */
const BATCH_LABEL = "pt-[18px]";
const BATCH_BOX = 14;

const JOB_STATUS_STYLES: Record<JobStatus, string> = {
  queued: "border-slate-600 text-slate-400",
  blocked: "border-slate-700 text-slate-500",
  running: "border-sky-600 text-sky-300",
  done: "border-emerald-700 text-emerald-300",
  error: "border-rose-700 text-rose-300",
  cancelled: "border-slate-700 text-slate-500"
};

const THUMB_ICONS = {
  // A gamepad: this image is wired into the game.
  godot: "M4 5.5h8a2.5 2.5 0 0 1 2.4 3.2l-.9 3a1.6 1.6 0 0 1-2.7.6L9.6 11H6.4l-1.2 1.3a1.6 1.6 0 0 1-2.7-.6l-.9-3A2.5 2.5 0 0 1 4 5.5ZM5 7.5v2M4 8.5h2M10.5 8h.01M11.8 9.2h.01",
  // A cloud: a processed copy is stored server-side.
  saved: "M5 12.5h6.5a2.5 2.5 0 0 0 .3-5A3.5 3.5 0 0 0 5 6.6a3 3 0 0 0 0 5.9Z",
  // Circling arrow: generated again from an earlier image.
  rerun: "M12.5 8a4.5 4.5 0 1 1-1.3-3.2M12.5 3v2.5H10",
  // A person: someone's own image, uploaded rather than generated.
  uploaded: "M8 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM3 13.5c.6-2.3 2.6-3.8 5-3.8s4.4 1.5 5 3.8"
} as const;

/** A small icon over a thumb's corner. Hover says what it means. */
function ThumbIcon({ icon, tone, title }: { icon: keyof typeof THUMB_ICONS; tone: string; title: string }) {
  return (
    <span title={title} className={`flex h-4 w-4 items-center justify-center rounded bg-black/70 ${tone}`}>
      <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3">
        <path
          d={THUMB_ICONS[icon]}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="sr-only">{title}</span>
    </span>
  );
}

function LibraryThumb({
  asset,
  selected,
  selectedAssetIds,
  thumbSize,
  preferSource,
  reveal,
  godotSlots,
  onClick
}: {
  asset: ResolvedAsset;
  /** Labels of the Godot slots this image is assigned to. */
  godotSlots: string[];
  selected: boolean;
  selectedAssetIds: string[];
  thumbSize: number;
  preferSource: boolean;
  /** Scroll into view: selection arrived from another panel. */
  reveal: boolean;
  onClick: (event: React.MouseEvent, id: string) => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (reveal) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [reveal]);

  return (
    <button
      ref={ref}
      type="button"
      draggable
      onDragStart={(event) =>
        startAssetDrag(
          event,
          selected && selectedAssetIds.length > 1 ? selectedAssetIds : [asset.id]
        )
      }
      onClick={(event) => onClick(event, asset.id)}
      onDoubleClick={() => stageAtCamera([asset.id])}
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
      <div className="relative">
        <AssetThumb asset={asset} size={thumbSize} variant={preferSource ? "source" : "thumb"} />
        {/* On the image, like the frame count, so every thumb is the same height. */}
        {godotSlots.length > 0 || asset.exportPath || asset.rerunOf || asset.origin === "uploaded" ? (
          <span className="absolute top-0.5 left-0.5 flex gap-0.5">
            {asset.origin === "uploaded" ? (
              <ThumbIcon icon="uploaded" tone="text-amber-200" title="Uploaded by a person, not generated" />
            ) : null}
            {godotSlots.length > 0 ? (
              <ThumbIcon
                icon="godot"
                tone="text-violet-300"
                title={`In Godot: assigned to ${godotSlots.join(", ")}`}
              />
            ) : null}
            {asset.exportPath ? (
              <ThumbIcon
                icon="saved"
                tone="text-emerald-300"
                title={`Processed copy saved to storage (${asset.exportPath}). Made when this is sent to Godot, or from the inspector.`}
              />
            ) : null}
            {asset.rerunOf ? (
              <ThumbIcon icon="rerun" tone="text-sky-300" title="A rerun of an earlier image" />
            ) : null}
          </span>
        ) : null}
      </div>
      <div className="truncate px-1 py-0.5 text-[10px] text-slate-400">
        {asset.set && faceId(asset.set) === asset.id ? `${asset.label} · ${setBadge(asset.set)}` : asset.label}
      </div>
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

function BatchToggle({
  collapsed,
  hidden,
  swatch,
  onClick
}: {
  collapsed: boolean;
  hidden: number;
  swatch: BatchSwatch;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={collapsed ? `Show ${hidden} more` : "Collapse batch"}
      onClick={onClick}
      className="flex w-5 shrink-0 flex-col items-center justify-center self-stretch rounded text-[10px] leading-none"
      style={{ color: swatch.label }}
    >
      <span>{collapsed ? "▸" : "▾"}</span>
      {collapsed ? <span className="mt-1 tabular-nums">+{hidden}</span> : null}
    </button>
  );
}

type Entry = LibraryEntry<ResolvedAsset>;

const UNFILED = "unfiled";
const NO_SLOTS: string[] = [];

/** Asset ids in a set of entries; running jobs have none yet. */
function assetIdsOf(entries: Entry[]): string[] {
  return entries.filter((entry) => entry.kind === "asset").map((entry) => entry.id);
}

/**
 * One folder's images: its batches as tinted groups (dragged by their label
 * to move the whole batch), then its loose images.
 */
function FolderContents({
  entries,
  thumb,
  thumbSize
}: {
  entries: Entry[];
  thumb: (entry: Entry, size?: number) => React.ReactNode;
  thumbSize: number;
}) {
  const collapsedBatches = useUi((state) => state.collapsedBatches);
  const ui = useUi.getState;

  if (entries.length === 0) {
    return <p className="text-[11px] text-slate-500">Empty. Drag images or batches here.</p>;
  }

  return (
    <div className="flex flex-wrap items-start gap-2">
      {groupByBatch(entries).map((group) => {
        if (!group.batch) {
          return group.items.map((entry) => (
            <div key={entry.id} className={BATCH_LABEL}>
              {thumb(entry, thumbSize + BATCH_BOX)}
            </div>
          ));
        }

        const overflow = group.items.length > BATCH_PEEK;
        const collapsed = batchIsCollapsed(group.batch, group.items.length, BATCH_PEEK, collapsedBatches);
        const shown = collapsed ? group.items.slice(0, BATCH_PEEK) : group.items;
        const hidden = group.items.length - shown.length;
        const swatch = batchSwatch(group.batch);

        return (
          <div key={group.batch} className={collapsed ? undefined : "max-w-full"}>
            <div
              draggable
              onDragStart={(event) => startAssetDrag(event, assetIdsOf(group.items))}
              title="Drag to move the whole batch to another folder"
              className="mb-0.5 flex max-w-full cursor-grab items-baseline gap-1 px-1 text-[10px] leading-4"
              style={{ color: swatch.label }}
            >
              {overflow ? (
                <button
                  type="button"
                  className="w-2.5"
                  title={collapsed ? "Expand batch" : "Collapse batch"}
                  onClick={() => ui().toggleBatch(group.batch)}
                >
                  {collapsed ? "\u25b8" : "\u25be"}
                </button>
              ) : null}
              <span className="min-w-0 truncate font-medium">{group.batch}</span>
              <span className="shrink-0 opacity-70">{group.items.length}</span>
            </div>
            <div
              className="flex flex-wrap gap-2 rounded border p-1.5"
              style={{ background: swatch.fill, borderColor: swatch.stroke }}
            >
              {shown.map((entry) => thumb(entry))}
              {overflow ? (
                <BatchToggle
                  collapsed={collapsed}
                  hidden={hidden}
                  swatch={swatch}
                  onClick={() => ui().toggleBatch(group.batch)}
                />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * A folder across the full width of the library: a sticky heading bar, like
 * a panel section, that images and batches can be dropped on. No Folder is the
 * same thing without rename or delete.
 */
function FolderSection({
  id,
  name,
  entries,
  thumb,
  thumbSize
}: {
  /** A folder id, or `UNFILED`. */
  id: string;
  name: string;
  entries: Entry[];
  thumb: (entry: Entry, size?: number) => React.ReactNode;
  thumbSize: number;
}) {
  const sectionId = `library.folder.${id}`;
  const collapsed = useUi((state) => sectionCollapsed(sectionId, state.collapsedSections));
  const [over, setOver] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const real = id !== UNFILED;

  const rename = () => {
    if (renaming !== null) useDoc.getState().renameFolder(id, renaming);
    setRenaming(null);
  };

  return (
    <section
      onDragOver={(event) => {
        if (!isAssetDrag(event) && !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        setOver(false);
        // Files from the computer: upload them straight into this folder.
        const files = [...event.dataTransfer.files];
        if (files.length > 0) {
          event.preventDefault();
          void useServer.getState().uploadImages(files, real ? id : "");
          return;
        }
        const ids = readAssetDrag(event);
        if (ids.length === 0) return;
        event.preventDefault();
        useDoc.getState().moveToFolder(ids, real ? id : "");
      }}
      className={`-mx-3 border-t border-[var(--color-edge)] last:border-b ${
        over ? "bg-[var(--color-accent-dim)]/20" : ""
      }`}
    >
      <div
        className={`group sticky -top-3 z-10 flex h-8 items-center gap-2 px-3 transition-colors ${
          over ? "bg-[var(--color-accent-dim)]/60" : "bg-[var(--color-ink-800)]"
        }`}
      >
        <button
          type="button"
          aria-expanded={!collapsed}
          title={collapsed ? `Show ${name}` : `Hide ${name}`}
          onClick={() => useUi.getState().toggleSection(sectionId)}
          className="flex min-w-0 flex-1 items-center gap-2 self-stretch"
        >
          <svg
            aria-hidden
            viewBox="0 0 10 10"
            className={`h-2.5 w-2.5 shrink-0 text-slate-400 transition-transform ${collapsed ? "" : "rotate-90"}`}
          >
            <path d="M3 1.5 6.5 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          {renaming === null ? (
            <span
              className={`truncate text-[11px] font-semibold tracking-wider uppercase ${
                real ? "text-slate-200" : "text-slate-400"
              }`}
              onDoubleClick={(event) => {
                if (!real) return;
                event.stopPropagation();
                setRenaming(name);
              }}
              title={real ? "Double-click to rename" : undefined}
            >
              {name}
            </span>
          ) : null}
          {renaming === null ? (
            <span className="shrink-0 text-[10px] text-slate-500 tabular-nums">{entries.length}</span>
          ) : null}
        </button>
        {renaming !== null ? (
          <input
            autoFocus
            value={renaming}
            className="min-w-0 flex-1 text-[11px]"
            onChange={(event) => setRenaming(event.target.value)}
            onBlur={rename}
            onKeyDown={(event) => {
              if (event.key === "Enter") rename();
              if (event.key === "Escape") setRenaming(null);
            }}
          />
        ) : null}
        {real && renaming === null ? (
          <ConfirmTextButton
            title="Delete this folder. Its images move to No Folder."
            onConfirm={() => useDoc.getState().deleteFolder(id)}
          >
            &times;
          </ConfirmTextButton>
        ) : null}
      </div>
      {collapsed ? null : (
        <div className="px-3 pt-2.5 pb-3">
          <FolderContents entries={entries} thumb={thumb} thumbSize={thumbSize} />
        </div>
      )}
    </section>
  );
}

/** Picks image files from the computer and uploads them into the folder in view. */
function UploadButton({ folderId }: { folderId: string }) {
  const input = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <TextButton
        title="Upload your own images (or drop files onto a folder)"
        onClick={() => input.current?.click()}
      >
        upload
      </TextButton>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          void useServer.getState().uploadImages(files, folderId);
        }}
      />
    </>
  );
}

/** "+ folder", then a name box in its place. */
function NewFolderButton() {
  const [naming, setNaming] = useState<string | null>(null);

  const create = () => {
    if (naming) useDoc.getState().createFolder(naming);
    setNaming(null);
  };

  if (naming === null) {
    return (
      <TextButton title="Make a folder to sort images into" onClick={() => setNaming("")}>
        + folder
      </TextButton>
    );
  }

  return (
    <input
      autoFocus
      value={naming}
      placeholder="folder name"
      style={{ width: "9rem" }}
      className="text-[11px]"
      onChange={(event) => setNaming(event.target.value)}
      onBlur={create}
      onKeyDown={(event) => {
        if (event.key === "Enter") create();
        if (event.key === "Escape") setNaming(null);
      }}
    />
  );
}

export function LibraryPanel() {
  const projectId = useServer((state) => state.project?.id ?? null);
  const loaded = useProjectLoaded();
  const assets = useAssets();
  const jobs = useServer((state) => state.jobs);
  const folders = useDoc((state) => state.folders);
  const slots = useServer((state) => state.slots);
  const selectedIds = useUi((state) => state.selectedIds);
  const filter = useUi((state) => state.libraryFolder);
  const collapsedBatches = useUi((state) => state.collapsedBatches);
  const store = useServer.getState;
  const ui = useUi.getState;

  const [search, setSearch] = useState("");
  const [thumbSize, setThumbSize] = useState(88);

  const visibleAssets = useMemo(
    () => assets.filter((asset) => isLibraryVisible(asset.id, asset.hidden, asset.set)),
    [assets]
  );

  const known = useMemo(() => new Set(folders.map((entry) => entry.id)), [folders]);

  const godotSlots = useMemo(() => {
    const byAsset = new Map<string, string[]>();
    for (const slot of slots) {
      for (const id of slot.assignedAssetIds) {
        byAsset.set(id, [...(byAsset.get(id) ?? []), slot.label || "a slot"]);
      }
    }
    return byAsset;
  }, [slots]);
  // A folder id that no longer resolves (the folder was deleted) reads as unfiled.
  const folderOf = (entry: Entry) => (known.has(entry.folderId) ? entry.folderId : UNFILED);

  const items = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const jobFolder = (jobId: string) => useDoc.getState().jobFolderOf(jobId);
    return libraryItems(visibleAssets, jobs, jobFolder).filter((entry) =>
      libraryItemMatches(entry, needle)
    );
  }, [jobs, search, visibleAssets]);

  const activeFilter = filter === UNFILED || known.has(filter) ? filter : "";

  // Folder sections in name order, No Folder last; only the filtered one when filtered.
  const sections = useMemo(() => {
    const byFolder = new Map<string, Entry[]>();
    for (const entry of items) {
      const key = folderOf(entry);
      byFolder.set(key, [...(byFolder.get(key) ?? []), entry]);
    }

    const all = [
      ...folders.map((entry) => ({ id: entry.id, name: entry.name, entries: byFolder.get(entry.id) ?? [] })),
      { id: UNFILED, name: "No Folder", entries: byFolder.get(UNFILED) ?? [] }
    ];

    // No Folder always shows, even empty, so there is somewhere to drag images back to.
    return activeFilter ? all.filter((section) => section.id === activeFilter) : all;
  }, [activeFilter, folders, items, known]);

  // Shift-click ranges follow what is on screen, section by section.
  const ordered = useMemo(
    () =>
      sections.flatMap((section) =>
        flattenLibrary(groupByBatch(section.entries), collapsedBatches, BATCH_PEEK)
          .filter((cell): cell is { type: "item"; item: Entry } => cell.type === "item")
          .map((cell) => cell.item)
      ),
    [collapsedBatches, sections]
  );

  const selectedAssets = useMemo(
    () => visibleAssets.filter((asset) => selectedIds.includes(asset.id)),
    [selectedIds, visibleAssets]
  );
  const failedJobs = useMemo(
    () => jobs.filter((job) => isFailedJob(job.status)),
    [jobs]
  );

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

  const thumb = (entry: Entry, size = thumbSize) =>
    entry.kind === "job" ? (
      <JobThumb
        key={entry.id}
        job={entry.job}
        selected={selectedIds.includes(entry.id)}
        thumbSize={size}
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
        thumbSize={size}
        preferSource={entry.id === selectedIds[selectedIds.length - 1]}
        reveal={entry.id === selectedIds[0]}
        godotSlots={godotSlots.get(entry.id) ?? NO_SLOTS}
        onClick={onThumbClick}
      />
    );

  const toolbar = (
    <>
      <input
        type="text"
        placeholder="search"
        title="Search name, prompt, tag, error"
        value={search}
        style={{ width: "auto", flex: "1 1 10rem", minWidth: "5rem", maxWidth: "10rem" }}
        onChange={(event) => setSearch(event.target.value)}
      />
      <select
        value={activeFilter}
        title="Show one folder. New images go to the folder you are looking at."
        style={{ width: "auto", maxWidth: "10rem" }}
        onChange={(event) => ui().setLibraryFolder(event.target.value)}
      >
        <option value="">All folders</option>
        {folders.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
        <option value={UNFILED}>No Folder</option>
      </select>
      <NewFolderButton />
      <UploadButton folderId={activeFilter && activeFilter !== UNFILED ? activeFilter : ""} />
    </>
  );

  return (
    // A size container, so the toolbar follows the panel's width, not the window's.
    <div className="@container relative h-full">
      <Panel
        title="Library"
        count={loaded ? items.length : undefined}
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
            <div className="hidden min-w-0 items-center gap-1 @min-[30rem]:flex">{toolbar}</div>
          </>
        }
      >
        {/* The same controls, on their own row once the header is too narrow. */}
        <div className="mb-3 flex items-center gap-1 @min-[30rem]:hidden">{toolbar}</div>
        {!loaded ? (
          <div className="flex flex-wrap items-start gap-2">
            {Array.from({ length: 12 }, (_, index) => (
              <Skeleton
                key={index}
                className="shrink-0"
                style={{ width: thumbSize, height: thumbSize }}
              />
            ))}
          </div>
        ) : items.length === 0 && folders.length === 0 ? (
          <p className="text-[11px] leading-snug text-slate-500">
            Nothing here yet. Write a prompt and hit Generate.
          </p>
        ) : (
          // Room under the last row for the floating zoom control.
          <div className="pb-10">
            {sections.map((section) => (
              <FolderSection
                key={section.id}
                id={section.id}
                name={section.name}
                entries={section.entries}
                thumb={thumb}
                thumbSize={thumbSize}
              />
            ))}
          </div>
        )}
    </Panel>

      {/* Floats over the corner of the library rather than taking a row. */}
      <div className="absolute right-3 bottom-3 z-20 flex w-[30%] min-w-28 items-center gap-2 rounded border border-[var(--color-edge)] bg-[var(--color-ink-800)]/90 px-2 py-1 shadow-lg backdrop-blur">
        <span aria-hidden className="text-[10px] text-slate-500">
          −
        </span>
        <input
          type="range"
          min={48}
          max={160}
          step={8}
          value={thumbSize}
          title="Thumbnail size"
          onChange={(event) => setThumbSize(Number.parseInt(event.target.value, 10))}
        />
        <span aria-hidden className="text-[10px] text-slate-500">
          +
        </span>
      </div>
    </div>
  );
}
