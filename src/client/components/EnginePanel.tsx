"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { isAssetDrag, readAssetDrag } from "@/client/dragAssets";
import { useActiveScene, useAssets } from "@/client/stores/assets";
import { useDoc } from "@/client/stores/doc";
import { useProjectLoaded, useServer } from "@/client/stores/server";
import { ENGINE_THUMB_MAX, ENGINE_THUMB_MIN, useUi } from "@/client/stores/ui";
import { describeSlotActivity } from "@/shared/assignStream";
import { faceId, setBadge } from "@/shared/assetSet";
import { describeShipment } from "@/shared/engineBundle";
import {
  ENGINE_LANES,
  laneAssetIds,
  laneFingerprintKey,
  laneKey,
  laneRemoteHash,
  parseLaneKey,
  type EngineSlotIntent,
  type EngineSlotRecord,
  type EngineSlotStatus
} from "@/shared/engineSlot";
import { slotExportFingerprint } from "@/shared/exportFingerprint";
import type { ResolvedAsset } from "@/shared/model";
import type { SlotEdit } from "@/shared/slotEdits";
import { AssetThumb } from "./AssetBitmap";
import { EngineCollections } from "./EngineCollections";
import { LeftTabs } from "./LeftTabs";
import { Button, Panel, PanelTab, Skeleton, TextButton } from "./ui";

const STATUS_LABEL: Record<EngineSlotStatus, string> = {
  empty: "empty",
  in_sync: "in sync",
  pull_available: "pull available",
  edited_in_godot: "edited in Godot",
  conflict: "conflict"
};

const STATUS_TONE: Record<EngineSlotStatus, string> = {
  empty: "text-slate-500",
  in_sync: "text-emerald-400",
  pull_available: "text-sky-400",
  edited_in_godot: "text-amber-400",
  conflict: "text-rose-400"
};

const INTENT_LABEL: Record<EngineSlotIntent, string> = {
  texture: "still",
  sprite_frames: "clips",
  textures: "array"
};

function assignedLabel(asset: ResolvedAsset | undefined, fallback: string): string {
  if (!asset) return fallback;
  if (asset.set && faceId(asset.set) === asset.id) return `${asset.label} · ${setBadge(asset.set)}`;
  return asset.label;
}

function AssignedList({
  slot,
  assets,
  highlight,
  canEdit
}: {
  slot: EngineSlotRecord;
  assets: ResolvedAsset[];
  highlight: ReadonlySet<string>;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const thumb = useUi((state) => state.engineThumbSize);
  const lane = useUi((state) => state.gameAssetLane);
  const ids = laneAssetIds(slot, lane);
  const array = slot.intent === "textures";

  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const shipment = describeShipment(
    slot.intent ?? "texture",
    ids.map((id) => byId.get(id)).filter((asset): asset is ResolvedAsset => Boolean(asset))
  );

  const summary =
    ids.length === 0
      ? lane === "final"
        ? slot.assignedAssetIds.length > 0
          ? "no final yet · the prototype ships until there is one"
          : "no final yet"
        : `no prototype assigned · will ship ${INTENT_LABEL[slot.intent ?? "texture"]}`
      : ids.length === 1
        ? `assigned ${assignedLabel(byId.get(ids[0]), ids[0].slice(0, 8))} · ${shipment}`
        : `assigned ${ids.length} assets · ${shipment}`;

  const edit = (change: SlotEdit) => void useServer.getState().editSlot(slot.id, change);

  if (ids.length === 0) {
    return <p className="mt-1 text-[10px] text-slate-600">{summary}</p>;
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={open}
        title={open ? "Hide assigned images" : "Show assigned images"}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1 text-left text-[10px] text-slate-400 hover:text-slate-200"
      >
        <span aria-hidden className="w-2.5 shrink-0">
          {open ? "\u25be" : "\u25b8"}
        </span>
        <span className="min-w-0 truncate">{summary}</span>
      </button>

      {open ? (
        <ul className="mt-1.5 flex flex-col gap-1">
          {ids.map((id, index) => {
            const asset = byId.get(id);
            return (
              <li
                key={`${id}-${index}`}
                className={`flex items-center gap-1.5 rounded border bg-[var(--color-ink-900)] px-1 py-1 ${
                  highlight.has(id) ? "border-[var(--color-accent)]" : "border-[var(--color-edge)]"
                }`}
              >
                <button
                  type="button"
                  title={assignedLabel(asset, id)}
                  onClick={() => useUi.getState().select(id, false)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  {asset ? (
                    <AssetThumb asset={asset} size={thumb} />
                  ) : (
                    <div
                      className="checkerboard shrink-0 rounded"
                      style={{ width: thumb, height: thumb }}
                    />
                  )}
                  <span className="min-w-0">
                    <span className="block font-mono text-[10px] text-slate-500">
                      {String(index).padStart(2, "0")}
                    </span>
                    <span className="block truncate text-[10px] text-slate-300">
                      {assignedLabel(asset, id.slice(0, 8))}
                    </span>
                  </span>
                </button>
                {canEdit && array && ids.length > 1 ? (
                  <span className="flex shrink-0 flex-col">
                    <TextButton
                      disabled={index === 0}
                      title="Move earlier in the Godot array"
                      onClick={() => edit({ type: "move", assetId: id, delta: -1 })}
                    >
                      {"\u25b4"}
                    </TextButton>
                    <TextButton
                      disabled={index === ids.length - 1}
                      title="Move later in the Godot array"
                      onClick={() => edit({ type: "move", assetId: id, delta: 1 })}
                    >
                      {"\u25be"}
                    </TextButton>
                  </span>
                ) : null}
                {canEdit ? (
                  <TextButton
                    danger
                    title={array ? "Remove from this Godot array" : "Unassign from this slot"}
                    onClick={() => edit({ type: "drop", assetIds: [id] })}
                  >
                    remove
                  </TextButton>
                ) : null}
              </li>
            );
          })}
          {canEdit && array && ids.length > 1 ? (
            <li className="flex justify-end">
              <TextButton
                danger
                title="Remove every assigned image"
                onClick={() => edit({ type: "replace", assetIds: [] })}
              >
                clear all
              </TextButton>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Slots whose images have been edited since they were last sent to Godot.
 *
 * A slot with no fingerprint on record (exported before fingerprints existed)
 * is taken to match what its images look like now, and that is recorded, so
 * edits from here on are caught.
 */
function useChangedSlots(slots: EngineSlotRecord[], canEdit: boolean): string[] {
  const edits = useDoc((state) => state.edits);
  const exported = useDoc((state) => state.slotExports);
  const docReady = useDoc((state) => state.ready);
  const loaded = useProjectLoaded();

  // Every (slot, lane) with exported art: both lanes can fall behind.
  const live = useMemo(
    () =>
      slots.flatMap((slot) =>
        ENGINE_LANES.filter(
          (lane) => laneRemoteHash(slot, lane) && laneAssetIds(slot, lane).length > 0
        ).map((lane) => ({ slot, lane, ids: laneAssetIds(slot, lane) }))
      ),
    [slots]
  );

  useEffect(() => {
    if (!canEdit || !docReady || !loaded) return;
    for (const { slot, lane, ids } of live) {
      const key = laneFingerprintKey(slot.id, lane);
      if (exported[key] === undefined) {
        useDoc.getState().setSlotExport(key, slotExportFingerprint(ids, edits));
      }
    }
  }, [canEdit, docReady, edits, exported, live, loaded]);

  return useMemo(
    () =>
      live
        .filter(({ slot, lane, ids }) => {
          const recorded = exported[laneFingerprintKey(slot.id, lane)];
          return recorded !== undefined && recorded !== slotExportFingerprint(ids, edits);
        })
        .map(({ slot, lane }) => laneKey(slot.id, lane)),
    [edits, exported, live]
  );
}

/**
 * Amber while slots have edits Godot does not have; blue with a progress bar
 * once sync is pressed, filling as each slot's export finishes.
 */
function SyncBanner({ changed, canEdit }: { changed: string[]; canEdit: boolean }) {
  const [run, setRun] = useState<{ total: number; done: number } | null>(null);

  const sync = () => {
    if (run || changed.length === 0) return;
    const ids = [...changed];
    setRun({ total: ids.length, done: 0 });

    const server = useServer.getState();
    void Promise.all(
      ids.map((key) =>
        server
          .editSlot(parseLaneKey(key).slotId, { type: "refresh" }, parseLaneKey(key).lane)
          .finally(() => setRun((current) => (current ? { ...current, done: current.done + 1 } : current)))
      )
    ).finally(() => setRun(null));
  };

  if (run) {
    const percent = run.total > 0 ? Math.round((run.done / run.total) * 100) : 0;
    return (
      <div className="mb-2 rounded border border-sky-700/60 bg-sky-950/40 px-2 py-1.5 text-[11px] text-sky-200">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span>
            Syncing {Math.min(run.done + 1, run.total)} of {run.total} {run.total === 1 ? "slot" : "slots"}…
          </span>
          <span className="tabular-nums text-sky-300/80">{percent}%</span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={run.total}
          aria-valuenow={run.done}
          className="h-1 overflow-hidden rounded bg-sky-900/60"
        >
          <div className="h-full bg-sky-400 transition-[width] duration-300" style={{ width: `${percent}%` }} />
        </div>
      </div>
    );
  }

  if (changed.length === 0) return null;

  return (
    <div className="mb-2 flex items-center gap-2 rounded border border-amber-700/60 bg-amber-950/30 px-2 py-1.5 text-[11px] text-amber-200">
      <span className="min-w-0 flex-1">
        {changed.length === 1 ? "1 slot has" : `${changed.length} slots have`} edits Godot does not
        have yet
      </span>
      {canEdit ? (
        <Button
          variant="primary"
          title="Send the latest version of every changed image to Godot"
          onClick={sync}
        >
          sync
        </Button>
      ) : null}
    </div>
  );
}

function SlotRow({
  slot,
  highlight,
  canEdit,
  changed,
  assets
}: {
  slot: EngineSlotRecord;
  /** Its images were edited after it was last sent to Godot. */
  changed: boolean;
  highlight: ReadonlySet<string>;
  canEdit: boolean;
  assets: ResolvedAsset[];
}) {
  const assigning = useUi((state) => state.assigning[slot.id] ?? null);
  const queued = useUi((state) => state.assignQueued[slot.id] ?? 0);
  const active = Boolean(assigning) || queued > 0;
  const [dragOver, setDragOver] = useState(false);
  const lane = useUi((state) => state.gameAssetLane);
  const ids = laneAssetIds(slot, lane);
  const lit = ids.some((id) => highlight.has(id));

  const accept = (event: DragEvent) => canEdit && isAssetDrag(event);

  return (
    <li
      onDragEnter={(event) => {
        if (!accept(event)) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragOver={(event) => {
        if (!accept(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragOver(false);
      }}
      onDrop={(event) => {
        if (!accept(event)) return;
        event.preventDefault();
        setDragOver(false);
        const assetIds = readAssetDrag(event);
        if (assetIds.length > 0) void useServer.getState().assignSlot(slot.id, assetIds);
      }}
      className={`rounded border bg-[var(--color-ink-800)] px-2.5 py-2 ${
        assigning
          ? "border-sky-500"
          : dragOver
            ? "border-[var(--color-accent)] border-dashed"
            : lit
              ? "border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]"
              : "border-[var(--color-edge)]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          title={
            ids.length > 0
              ? "Select this slot's art in the library"
              : "Drag library assets here to assign them"
          }
          onClick={() => {
            if (ids.length > 0) {
              useUi.getState().selectMany(ids);
            }
          }}
          className="min-w-0 text-left"
        >
          <p className="truncate text-[12px] text-slate-200">
            {slot.label}
            {slot.finalAssetIds.length > 0 ? (
              <span
                title="This slot has final art"
                className="ml-1.5 rounded bg-emerald-900/50 px-1 align-middle text-[9px] text-emerald-200"
              >
                final
              </span>
            ) : null}
          </p>
          <p className="truncate font-mono text-[10px] text-slate-500">
            {INTENT_LABEL[slot.intent ?? "texture"]} · {slot.godotPath || slot.id}
          </p>
        </button>
        <span
          title={
            changed && !active
              ? "Edited in the studio since it was sent to Godot. Sync to send the new version."
              : undefined
          }
          className={`shrink-0 text-[10px] ${
            active
              ? "text-sky-400"
              : changed
                ? "text-amber-300 uppercase"
                : `uppercase ${STATUS_TONE[slot.status]}`
          }`}
        >
          {active ? describeSlotActivity(assigning, queued) : changed ? "changed" : STATUS_LABEL[slot.status]}
        </span>
        {canEdit && !active && ids.length > 0 ? (
          <TextButton
            className="shrink-0"
            title="Render this slot's images again from their current edits and send them to Godot"
            onClick={() => void useServer.getState().syncSlots([laneKey(slot.id, lane)])}
          >
            resend
          </TextButton>
        ) : null}
      </div>

      {assigning ? (
        <div className="mt-1.5 h-0.5 overflow-hidden rounded bg-slate-800">
          <div
            className="h-full bg-sky-400 transition-[width]"
            style={{
              width:
                assigning.assetIds.length === 0
                  ? "0%"
                  : `${(assigning.completedIds.length / assigning.assetIds.length) * 100}%`
            }}
          />
        </div>
      ) : null}

      <AssignedList slot={slot} assets={assets} highlight={highlight} canEdit={canEdit} />

      {slot.status === "edited_in_godot" ? (
        <p className="mt-1 text-[10px] text-amber-400">
          The file was edited in Godot. Assigning again overwrites it.
        </p>
      ) : null}

      {slot.status === "conflict" ? (
        <p className="mt-1 text-[10px] text-rose-400">
          Both sides changed. Assign to overwrite the Godot file.
        </p>
      ) : null}

    </li>
  );
}

/**
 * Assets to light up here: whatever is selected in the library, plus the art
 * behind any objects selected in the scene.
 */
function useHighlightedAssets(): ReadonlySet<string> {
  const selectedIds = useUi((state) => state.selectedIds);
  const selectedItemIds = useUi((state) => state.selectedItemIds);
  const activeItemId = useUi((state) => state.activeItemId);
  const scene = useActiveScene();

  return useMemo(() => {
    const ids = new Set(selectedIds);
    const items = new Set(selectedItemIds);
    if (activeItemId) items.add(activeItemId);
    for (const item of scene?.items ?? []) {
      if (items.has(item.id)) ids.add(item.assetId);
    }
    return ids;
  }, [selectedIds, selectedItemIds, activeItemId, scene]);
}

/** Until there is a release page, the addon's repository. */
const GODOT_PLUGIN_URL = "https://github.com/mattydoincode/spritebench-godot";

export function EnginePanel() {
  const allSlots = useServer((state) => state.slots);
  const collections = useServer((state) => state.collections);
  const project = useServer((state) => state.project);
  const engineSyncedAt = useServer((state) => state.engineSyncedAt);
  const loaded = useProjectLoaded();
  const assets = useAssets();
  const thumbSize = useUi((state) => state.engineThumbSize);
  const highlight = useHighlightedAssets();
  const canEdit = project?.role !== "viewer";
  const slots = allSlots.filter((slot) => slot.kind !== "record_field");
  const changed = useChangedSlots(allSlots, Boolean(canEdit));
  const changedSet = new Set(changed);
  const lane = useUi((state) => state.gameAssetLane);
  const gameLane = useServer((state) => state.gameLane);

  return (
    <Panel tabs={<LeftTabs />}>
      {loaded && !engineSyncedAt ? (
        <p className="mb-2 text-[10px] leading-snug text-slate-500">
          Using Godot? The{" "}
          <a
            href={GODOT_PLUGIN_URL}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-slate-300"
          >
            SpriteBench plugin
          </a>{" "}
          pulls these into your project. Project id{" "}
          <span className="font-mono select-all">{project?.id}</span>
        </p>
      ) : null}

      {/* Which lane you are looking at and assigning to; the game picks its own. */}
      <div className="mb-2 flex h-7 items-stretch gap-4 border-b border-[var(--color-edge)]">
        <div role="tablist" aria-label="Art lane" className="flex items-stretch gap-4">
          <PanelTab
            size="section"
            selected={lane === "prototype"}
            onClick={() => useUi.getState().setGameAssetLane("prototype")}
          >
            Prototype
          </PanelTab>
          <PanelTab
            size="section"
            selected={lane === "final"}
            onClick={() => useUi.getState().setGameAssetLane("final")}
          >
            Final
          </PanelTab>
        </div>
        <span className="flex-1" />
        <span
          className="self-center text-[10px] text-slate-500"
          title="Set in Godot: Project Settings → SpriteBench → Art"
        >
          {gameLane === "final" ? "game uses finals, else prototypes" : "game uses prototypes"}
        </span>
      </div>

      <SyncBanner changed={changed} canEdit={Boolean(canEdit)} />

      {allSlots.length > 0 || collections.length > 0 ? (
        <label className="mb-2 flex items-center gap-2 text-[10px] text-slate-500">
          image size
          <input
            type="range"
            min={ENGINE_THUMB_MIN}
            max={ENGINE_THUMB_MAX}
            step={8}
            value={thumbSize}
            onChange={(event) =>
              useUi.getState().setEngineThumbSize(Number.parseInt(event.target.value, 10))
            }
            className="min-w-0 flex-1"
          />
        </label>
      ) : null}

      {collections.length > 0 ? (
        <div className="mb-3">
          <EngineCollections
            collections={collections}
            slots={allSlots}
            assets={assets}
            highlight={highlight}
            canEdit={Boolean(canEdit)}
          />
        </div>
      ) : null}

      {!loaded ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      ) : slots.length === 0 && collections.length === 0 ? (
        <p className="text-[11px] leading-snug text-slate-500">
          No game assets yet.
        </p>
      ) : slots.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {slots.map((slot) => (
            <SlotRow
              key={slot.id}
              slot={slot}
              changed={changedSet.has(laneKey(slot.id, lane))}
              highlight={highlight}
              canEdit={Boolean(canEdit)}
              assets={assets}
            />
          ))}
        </ul>
      )}

    </Panel>
  );
}
