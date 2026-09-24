"use client";

import { useState, type DragEvent } from "react";
import { isAssetDrag, readAssetDrag } from "@/client/dragAssets";
import { useAssets } from "@/client/stores/assets";
import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";
import { describeAssignProgress } from "@/shared/assignStream";
import { faceId, setBadge } from "@/shared/assetSet";
import { describeShipment } from "@/shared/engineBundle";
import {
  dropSlotAssignment,
  type EngineSlotIntent,
  type EngineSlotRecord,
  type EngineSlotStatus
} from "@/shared/engineSlot";
import type { ResolvedAsset } from "@/shared/model";
import { AssetThumb } from "./AssetBitmap";
import { RightTabs } from "./RightTabs";
import { Button, Panel, TextButton } from "./ui";

const THUMB = 40;

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
  canEdit,
  busy
}: {
  slot: EngineSlotRecord;
  assets: ResolvedAsset[];
  canEdit: boolean;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
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

  const replace = (assetIds: string[]) =>
    void useServer.getState().assignSlot(slot.id, assetIds, { replace: true });

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
                className="flex items-center gap-1.5 rounded border border-[var(--color-edge)] bg-[var(--color-ink-900)] px-1 py-1"
              >
                <button
                  type="button"
                  title={assignedLabel(asset, id)}
                  onClick={() => useUi.getState().select(id, false)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  {asset ? (
                    <AssetThumb asset={asset} size={THUMB} />
                  ) : (
                    <div
                      className="checkerboard shrink-0 rounded"
                      style={{ width: THUMB, height: THUMB }}
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
                {canEdit ? (
                  <TextButton
                    danger
                    disabled={busy}
                    title={array ? "Remove from this Godot array" : "Unassign from this slot"}
                    onClick={() => replace(dropSlotAssignment(ids, [id]))}
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
                disabled={busy}
                title="Remove every assigned image"
                onClick={() => replace([])}
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
  selectedAssetIds,
  canEdit,
  assets
}: {
  slot: EngineSlotRecord;
  selectedAssetIds: string[];
  canEdit: boolean;
  assets: ResolvedAsset[];
}) {
  const busy = useUi((state) => state.busy);
  const assigning = useUi((state) =>
    state.assigning?.slotId === slot.id ? state.assigning : null
  );
  const [dragOver, setDragOver] = useState(false);
  const array = slot.intent === "textures";
  const canAssign =
    canEdit && !assigning && (array ? selectedAssetIds.length > 0 : selectedAssetIds.length === 1);

  const accept = (event: DragEvent) => canEdit && busy === null && isAssetDrag(event);

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
            : "border-[var(--color-edge)]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[12px] text-slate-200">{slot.label}</p>
          <p className="truncate font-mono text-[10px] text-slate-500">
            {INTENT_LABEL[slot.intent ?? "texture"]} · {slot.godotPath || slot.id}
          </p>
        </div>
        <span
          className={`shrink-0 text-[10px] ${
            assigning ? "text-sky-400" : `uppercase ${STATUS_TONE[slot.status]}`
          }`}
        >
          {assigning ? describeAssignProgress(assigning) : STATUS_LABEL[slot.status]}
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

      <AssignedList
        slot={slot}
        assets={assets}
        canEdit={canEdit}
        busy={busy !== null}
      />

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

      {canAssign || assigning ? (
        <Button
          className="mt-2"
          variant="primary"
          disabled={busy !== null || Boolean(assigning)}
          onClick={() => void useServer.getState().assignSlot(slot.id, selectedAssetIds)}
        >
          {assigning
            ? describeAssignProgress(assigning)
            : array
              ? `add selected (${selectedAssetIds.length})`
              : "assign selected"}
        </Button>
      ) : null}
    </li>
  );
}

export function EnginePanel() {
  const slots = useServer((state) => state.slots);
  const project = useServer((state) => state.project);
  const assets = useAssets();
  const selectedIds = useUi((state) => state.selectedIds);
  const canEdit = project?.role !== "viewer";
  const selectedAssetIds = selectedIds.filter((id) => assets.some((asset) => asset.id === id));

  return (
    <Panel title="Godot" pane="right" lead={<RightTabs />}>
      {project ? (
        <p className="mb-2 font-mono text-[10px] break-all text-slate-500">
          project {project.id}
        </p>
      ) : null}

      {slots.length === 0 ? (
        <p className="text-[11px] leading-snug text-slate-500">
          No Godot slots yet. Enable the SpriteBench addon, paste a personal access
          token, and sync. Slots you opt into over there show up here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {slots.map((slot) => (
            <SlotRow
              key={slot.id}
              slot={slot}
              selectedAssetIds={canEdit ? selectedAssetIds : []}
              canEdit={Boolean(canEdit)}
              assets={assets}
            />
          ))}
        </ul>
      )}

      {slots.length > 0 && canEdit ? (
        <p className="mt-2 text-[10px] text-slate-600">
          Drag library assets onto a slot. Open an array to remove images
          {selectedAssetIds.length > 0 ? ", or use the selection to add." : "."}
        </p>
      ) : null}
    </Panel>
  );
}
