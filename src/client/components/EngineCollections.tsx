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
            <ConfirmTextButton
              confirmLabel="delete?"
              title="Delete this row here and in Godot"
              onConfirm={() => void server().deleteRecord(collection.id, record.id)}
            >
              delete
            </ConfirmTextButton>
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

/** Where a game asset or table was made, which decides where it is renamed and restructured. */
export function OriginTag({
  origin,
  godotTitle,
  webTitle
}: {
  origin: "godot" | "web";
  godotTitle: string;
  webTitle: string;
}) {
  return (
    <span
      title={origin === "godot" ? godotTitle : webTitle}
      className="ml-1.5 shrink-0 rounded bg-[var(--color-ink-600)] px-1 align-middle text-[9px] text-slate-400"
    >
      {origin === "godot" ? "from Godot" : "from SpriteBench"}
    </span>
  );
}

export interface Column {
  key: string;
  intent: "texture" | "textures";
}

const COLUMN_KINDS: Record<Column["intent"], string> = {
  texture: "One image",
  textures: "List of images"
};

/**
 * A table's columns as rows: name, whether each cell holds one image or a
 * list, and remove; then a row to add one. Used to build a new table and to
 * edit one later. A rename reports its old and new key so art can follow.
 */
export function ColumnsEditor({
  columns,
  onChange,
  disabled = false
}: {
  columns: Column[];
  onChange: (next: Column[], rename?: { from: string; to: string }) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [draftKind, setDraftKind] = useState<Column["intent"]>("texture");

  const add = () => {
    const key = draft.trim();
    if (!key || columns.some((column) => column.key === key)) return;
    onChange([...columns, { key, intent: draftKind }]);
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-1">
      {columns.map((column, index) => (
        <div key={`${column.key}-${index}`} className="flex items-center gap-1.5">
          <input
            defaultValue={column.key}
            disabled={disabled}
            aria-label="Column name"
            spellCheck={false}
            className="min-w-0 flex-1 font-mono text-[11px]"
            onBlur={(event) => {
              const key = event.target.value.trim();
              if (!key || key === column.key) {
                event.target.value = column.key;
                return;
              }
              onChange(
                columns.map((other, at) => (at === index ? { ...other, key } : other)),
                { from: column.key, to: key }
              );
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          <select
            value={column.intent}
            disabled={disabled}
            aria-label="Column holds"
            style={{ width: "auto" }}
            className="text-[11px]"
            onChange={(event) =>
              onChange(
                columns.map((other, at) =>
                  at === index ? { ...other, intent: event.target.value as Column["intent"] } : other
                )
              )
            }
          >
            {(Object.keys(COLUMN_KINDS) as Column["intent"][]).map((kind) => (
              <option key={kind} value={kind}>
                {COLUMN_KINDS[kind]}
              </option>
            ))}
          </select>
          {!disabled && columns.length > 1 ? (
            <ConfirmTextButton
              confirmLabel="remove?"
              title="Remove this column (its art assignments go with it)"
              onConfirm={() => onChange(columns.filter((_, at) => at !== index))}
            >
              &times;
            </ConfirmTextButton>
          ) : (
            <span className="w-4" />
          )}
        </div>
      ))}
      {!disabled ? (
        <div className="flex items-center gap-1.5">
          <input
            value={draft}
            placeholder="new column"
            spellCheck={false}
            className="min-w-0 flex-1 font-mono text-[11px]"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") add();
            }}
          />
          <select
            value={draftKind}
            aria-label="New column holds"
            style={{ width: "auto" }}
            className="text-[11px]"
            onChange={(event) => setDraftKind(event.target.value as Column["intent"])}
          >
            {(Object.keys(COLUMN_KINDS) as Column["intent"][]).map((kind) => (
              <option key={kind} value={kind}>
                {COLUMN_KINDS[kind]}
              </option>
            ))}
          </select>
          <TextButton disabled={!draft.trim()} title="Add this column" onClick={add}>
            + add
          </TextButton>
        </div>
      ) : null}
    </div>
  );
}

/** A table's name, click to rename when SpriteBench made it. */
function TableName({ collection, canEdit }: { collection: EngineCollectionView; canEdit: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const editable = canEdit && collection.origin === "web";

  if (draft !== null) {
    const commit = () => {
      const name = draft.trim();
      if (name && name !== collection.label) {
        void useServer.getState().renameGameAsset(collection.id, name, true);
      }
      setDraft(null);
    };
    return (
      <input
        autoFocus
        value={draft}
        spellCheck={false}
        className="min-w-0 flex-1 text-[12px]"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") setDraft(null);
        }}
      />
    );
  }

  return (
    <h3
      className={`truncate text-[12px] text-slate-200 ${editable ? "cursor-text hover:underline" : ""}`}
      title={editable ? "Click to rename" : "Made in Godot: rename it there"}
      onClick={() => {
        if (editable) setDraft(collection.label);
      }}
    >
      {collection.label}
    </h3>
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
            <span className="flex min-w-0 items-baseline gap-1.5">
              <TableName collection={collection} canEdit={canEdit} />
              <OriginTag
                origin={collection.origin}
                godotTitle="Made in Godot: its columns and name are edited there. Rows and art sync both ways."
                webTitle="Made in SpriteBench: rename it and edit its columns here."
              />
            </span>
            <span className="flex shrink-0 items-baseline gap-1 font-mono text-[10px] text-slate-500">
              {collection.records.length} records
              {canEdit ? (
                <ConfirmTextButton
                  confirmLabel="remove?"
                  title={
                    collection.origin === "web"
                      ? "Remove this table; Godot drops it on the next sync"
                      : "Remove from SpriteBench. It stays removed; Godot keeps its file and last art."
                  }
                  onConfirm={() => void useServer.getState().deleteGameAsset(collection.id, true)}
                >
                  &times;
                </ConfirmTextButton>
              ) : null}
            </span>
          </div>
          {collection.godotPath ? (
            <p className="mb-1.5 truncate font-mono text-[10px] text-slate-600">
              {collection.godotPath}
            </p>
          ) : null}
          {collection.origin === "web" ? (
            <details className="mb-1.5" open={collection.records.length === 0}>
              <summary className="cursor-pointer text-[10px] tracking-wider text-slate-500 uppercase">
                columns ({collection.fields.length})
              </summary>
              <div className="mt-1">
                <ColumnsEditor
                  columns={collection.fields}
                  disabled={!canEdit}
                  onChange={(next, rename) =>
                    void useServer
                      .getState()
                      .setGameTableFields(collection.id, next, rename ? [rename] : undefined)
                  }
                />
              </div>
            </details>
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
