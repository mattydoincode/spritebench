"use client";

import { useMemo, useState, type DragEvent } from "react";
import { isAssetDrag, readAssetDrag } from "@/client/dragAssets";
import { useActiveScene, useAssets } from "@/client/stores/assets";
import { useServer } from "@/client/stores/server";
import { ENGINE_THUMB_MAX, ENGINE_THUMB_MIN, useUi } from "@/client/stores/ui";
import { describeSlotActivity } from "@/shared/assignStream";
import { faceId, setBadge } from "@/shared/assetSet";
import { describeShipment } from "@/shared/engineBundle";
import {
  type EngineSlotIntent,
  type EngineSlotRecord,
  type EngineSlotStatus
} from "@/shared/engineSlot";
import type { ResolvedAsset } from "@/shared/model";
import type { SlotEdit } from "@/shared/slotEdits";
import { AssetThumb } from "./AssetBitmap";
import { EngineCollections } from "./EngineCollections";
import { LeftTabs } from "./LeftTabs";
import { Panel, TextButton } from "./ui";

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
  const ids = slot.assignedAssetIds;
  const array = slot.intent === "textures";

  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const shipment = describeShipment(
    slot.intent ?? "texture",
    ids.map((id) => byId.get(id)).filter((asset): asset is ResolvedAsset => Boolean(asset))
  );

  const summary =
    ids.length === 0
      ? `no art assigned · will ship ${INTENT_LABEL[slot.intent ?? "texture"]}`
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

function SlotRow({
  slot,
  highlight,
  canEdit,
  assets
}: {
  slot: EngineSlotRecord;
  highlight: ReadonlySet<string>;
  canEdit: boolean;
  assets: ResolvedAsset[];
}) {
  const assigning = useUi((state) => state.assigning[slot.id] ?? null);
  const queued = useUi((state) => state.assignQueued[slot.id] ?? 0);
  const active = Boolean(assigning) || queued > 0;
  const [dragOver, setDragOver] = useState(false);
  const lit = slot.assignedAssetIds.some((id) => highlight.has(id));

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
            slot.assignedAssetIds.length > 0
              ? "Select this slot's art in the library"
              : "Drag library assets here to assign them"
          }
          onClick={() => {
            if (slot.assignedAssetIds.length > 0) {
              useUi.getState().selectMany([...slot.assignedAssetIds]);
            }
          }}
          className="min-w-0 text-left"
        >
          <p className="truncate text-[12px] text-slate-200">{slot.label}</p>
          <p className="truncate font-mono text-[10px] text-slate-500">
            {INTENT_LABEL[slot.intent ?? "texture"]} · {slot.godotPath || slot.id}
          </p>
        </button>
        <span
          className={`shrink-0 text-[10px] ${
            active ? "text-sky-400" : `uppercase ${STATUS_TONE[slot.status]}`
          }`}
        >
          {active ? describeSlotActivity(assigning, queued) : STATUS_LABEL[slot.status]}
        </span>
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

export function EnginePanel() {
  const allSlots = useServer((state) => state.slots);
  const collections = useServer((state) => state.collections);
  const project = useServer((state) => state.project);
  const assets = useAssets();
  const thumbSize = useUi((state) => state.engineThumbSize);
  const highlight = useHighlightedAssets();
  const canEdit = project?.role !== "viewer";
  const slots = allSlots.filter((slot) => slot.kind !== "record_field");

  return (
    <Panel tabs={<LeftTabs />}>
      {project ? (
        <p className="mb-2 font-mono text-[10px] break-all text-slate-500">
          project {project.id}
        </p>
      ) : null}

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

      {slots.length === 0 && collections.length === 0 ? (
        <p className="text-[11px] leading-snug text-slate-500">
          No Godot slots yet. Enable the SpriteBench addon, paste a personal access
          token, and sync. Slots you opt into over there show up here.
        </p>
      ) : slots.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {slots.map((slot) => (
            <SlotRow
              key={slot.id}
              slot={slot}
              highlight={highlight}
              canEdit={Boolean(canEdit)}
              assets={assets}
            />
          ))}
        </ul>
      )}

      {slots.length > 0 && canEdit ? (
        <p className="mt-2 text-[10px] text-slate-600">
          Drag library assets onto a slot to assign them. Click a slot to find its art
          in the library; open an array to reorder or remove images.
        </p>
      ) : null}
    </Panel>
  );
}
