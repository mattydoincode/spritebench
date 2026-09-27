"use client";

import { useState, type DragEvent } from "react";
import { isAssetDrag, readAssetDrag } from "@/client/dragAssets";
import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";
import { describeSlotActivity } from "@/shared/assignStream";
import type {
  EngineCollectionField,
  EngineCollectionView,
  EngineRecordView
} from "@/shared/engineCollection";
import { laneAssetIds, type EngineSlotRecord, type EngineSlotStatus } from "@/shared/engineSlot";
import type { ResolvedAsset } from "@/shared/model";
import { AssetThumb } from "./AssetBitmap";
import { Button, TextButton, ConfirmTextButton } from "./ui";

const STATUS_DOT: Record<EngineSlotStatus, string> = {
  empty: "bg-slate-600",
  in_sync: "bg-emerald-400",
  pull_available: "bg-sky-400",
  edited_in_godot: "bg-amber-400",
  conflict: "bg-rose-400"
};

function FieldCell({
  field,
  slot,
  assets,
  highlight,
  canEdit
}: {
  field: EngineCollectionField;
  slot: EngineSlotRecord | undefined;
  assets: Map<string, ResolvedAsset>;
  highlight: ReadonlySet<string>;
  canEdit: boolean;
}) {
  const cell = useUi((state) => state.engineThumbSize);
  const assigning = useUi((state) => (slot ? state.assigning[slot.id] ?? null : null));
  const queued = useUi((state) => (slot ? state.assignQueued[slot.id] ?? 0 : 0));
  const active = Boolean(assigning) || queued > 0;
  const [dragOver, setDragOver] = useState(false);
  const array = field.intent === "textures";
  const lane = useUi((state) => state.gameAssetLane);
  const ids = slot ? laneAssetIds(slot, lane) : [];
  const first = ids.length > 0 ? assets.get(ids[0]) : undefined;
  const status = slot?.status ?? "empty";

  const accept = (event: DragEvent) => Boolean(slot) && canEdit && isAssetDrag(event);

  // A still field swaps to the new art; an array field appends.
  const assign = (assetIds: string[]) => {
    if (!slot || assetIds.length === 0) return;
    void useServer
      .getState()
      .editSlot(slot.id, array ? { type: "add", assetIds } : { type: "replace", assetIds: assetIds.slice(0, 1) });
  };

  const lit = ids.some((id) => highlight.has(id));

  return (
    <div
      className="flex flex-col items-center gap-0.5"
      style={{ width: cell + 8 }}
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
        assign(readAssetDrag(event));
      }}
    >
      <button
        type="button"
        title={
          active
            ? `${field.key}: ${describeSlotActivity(assigning, queued)}`
            : first
              ? `${field.key}: ${first.label}. Click to find it in the library; drag art here to replace it.`
              : `${field.key}: drag an asset here`
        }
        onClick={() => {
          // Clicking only ever selects. Assigning takes a drag, so a stray
          // click can never swap a building's art.
          if (ids.length > 0) useUi.getState().selectMany([...ids]);
        }}
        className={`relative rounded border ${
          active
            ? "border-sky-500"
            : dragOver
              ? "border-dashed border-[var(--color-accent)]"
              : lit
                ? "border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]"
                : "border-[var(--color-edge)]"
        }`}
      >
        {first ? (
          <AssetThumb asset={first} size={cell} />
        ) : (
          <div className="checkerboard rounded opacity-40" style={{ width: cell, height: cell }} />
        )}
        {queued > 0 ? (
          <span className="absolute top-0.5 left-0.5 rounded bg-sky-500/80 px-0.5 font-mono text-[9px] text-white">
            +{queued}
          </span>
        ) : null}
        {array && ids.length > 1 ? (
          <span className="absolute right-0.5 bottom-0.5 rounded bg-black/70 px-0.5 font-mono text-[9px] text-slate-200">
            ×{ids.length}
          </span>
        ) : null}
        <span
          aria-hidden
          className={`absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full ${
            active ? "animate-pulse bg-sky-400" : STATUS_DOT[status]
          }`}
        />
      </button>
      <span className="max-w-full truncate font-mono text-[9px] text-slate-500">{field.key}</span>
    </div>
  );
}

function RecordCard({
  collection,
  record,
  slots,
  assets,
  highlight,
  canEdit
}: {
  collection: EngineCollectionView;
  record: EngineRecordView;
  slots: Map<string, EngineSlotRecord>;
  assets: Map<string, ResolvedAsset>;
  highlight: ReadonlySet<string>;
  canEdit: boolean;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const server = useServer.getState;

  const commitRename = () => {
    const next = renaming?.trim();
    setRenaming(null);
    if (next && next !== record.key) void server().renameRecord(collection.id, record.id, next);
  };

  return (
    <li className="rounded border border-[var(--color-edge)] bg-[var(--color-ink-800)] px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        {renaming !== null ? (
          <input
            autoFocus
            type="text"
            value={renaming}
            spellCheck={false}
            className="min-w-0 flex-1 font-mono text-[11px]"
            onChange={(event) => setRenaming(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") setRenaming(null);
            }}
          />
        ) : (
          <p className="min-w-0 truncate font-mono text-[11px] text-slate-200" title={record.id}>
            {record.key}
            {record.pending ? (
              <span className="ml-1.5 text-[9px] text-sky-400" title="Godot picks this up on its next sync">
                awaiting sync
              </span>
            ) : null}
          </p>
        )}
        {canEdit && renaming === null ? (
          <span className="flex shrink-0 gap-1.5">
            <TextButton title="Rename this record" onClick={() => setRenaming(record.key)}>
              rename
            </TextButton>
            <TextButton
              title="Copy this record and its art"
              onClick={() => void server().createRecord(collection.id, record.key, record.id)}
            >
              copy
            </TextButton>
            <TextButton
              danger
              title="Delete this record here and in Godot"
              onClick={() => {
                if (confirm(`Delete ${record.key} from ${collection.label}? Godot removes it on the next sync.`)) {
                  void server().deleteRecord(collection.id, record.id);
                }
              }}
            >
              delete
            </TextButton>
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {collection.fields.map((field) => (
          <FieldCell
            key={field.key}
            field={field}
            slot={slots.get(record.slots[field.key] ?? "")}
            assets={assets}
            highlight={highlight}
            canEdit={canEdit}
          />
        ))}
      </div>
    </li>
  );
}

function AddRecord({ collection }: { collection: EngineCollectionView }) {
  const [key, setKey] = useState("");
  const add = () => {
    const next = key.trim();
    if (!next) return;
    setKey("");
    void useServer.getState().createRecord(collection.id, next);
  };

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        value={key}
        spellCheck={false}
        placeholder="new record key"
        className="min-w-0 flex-1 font-mono text-[11px]"
        onChange={(event) => setKey(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") add();
        }}
      />
      <Button disabled={!key.trim()} onClick={add}>
        add
      </Button>
    </div>
  );
}

/**
 * A web table's fields as chips, editable here: SpriteBench owns them. A field
 * ending in [] holds an ordered list of images instead of one.
 */
function TableFields({ collection, canEdit }: { collection: EngineCollectionView; canEdit: boolean }) {
  const [draft, setDraft] = useState("");

  const save = (fields: EngineCollectionView["fields"]) =>
    void useServer.getState().setGameTableFields(collection.id, fields);

  const add = () => {
    const raw = draft.trim();
    if (!raw) return;
    const list = raw.endsWith("[]");
    save([...collection.fields, { key: raw.replace(/\[\]$/, ""), intent: list ? "textures" : "texture" }]);
    setDraft("");
  };

  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1">
      {collection.fields.map((field) => (
        <span
          key={field.key}
          className="flex items-center gap-0.5 rounded bg-[var(--color-ink-600)] px-1 py-0.5 font-mono text-[10px] text-slate-200"
        >
          {field.key}
          {field.intent === "textures" ? "[]" : ""}
          {canEdit && collection.fields.length > 1 ? (
            <button
              type="button"
              title={`Remove the ${field.key} field`}
              className="text-slate-500 hover:text-white"
              onClick={() => save(collection.fields.filter((other) => other.key !== field.key))}
            >
              ×
            </button>
          ) : null}
        </span>
      ))}
      {canEdit ? (
        <input
          value={draft}
          placeholder="+ field"
          title="Add a field. End it with [] for a list of images."
          spellCheck={false}
          style={{ width: "5.5rem" }}
          className="text-[10px]"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={add}
          onKeyDown={(event) => {
            if (event.key === "Enter") add();
          }}
        />
      ) : null}
    </div>
  );
}

export function EngineCollections({
  collections,
  slots,
  assets,
  highlight,
  canEdit
}: {
  collections: EngineCollectionView[];
  slots: EngineSlotRecord[];
  assets: ResolvedAsset[];
  highlight: ReadonlySet<string>;
  canEdit: boolean;
}) {
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));

  return (
    <div className="flex flex-col gap-3">
      {collections.map((collection) => (
        <section key={collection.id}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h3 className="truncate text-[12px] text-slate-200">{collection.label}</h3>
            <span className="flex shrink-0 items-baseline gap-1 font-mono text-[10px] text-slate-500">
              {collection.records.length} records
              {canEdit && collection.origin === "web" ? (
                <ConfirmTextButton
                  confirmLabel="remove?"
                  title="Remove this table and its rows' art assignments"
                  onConfirm={() => void useServer.getState().deleteGameAsset(collection.id, true)}
                >
                  &times;
                </ConfirmTextButton>
              ) : null}
            </span>
          </div>
          <p className="mb-1.5 truncate font-mono text-[10px] text-slate-600">
            {collection.godotPath || "made in SpriteBench"}
          </p>
          {collection.origin === "web" ? (
            <TableFields collection={collection} canEdit={canEdit} />
          ) : null}
          <ul className="flex flex-col gap-1.5">
            {collection.records.map((record) => (
              <RecordCard
                key={record.id}
                collection={collection}
                record={record}
                slots={slotById}
                assets={assetById}
                highlight={highlight}
                canEdit={canEdit}
              />
            ))}
          </ul>
          {canEdit ? (
            <div className="mt-1.5">
              <AddRecord collection={collection} />
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}
