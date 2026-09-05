"use client";

import { useMemo, useState } from "react";
import { startAssetDrag } from "@/client/dragAssets";
import { useStudio } from "@/client/store";
import type { AssetRecord } from "@/shared/model";
import { AssetThumb } from "./AssetBitmap";
import { Button, Panel, Row } from "./ui";

export function LibraryPanel() {
  const assets = useStudio((state) => state.assets);
  const selectedIds = useStudio((state) => state.selectedIds);
  const busy = useStudio((state) => state.busy);
  const store = useStudio.getState;

  const [search, setSearch] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [thumbSize, setThumbSize] = useState(88);

  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const asset of assets) if (asset.folder) set.add(asset.folder);
    return [...set].sort();
  }, [assets]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return assets
      .filter((asset) => (folderFilter ? asset.folder === folderFilter : true))
      .filter((asset) => {
        if (!needle) return true;
        return (
          asset.name.toLowerCase().includes(needle) ||
          asset.prompt.body.toLowerCase().includes(needle) ||
          asset.tags.some((tag) => tag.toLowerCase().includes(needle))
        );
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [assets, folderFilter, search]);

  const onThumbClick = (event: React.MouseEvent, asset: AssetRecord, index: number) => {
    if (event.shiftKey && selectedIds.length > 0) {
      const anchorId = selectedIds[selectedIds.length - 1];
      const anchorIndex = visible.findIndex((entry) => entry.id === anchorId);

      if (anchorIndex >= 0) {
        const [from, to] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
        store().selectMany(visible.slice(from, to + 1).map((entry) => entry.id));
        return;
      }
    }

    store().select(asset.id, event.ctrlKey || event.metaKey);
  };

  return (
    <Panel
      title={`Library (${visible.length})`}
      actions={
        <>
          <Button
            variant="ghost"
            title="Scan art/scratch and art/approved for assets made before the studio existed"
            disabled={busy !== null}
            onClick={() => void store().importLegacy()}
          >
            import existing
          </Button>
          <Button
            variant="primary"
            disabled={selectedIds.length === 0 || busy !== null}
            title="Queue a fresh generation for each selected asset, reusing its prompt body with the current prefix and suffix"
            onClick={() => void store().rerunSelected()}
          >
            rerun {selectedIds.length > 0 ? selectedIds.length : ""}
          </Button>
        </>
      }
    >
      <Row className="mb-2">
        <input
          type="text"
          placeholder="search name, prompt, tag"
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
          <Button variant="ghost" onClick={() => store().clearSelection()}>
            clear selection
          </Button>
          <Button
            onClick={() => {
              for (const id of selectedIds) store().stageAsset(id);
            }}
          >
            stage {selectedIds.length}
          </Button>
        </Row>
      ) : null}

      {visible.length === 0 ? (
        <p className="text-[11px] leading-snug text-slate-500">
          Nothing here yet. Write a prompt and hit Create, or use{" "}
          <em>import existing</em> to pull in art you already generated in Godot.
        </p>
      ) : (
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))` }}
        >
          {visible.map((asset, index) => {
            const selected = selectedIds.includes(asset.id);

            return (
              <button
                key={asset.id}
                type="button"
                draggable
                onDragStart={(event) =>
                  startAssetDrag(
                    event,
                    selected && selectedIds.length > 1 ? selectedIds : [asset.id]
                  )
                }
                onClick={(event) => onThumbClick(event, asset, index)}
                onDoubleClick={() => store().stageAsset(asset.id)}
                title={`${asset.name}\n${asset.prompt.body}\n${asset.processingDescription}\n\ndrag onto the playground to stage it, or onto a repeater to add it to the mix`}
                className={`rounded border p-1 text-left transition ${
                  selected
                    ? "border-[var(--color-accent)] bg-[var(--color-ink-600)]"
                    : "border-[var(--color-edge)] hover:border-slate-500"
                }`}
              >
                <AssetThumb asset={asset} size={thumbSize} />
                <div className="mt-1 truncate text-[10px] text-slate-400">{asset.name}</div>
                {asset.approvedPath ? (
                  <div className="truncate text-[9px] text-emerald-400">exported</div>
                ) : null}
                {asset.rerunOf ? (
                  <div className="truncate text-[9px] text-sky-400">rerun</div>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
