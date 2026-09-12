"use client";

import { useMemo, useState } from "react";
import { startAssetDrag } from "@/client/dragAssets";
import { resolveAssetsNow, useActiveScene, useAssets } from "@/client/stores/assets";
import { useDoc } from "@/client/stores/doc";
import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";
import { describeSettings } from "@/core/describe";
import { faceId, isLibraryVisible, setBadge } from "@/shared/assetSet";
import { groupByFolder } from "@/shared/folder";
import type { ResolvedAsset } from "@/shared/model";
import { isSetAsset } from "@/shared/repeaterMix";
import { AssetThumb } from "./AssetBitmap";
import { ExportDialog } from "./ExportDialog";
import { Button, Panel, Row } from "./ui";

const COLLAPSED_PEEK = 4;

function LibraryThumb({
  asset,
  selected,
  selectedIds,
  thumbSize,
  sceneId,
  stageIndex,
  onClick
}: {
  asset: ResolvedAsset;
  selected: boolean;
  selectedIds: string[];
  thumbSize: number;
  sceneId: string | null;
  stageIndex: number;
  onClick: (event: React.MouseEvent, asset: ResolvedAsset) => void;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) =>
        startAssetDrag(event, selected && selectedIds.length > 1 ? selectedIds : [asset.id])
      }
      onClick={(event) => onClick(event, asset)}
      onDoubleClick={() => {
        if (sceneId) stageMany(sceneId, [asset.id], stageIndex);
      }}
      title={`${asset.label}\n${asset.prompt.body}\n${describeSettings(
        asset.processing,
        { width: asset.sourceWidth, height: asset.sourceHeight },
        []
      )}\n\ndrag onto the scene to stage it, onto a repeater to add it to the mix, or onto the template slot to generate from it`}
      className={`rounded border p-1 text-left transition ${
        selected
          ? "border-[var(--color-accent)] bg-[var(--color-ink-600)]"
          : "border-[var(--color-edge)] hover:border-slate-500"
      }`}
    >
      <AssetThumb asset={asset} size={thumbSize} />
      <div className="mt-1 truncate text-[10px] text-slate-400">
        {asset.set && faceId(asset.set) === asset.id ? `${asset.label} · ${setBadge(asset.set)}` : asset.label}
      </div>
      {asset.exportPath ? <div className="truncate text-[9px] text-emerald-400">exported</div> : null}
      {asset.rerunOf ? <div className="truncate text-[9px] text-sky-400">rerun</div> : null}
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
  const assets = useAssets();
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

  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const asset of assets) {
      if (!isLibraryVisible(asset.id, asset.hidden, asset.set)) continue;
      if (asset.folder) set.add(asset.folder);
    }
    return [...set].sort();
  }, [assets]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return assets
      .filter((asset) => isLibraryVisible(asset.id, asset.hidden, asset.set))
      .filter((asset) => (folderFilter ? asset.folder === folderFilter : true))
      .filter((asset) => {
        if (!needle) return true;
        return (
          asset.label.toLowerCase().includes(needle) ||
          asset.prompt.body.toLowerCase().includes(needle) ||
          asset.tags.some((tag) => tag.toLowerCase().includes(needle))
        );
      })
      .sort((a, b) => b.seq - a.seq);
  }, [assets, folderFilter, search]);

  const groups = useMemo(() => groupByFolder(visible), [visible]);
  const ordered = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  // Kept in library order rather than click order, so the zip reads the same
  // way the grid does.
  const selectedAssets = useMemo(
    () => assets.filter((asset) => selectedIds.includes(asset.id)),
    [assets, selectedIds]
  );

  const onThumbClick = (event: React.MouseEvent, asset: ResolvedAsset) => {
    const index = ordered.findIndex((entry) => entry.id === asset.id);

    if (event.shiftKey && selectedIds.length > 0) {
      const anchorId = selectedIds[selectedIds.length - 1];
      const anchorIndex = ordered.findIndex((entry) => entry.id === anchorId);

      if (anchorIndex >= 0 && index >= 0) {
        const [from, to] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
        ui().selectMany(ordered.slice(from, to + 1).map((entry) => entry.id));
        return;
      }
    }

    ui().select(asset.id, event.ctrlKey || event.metaKey);
  };

  return (
    <Panel
      title={`Library (${visible.length})`}
      pane="library"
      actions={
        <Button
          variant="primary"
          disabled={selectedIds.length === 0 || busy !== null}
          title="Queue a fresh generation for each selected asset, reusing its prompt body with the current prefix and suffix"
          onClick={() => void store().rerunSelected()}
        >
          rerun {selectedIds.length > 0 ? selectedIds.length : ""}
        </Button>
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
          <Button variant="ghost" onClick={() => ui().clearSelection()}>
            clear selection
          </Button>
          <Button
            disabled={!scene}
            onClick={() => {
              if (scene) stageMany(scene.id, selectedIds, scene.items.length);
            }}
          >
            stage {selectedIds.length}
          </Button>
          <Button
            variant="primary"
            title={
              selectedIds.length === 1
                ? "Download this image"
                : `Download all ${selectedIds.length} as a zip, packaged in your browser`
            }
            onClick={() => setExporting(true)}
          >
            download {selectedIds.length}
          </Button>
        </Row>
      ) : null}

      {exporting ? (
        <ExportDialog assets={selectedAssets} onClose={() => setExporting(false)} />
      ) : null}

      {visible.length === 0 ? (
        <p className="text-[11px] leading-snug text-slate-500">
          Nothing here yet. Write a prompt and hit Create.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map((group) => {
            const collapsed = Boolean(group.folder && collapsedFolders[group.folder]);
            const shown = collapsed ? group.items.slice(0, COLLAPSED_PEEK) : group.items;

            const grid = (
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${thumbSize}px, 1fr))` }}
              >
                {shown.map((asset) => (
                  <LibraryThumb
                    key={asset.id}
                    asset={asset}
                    selected={selectedIds.includes(asset.id)}
                    selectedIds={selectedIds}
                    thumbSize={thumbSize}
                    sceneId={scene?.id ?? null}
                    stageIndex={scene?.items.length ?? 0}
                    onClick={onThumbClick}
                  />
                ))}
              </div>
            );

            if (!group.folder) return <div key="">{grid}</div>;

            return (
              <div
                key={group.folder}
                className="rounded border border-sky-800/70 bg-sky-950/25 p-1.5"
              >
                <button
                  type="button"
                  className="mb-1.5 flex w-full items-center gap-1.5 px-0.5 text-left text-[11px] text-sky-200"
                  onClick={() => ui().toggleFolder(group.folder)}
                  title={collapsed ? "Expand folder" : "Collapse folder"}
                >
                  <span className="w-3 text-[10px] text-sky-400">{collapsed ? "▸" : "▾"}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{group.folder}</span>
                  <span className="text-[10px] text-sky-400/80">{group.items.length}</span>
                </button>
                {grid}
                {collapsed && group.items.length > COLLAPSED_PEEK ? (
                  <p className="mt-1 px-0.5 text-[10px] text-sky-400/70">
                    +{group.items.length - COLLAPSED_PEEK} more
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
