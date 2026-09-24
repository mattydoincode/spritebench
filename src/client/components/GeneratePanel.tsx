"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useDoc } from "@/client/stores/doc";
import { useServer } from "@/client/stores/server";
import { sectionCollapsed, useUi } from "@/client/stores/ui";
import {
  applySizeSelection,
  defaultModelForProvider,
  describeRequestSize,
  findModel,
  modelOrDefault,
  modelsForProvider,
  providerLabel,
  qualitiesFor,
  sizePickerOptions,
  sizeSelection,
  snapRequestSize
} from "@/providers/models";
import { isPixelConstraintTemplate, pixelConstraintWindow } from "@/core/pixelMask";
import { suggestedFolder } from "@/shared/folder";
import { composePrompt } from "@/shared/model";
import { planAnimation, planItemGrid } from "@/shared/animationPrompt";
import { activeFeaturePrompts } from "@/shared/featurePrompt";
import { SuggestedPrompt } from "./SuggestedPrompt";
import {
  bindPrompt,
  expandPrompt,
  insertSlot,
  joinValues,
  LOOP_SLOT_NAMES,
  loopBindings,
  loopReservedSlots,
  nextVariableName,
  offeredVariables,
  parseValues,
  planCreate,
  removeSlot,
  renameSlot
} from "@/shared/promptVars";
import { sourceUrl } from "@/client/api";
import type { BaseSpec, ImageSource } from "@/shared/model";
import { DownsampleControls } from "./DownsampleControls";
import { Button, Field, NumberInput, Panel, Row, Section, Select, TextButton, Toggle } from "./ui";
import { DropZone, TemplatePanel } from "./TemplatePanel";

function keyCaption(key: { provider: string; label: string; keySuffix: string }): string {
  const suffix = key.keySuffix.replace(/^\.\.\./, "");
  return `${providerLabel(key.provider)} · ${key.label || "key"}${suffix ? ` …${suffix}` : ""}`;
}

/**
 * The generate header: which key is about to be billed, and a toggle for the
 * model/size block that used to live at the bottom of the panel.
 *
 * Always shown, even with one key, so switching providers is a dropdown rather
 * than a trip to settings. The chevron is the model/size disclosure -- putting
 * those fields behind it keeps the prompt at the top of the working area.
 */
function ProviderHeader() {
  const expanded = !useUi((state) => sectionCollapsed("generate.model", state.collapsedSections));
  const project = useServer((state) => state.project);
  const keys = useServer((state) => state.projectKeys);
  const remembered = useUi((state) => (project ? state.providerKeyId[project.id] : undefined));

  if (!project) return <span className="text-[11px] text-slate-400">Generate</span>;

  if (keys.length === 0) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        {project.isOwner ? (
          <Link href="/settings" className="truncate text-[11px] text-amber-300 hover:underline">
            add a key
          </Link>
        ) : (
          <span className="truncate text-[11px] text-amber-300">no key</span>
        )}
      </div>
    );
  }

  const selected = keys.some((key) => key.id === remembered) ? remembered : keys[0].id;

  return (
    <div className="flex min-w-0 items-center gap-1">
      <select
        value={selected ?? keys[0].id}
        title={project.isOwner ? "Which of your keys pays" : `${project.name} owner's key`}
        onChange={(event) => useUi.getState().setProviderKey(project.id, event.target.value)}
        className="min-w-0 max-w-[11rem] truncate"
      >
        {keys.map((key) => (
          <option key={key.id} value={key.id}>
            {keyCaption(key)}
            {key.valid === false ? " (rejected)" : ""}
          </option>
        ))}
      </select>

      <button
        type="button"
        title={expanded ? "Hide model and size" : "Show model and size"}
        aria-expanded={expanded}
        onClick={() => useUi.getState().toggleSection("generate.model")}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-[var(--color-edge)] bg-[var(--color-ink-700)] text-[11px] leading-none text-slate-400 hover:border-slate-500 hover:text-white"
      >
        {expanded ? "\u25b4" : "\u25be"}
      </button>
    </div>
  );
}

function useSelectedProjectKey() {
  const project = useServer((state) => state.project);
  const keys = useServer((state) => state.projectKeys);
  const remembered = useUi((state) => (project ? state.providerKeyId[project.id] : undefined));
  const selected = keys.some((key) => key.id === remembered) ? remembered : keys[0]?.id;
  return keys.find((key) => key.id === selected) ?? null;
}

function ModelAndSize() {
  const settings = useServer((state) => state.settings);
  const animation = useUi((state) => state.animation);
  const itemGrid = useUi((state) => state.itemGrid);
  const mask = useUi((state) => state.mask);
  const billingKey = useSelectedProjectKey();
  const store = useServer.getState;

  const generation = settings.generation;
  const model = modelOrDefault(generation.model);
  const offered = billingKey ? modelsForProvider(billingKey.provider) : [model];
  const offeredIds = offered.map((entry) => entry.id);
  const picker = sizePickerOptions(model);
  const selectedSize = sizeSelection(generation, model);
  const sizeHint = describeRequestSize(model, generation.size, generation.useAutoSize);
  const sheet = animation.enabled
    ? planAnimation({
        subject: "",
        actions: animation.actions,
        cellSize: animation.cellSize
      }).sheet
    : itemGrid.enabled
      ? planItemGrid({
          subject: "",
          columns: itemGrid.columns,
          rows: itemGrid.rows,
          cellSize: itemGrid.cellSize
        }).sheet
      : null;
  const pixelOn =
    mask?.source.kind === "template" && isPixelConstraintTemplate(mask.source.templateId);
  const sheetOwnsCanvas = Boolean(sheet && !pixelOn);
  const sheetSize =
    sheet && sheetOwnsCanvas ? snapRequestSize(sheet.size, generation.model) : null;

  return (
    <div className="mb-3 rounded border border-[var(--color-edge)] bg-[var(--color-ink-800)]/60 p-2">
      <Field label="Model">
        <Select
          value={offeredIds.includes(generation.model) ? generation.model : (offeredIds[0] ?? generation.model)}
          options={offeredIds}
          labels={Object.fromEntries(
            offeredIds.map((id) => {
              const info = findModel(id);
              return [id, info ? `${info.label}` : id];
            })
          )}
          onChange={(value) => {
            const next = findModel(value);
            store().setGeneration({
              model: value,
              imageCount: next
                ? Math.min(generation.imageCount, next.maxImagesPerRequest)
                : generation.imageCount
            });
          }}
        />
      </Field>

      <Row>
        <div className="flex-1">
          <Field
            label="Quality"
            hint={model.supportsQuality ? undefined : "not supported by this model"}
          >
            <Select
              value={qualitiesFor(model).includes(generation.quality) ? generation.quality : "auto"}
              options={qualitiesFor(model)}
              disabled={!model.supportsQuality}
              onChange={(value) => store().setGeneration({ quality: value })}
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field
            label="Background"
            hint={model.supportsBackground ? undefined : "not supported by this model"}
          >
            <Select
              value={model.supportsBackground ? generation.background : "auto"}
              options={["auto", "transparent", "opaque"] as const}
              disabled={!model.supportsBackground}
              onChange={(value) => store().setGeneration({ background: value })}
            />
          </Field>
        </div>
      </Row>

      {sheetOwnsCanvas && sheetSize ? (
        <p className="mb-2 text-[10px] leading-snug text-slate-500">
          Sheets pick their own canvas -- this job will request {sheetSize.width}x
          {sheetSize.height}. The size below is only used for stills.
        </p>
      ) : null}

      <Field label="Size">
        <Select
          value={selectedSize}
          options={picker.map((option) => option.id)}
          labels={Object.fromEntries(picker.map((option) => [option.id, option.label]))}
          onChange={(value) => store().setGeneration(applySizeSelection(value, generation, model))}
        />
      </Field>

      {selectedSize === "custom" ? (
        <Row>
          <div className="flex-1">
            <Field label="Request width">
              <NumberInput
                value={generation.size.width}
                min={16}
                step={16}
                onChange={(value) =>
                  store().setGeneration({
                    useAutoSize: false,
                    size: { ...generation.size, width: Math.round(value) }
                  })
                }
              />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Request height">
              <NumberInput
                value={generation.size.height}
                min={16}
                step={16}
                onChange={(value) =>
                  store().setGeneration({
                    useAutoSize: false,
                    size: { ...generation.size, height: Math.round(value) }
                  })
                }
              />
            </Field>
          </div>
        </Row>
      ) : null}

      {sizeHint ? <p className="text-[10px] text-slate-500">{sizeHint}</p> : null}
    </div>
  );
}

/**
 * Opt-in library of named prompts.
 *
 * Hidden behind "saved" so the working field stays the thing you see. Saving
 * writes to the shared document; loading copies into the working field.
 */
function SnippetLibrary({
  value,
  onLoad
}: {
  value: string;
  onLoad: (text: string) => void;
}) {
  const snippets = useDoc((state) => state.snippets);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed || value.trim().length === 0) return;

    useDoc.getState().savePromptSnippet(trimmed, value);
    setName("");
  };

  return (
    <div>
      <TextButton
        title="Save or load a named version"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open);
        }}
      >
        {open ? "hide" : snippets.length > 0 ? `saved (${snippets.length})` : "saved"}
      </TextButton>

      {open ? (
        <div className="mt-1 mb-1.5 rounded border border-[var(--color-edge)] bg-[var(--color-ink-800)] p-1.5">
          {snippets.length === 0 ? (
            <p className="mb-1 px-0.5 text-[10px] text-slate-500">None saved yet.</p>
          ) : (
            <div className="mb-1 flex flex-col gap-0.5">
              {snippets.map((entry) => (
                <div key={entry.id} className="flex items-center gap-1 text-[11px]">
                  <button
                    type="button"
                    title="Load this version"
                    onClick={() => onLoad(entry.text)}
                    className="min-w-0 flex-1 truncate px-1 py-0.5 text-left text-slate-300 hover:bg-[var(--color-ink-600)] hover:text-white"
                  >
                    {entry.name}
                  </button>
                  <TextButton
                    danger
                    title="Delete"
                    onClick={() => useDoc.getState().deletePromptSnippet(entry.id)}
                  >
                    &times;
                  </TextButton>
                </div>
              ))}
            </div>
          )}

          <Row>
            <input
              value={name}
              placeholder="name this version"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") save();
              }}
              className="min-w-0 flex-1"
            />
            <Button
              variant="ghost"
              disabled={!name.trim() || value.trim().length === 0}
              onClick={save}
            >
              save
            </Button>
          </Row>
        </div>
      ) : null}
    </div>
  );
}

function VariableValues({
  values,
  onChange
}: {
  values: string;
  onChange: (values: string) => void;
}) {
  const chips = parseValues(values);
  const [draft, setDraft] = useState("");

  const write = (next: string[]) => onChange(joinValues(next));

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 rounded border border-[var(--color-edge)] bg-[var(--color-ink-800)] px-1 py-0.5">
      {chips.map((chip, index) => (
        <span
          key={`${chip}-${index}`}
          className="flex items-center gap-0.5 rounded bg-[var(--color-ink-600)] px-1 py-0.5 text-[10px] leading-none text-slate-200"
        >
          {chip}
          <button
            type="button"
            title={`Remove ${chip}`}
            onClick={() => write(chips.filter((_, at) => at !== index))}
            className="text-slate-500 hover:text-white"
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        placeholder={chips.length === 0 ? "green, red, blue" : "add"}
        spellCheck={false}
        style={{
          width: "auto",
          minWidth: chips.length === 0 ? "8rem" : "3.5rem",
          border: "none",
          background: "transparent",
          padding: "2px 4px"
        }}
        className="min-w-0 flex-1 text-[11px]"
        onChange={(event) => {
          const text = event.target.value;
          if (!text.includes(",")) {
            setDraft(text);
            return;
          }
          const parts = text.split(",");
          const rest = parts.pop() ?? "";
          const added = parts.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
          if (added.length > 0) write([...chips, ...added]);
          setDraft(rest);
        }}
        onPaste={(event) => {
          const text = event.clipboardData.getData("text");
          if (!text.includes(",")) return;
          event.preventDefault();
          write([...chips, ...parseValues(`${draft}${text}`)]);
          setDraft("");
        }}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === ",") && draft.trim()) {
            event.preventDefault();
            write([...chips, draft.trim()]);
            setDraft("");
            return;
          }
          if (event.key === "Backspace" && draft === "" && chips.length > 0) {
            write(chips.slice(0, -1));
          }
        }}
        onBlur={() => {
          if (!draft.trim()) return;
          write([...chips, draft.trim()]);
          setDraft("");
        }}
      />
    </div>
  );
}

function VariablesEditor() {
  const promptBody = useUi((state) => state.promptBody);
  const variables = useUi((state) => state.variables);
  const loop = useUi((state) => state.loop);
  const ui = useUi.getState;

  const reserved = loopReservedSlots(loop.enabled);
  const prompt = { prefix: "", body: promptBody, suffix: "" };
  const rows = offeredVariables(prompt, variables, reserved).filter(
    (entry) => !reserved.includes(entry.name)
  );

  const write = (next: typeof rows) => ui().setVariables(next);

  const rewriteSlots = (from: string, to: string) => {
    ui().setPromptBody(renameSlot(promptBody, from, to));
  };

  const drop = (name: string, index: number) => {
    ui().setPromptBody(removeSlot(promptBody, name));
    write(rows.filter((_, at) => at !== index));
  };

  return (
    <div className="mb-2">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-slate-400">Variables</span>
        <span className="text-[10px] text-slate-500">{`{name} in the prompt`}</span>
      </span>

      {loop.enabled ? (
        <div className="mb-1 flex flex-wrap items-center gap-1">
          {LOOP_SLOT_NAMES.map((name) => (
            <TextButton
              key={name}
              title={`Insert {${name}} — filled each loop step`}
              onClick={() => ui().setPromptBody(insertSlot(promptBody, name))}
            >
              {`{${name}}`}
            </TextButton>
          ))}
          <span className="text-[10px] text-slate-500">filled each step</span>
        </div>
      ) : null}

      {rows.map((entry, index) => (
        <div
          key={`${entry.name}-${index}`}
          className="mb-1.5 rounded border border-[var(--color-edge)] bg-[var(--color-ink-800)]/50 p-1.5"
        >
          <Row className="mb-1">
            <input
              type="text"
              value={entry.name}
              spellCheck={false}
              title="Slot name"
              style={{ width: 88 }}
              onChange={(event) => {
                const name = event.target.value.replace(/[^A-Za-z0-9_]/g, "");
                if (name !== entry.name) rewriteSlots(entry.name, name);
                write(rows.map((row, at) => (at === index ? { ...row, name } : row)));
              }}
            />
            <span className="min-w-0 truncate text-[10px] text-slate-500">{`{${entry.name || "name"}}`}</span>
            <span className="flex-1" />
            <TextButton danger title="Remove this variable" onClick={() => drop(entry.name, index)}>
              remove
            </TextButton>
          </Row>
          <VariableValues
            values={entry.values}
            onChange={(next) =>
              write(rows.map((row, at) => (at === index ? { ...row, values: next } : row)))
            }
          />
        </div>
      ))}

      <Button
        className="w-full"
        onClick={() => {
          const name = nextVariableName(rows);
          ui().setPromptBody(insertSlot(promptBody, name));
          write([...rows, { name, values: "" }]);
        }}
      >
        add variable
      </Button>
    </div>
  );
}

function ItemGridMode() {
  const itemGrid = useUi((state) => state.itemGrid);
  const mask = useUi((state) => state.mask);
  const settings = useServer((state) => state.settings);
  const ui = useUi.getState;
  const pixelOn =
    mask?.source.kind === "template" && isPixelConstraintTemplate(mask.source.templateId);
  const cells = pixelConstraintWindow(settings.processing.targetSize);
  const request = snapRequestSize(settings.generation.size, settings.generation.model);

  const planned = planItemGrid({
    subject: "",
    columns: itemGrid.columns,
    rows: itemGrid.rows,
    cellSize: itemGrid.cellSize
  });

  return (
    <div className="mb-2">
      <Toggle
        label="Item grid"
        checked={itemGrid.enabled}
        onChange={(enabled) => ui().setItemGrid({ enabled })}
      />

      {itemGrid.enabled ? (
        <>
          <Row className="mb-2">
            <div className="flex-1">
              <Field label="Columns">
                <NumberInput
                  integer
                  min={1}
                  max={32}
                  value={itemGrid.columns}
                  onChange={(columns) => ui().setItemGrid({ columns })}
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Rows">
                <NumberInput
                  integer
                  min={1}
                  max={32}
                  value={itemGrid.rows}
                  onChange={(rows) => ui().setItemGrid({ rows })}
                />
              </Field>
            </div>
          </Row>

          {pixelOn ? null : (
            <Field label="Sprite size" hint="px">
              <NumberInput
                integer
                min={8}
                max={512}
                value={itemGrid.cellSize}
                onChange={(cellSize) => ui().setItemGrid({ cellSize })}
              />
            </Field>
          )}

          <p className="mb-2 text-[10px] leading-snug text-slate-500">
            {pixelOn
              ? `One image, ${planned.plan.columns}×${planned.plan.rows} at ${request.width}×${request.height}, each cell a ${cells.width}×${cells.height} pixel grid`
              : `One image, ${planned.sheet.columns}×${planned.sheet.rows} at ${planned.sheet.size.width}×${planned.sheet.size.height}, ${planned.sheet.cell}px cells down to ${itemGrid.cellSize}px`}
            {planned.sheet.spare > 0
              ? `. ${planned.sheet.spare} cell${planned.sheet.spare === 1 ? "" : "s"} ${
                  pixelOn ? "empty" : "masked"
                }`
              : ""}
            . Lands as one set of {itemGrid.columns * itemGrid.rows} items.
          </p>
          <SheetSuggestion />
        </>
      ) : null}
    </div>
  );
}

function LoopMode({ canEdit }: { canEdit: boolean }) {
  const loop = useUi((state) => state.loop);
  const ui = useUi.getState;

  return (
    <div className="mb-2">
      <Toggle
        label="Loop"
        checked={loop.enabled}
        disabled={!canEdit}
        onChange={(enabled) => ui().setLoop({ enabled })}
      />
      {loop.enabled ? (
        <>
          <Field label="Steps" hint="same prompt, each output feeds the next">
            <NumberInput
              integer
              min={2}
              max={20}
              value={loop.steps}
              onChange={(steps) => ui().setLoop({ steps })}
            />
          </Field>
          <Toggle
            label="Send the starting image every step"
            checked={loop.sendStart}
            onChange={(sendStart) => ui().setLoop({ sendStart })}
          />
          <Toggle
            label="Include the starting image in the animation"
            checked={loop.includeStart}
            onChange={(includeStart) => ui().setLoop({ includeStart })}
          />
          <p className="mb-2 text-[10px] leading-snug text-slate-500">
            Needs a starting image. {loop.steps} edits in series.{" "}
            {`{step}`} and {`{total_steps}`} fill per job.
            {loop.sendStart
              ? " Each step also gets the original start as a second reference."
              : ""}
            {loop.includeStart ? " The start is frame 1 of the finished loop." : ""}
          </p>
        </>
      ) : !canEdit ? (
        <p className="mb-2 text-[10px] leading-snug text-slate-500">
          This model cannot edit an existing image.
        </p>
      ) : null}
    </div>
  );
}

function assetBase(assetId: string, previous: BaseSpec[]): BaseSpec {
  return {
    source: { kind: "asset", assetId },
    fit: previous[0]?.fit ?? "contain",
    matchAspect: previous[0]?.matchAspect ?? true
  };
}

function eachPreviewSrc(source: ImageSource, projectId: string): string {
  if (source.kind === "asset") return sourceUrl(projectId, source.assetId, "thumb");
  return `/api/projects/${projectId}/templates/file?id=${encodeURIComponent(source.templateId)}&alpha=false`;
}

function EachImages() {
  const bases = useUi((state) => state.bases);
  const busy = useUi((state) => state.busy);
  const projectId = useServer((state) => state.project?.id ?? null);
  const store = useServer.getState;
  const ui = useUi.getState;
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="mb-2">
      <DropZone
        hint={
          busy === "saving template"
            ? "processing template..."
            : "drop PNGs or drag assets — each one is its own edit"
        }
        onFiles={(files) => void store().uploadTemplates(files, { slot: "base" })}
        onAssets={(assetIds) => ui().addBases(assetIds.map((assetId) => assetBase(assetId, bases)))}
      />

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length > 0) void store().uploadTemplates(files, { slot: "base" });
        }}
      />

      <Button className="mb-2 w-full" onClick={() => fileRef.current?.click()}>
        upload images
      </Button>

      {bases.length > 0 ? (
        <div className="mb-2 grid grid-cols-3 gap-1.5">
          {bases.map((entry, index) => (
            <div key={`${entry.source.kind}:${index}`} className="relative">
              {projectId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  src={eachPreviewSrc(entry.source, projectId)}
                  className="checkerboard h-16 w-full rounded border border-[var(--color-edge)] object-contain"
                  style={{ imageRendering: "pixelated" }}
                />
              ) : (
                <div className="h-16 rounded border border-[var(--color-edge)]" />
              )}
              <button
                type="button"
                title="Remove"
                onClick={() => ui().removeBase(index)}
                className="absolute top-0.5 right-0.5 rounded bg-[var(--color-ink-800)]/80 px-1 text-[10px] leading-none text-slate-400 hover:text-white"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EachMode({ canEdit }: { canEdit: boolean }) {
  const each = useUi((state) => state.each);
  const bases = useUi((state) => state.bases);
  const ui = useUi.getState;

  return (
    <div className="mb-2">
      <Toggle
        label="Each image"
        checked={each.enabled}
        disabled={!canEdit}
        onChange={(enabled) => ui().setEach({ enabled })}
      />
      {each.enabled ? (
        <>
          <EachImages />
          <p className="mb-2 text-[10px] leading-snug text-slate-500">
            Same prompt on every image. {bases.length > 0 ? `${bases.length} edit${bases.length === 1 ? "" : "s"}` : "Add images first"}
            , then Create. Lands in a batch folder like variables.
          </p>
        </>
      ) : !canEdit ? (
        <p className="mb-2 text-[10px] leading-snug text-slate-500">
          This model cannot edit an existing image.
        </p>
      ) : null}
    </div>
  );
}

function ChunkMode({ canEdit }: { canEdit: boolean }) {
  const chunk = useUi((state) => state.chunk);
  const ui = useUi.getState;
  const cells = chunk.columns * chunk.rows;

  return (
    <div className="mb-2">
      <Toggle
        label="Chunk"
        checked={chunk.enabled}
        disabled={!canEdit}
        onChange={(enabled) => ui().setChunk({ enabled })}
      />
      {chunk.enabled ? (
        <>
          <Row className="mb-2">
            <div className="flex-1">
              <Field label="Columns">
                <NumberInput
                  integer
                  min={1}
                  max={16}
                  value={chunk.columns}
                  onChange={(columns) => ui().setChunk({ columns })}
                />
              </Field>
            </div>
            <div className="flex-1">
              <Field label="Rows">
                <NumberInput
                  integer
                  min={1}
                  max={16}
                  value={chunk.rows}
                  onChange={(rows) => ui().setChunk({ rows })}
                />
              </Field>
            </div>
          </Row>
          <p className="mb-2 text-[10px] leading-snug text-slate-500">
            Slices the starting image into {cells} cells, one parallel edit each.
          </p>
        </>
      ) : !canEdit ? (
        <p className="mb-2 text-[10px] leading-snug text-slate-500">
          This model cannot edit an existing image.
        </p>
      ) : null}
    </div>
  );
}

function AnimationMode() {
  const animation = useUi((state) => state.animation);
  const mask = useUi((state) => state.mask);
  const settings = useServer((state) => state.settings);
  const ui = useUi.getState;
  const pixelOn =
    mask?.source.kind === "template" && isPixelConstraintTemplate(mask.source.templateId);
  const cells = pixelConstraintWindow(settings.processing.targetSize);
  const request = snapRequestSize(settings.generation.size, settings.generation.model);

  const planned = planAnimation({
    subject: "",
    actions: animation.actions,
    cellSize: animation.cellSize
  });

  const setAction = (index: number, patch: Partial<{ name: string; frames: number }>) => {
    ui().setAnimation({
      actions: animation.actions.map((entry, at) => (at === index ? { ...entry, ...patch } : entry))
    });
  };

  return (
    <div className="mb-2">
      <Toggle
        label="Animation sheet"
        checked={animation.enabled}
        onChange={(enabled) => ui().setAnimation({ enabled })}
      />

      {animation.enabled ? (
        <>
          <div className="mb-2">
            <span className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-[11px] uppercase tracking-wide text-slate-400">Actions</span>
              <span className="text-[10px] text-slate-500">one row each</span>
            </span>

            {animation.actions.map((entry, index) => (
              <Row key={index} className="mb-1">
                <input
                  type="text"
                  className="min-w-0 flex-1"
                  value={entry.name}
                  placeholder={index === 0 ? "idle" : "walk"}
                  onChange={(event) => setAction(index, { name: event.target.value })}
                />
                <NumberInput
                  integer
                  min={1}
                  max={32}
                  width={56}
                  title="Frames in this cycle"
                  value={entry.frames}
                  onChange={(frames) => setAction(index, { frames })}
                />
                <Button
                  variant="ghost"
                  disabled={animation.actions.length <= 1}
                  title="Remove this action"
                  onClick={() =>
                    ui().setAnimation({
                      actions: animation.actions.filter((_, at) => at !== index)
                    })
                  }
                >
                  ×
                </Button>
              </Row>
            ))}

            <Button
              className="w-full"
              onClick={() =>
                ui().setAnimation({
                  actions: [...animation.actions, { name: "", frames: 4 }]
                })
              }
            >
              add action
            </Button>
          </div>

          {pixelOn ? null : (
            <Field label="Sprite size" hint="px">
              <NumberInput
                integer
                min={8}
                max={512}
                value={animation.cellSize}
                onChange={(cellSize) => ui().setAnimation({ cellSize })}
              />
            </Field>
          )}

          <p className="mb-2 text-[10px] leading-snug text-slate-500">
            {pixelOn
              ? `One image, ${planned.plan.columns}×${planned.plan.rows} at ${request.width}×${request.height}, each cell a ${cells.width}×${cells.height} pixel grid`
              : `One image, ${planned.sheet.columns}×${planned.sheet.rows} at ${planned.sheet.size.width}×${planned.sheet.size.height}, ${planned.sheet.cell}px cells down to ${animation.cellSize}px`}
            {planned.sheet.spare > 0
              ? `. ${planned.sheet.spare} cell${planned.sheet.spare === 1 ? "" : "s"} ${
                  pixelOn ? "empty" : "masked"
                }`
              : ""}
            . Each action becomes its own animation when it lands.
          </p>
          <SheetSuggestion />
        </>
      ) : null}
    </div>
  );
}

function SheetSuggestion() {
  const generation = useServer((state) => state.settings.generation);
  const animation = useUi((state) => state.animation);
  const itemGrid = useUi((state) => state.itemGrid);
  const mask = useUi((state) => state.mask);
  const bases = useUi((state) => state.bases);
  const extras = activeFeaturePrompts({
    model: generation.model,
    mask,
    base: animation.enabled || itemGrid.enabled ? null : (bases[0] ?? null),
    animation,
    itemGrid
  });
  const sheet = extras.find((entry) => entry.id === "animation" || entry.id === "item-grid");
  if (!sheet) return null;
  return <SuggestedPrompt text={sheet.defaultText} />;
}

export function GeneratePanel() {
  const settings = useServer((state) => state.settings);
  const project = useServer((state) => state.project);
  const projectKeys = useServer((state) => state.projectKeys);
  const promptBody = useUi((state) => state.promptBody);
  const animation = useUi((state) => state.animation);
  const itemGrid = useUi((state) => state.itemGrid);
  const loop = useUi((state) => state.loop);
  const chunk = useUi((state) => state.chunk);
  const each = useUi((state) => state.each);
  const bases = useUi((state) => state.bases);
  const mask = useUi((state) => state.mask);
  const variables = useUi((state) => state.variables);
  const animateExpansions = useUi((state) => state.animateExpansions);
  const batches = useUi((state) => state.batches);
  const folder = useUi((state) => state.folder);
  const busy = useUi((state) => state.busy);
  const store = useServer.getState;
  const ui = useUi.getState;

  const canGenerate = project !== null && (project.isOwner || project.canGenerate);
  const projectHasKey = project === null || projectKeys.length > 0;

  const showModel = !useUi((state) => sectionCollapsed("generate.model", state.collapsedSections));

  const generation = settings.generation;
  const processing = settings.processing;
  const projectCutout = useDoc((state) => state.settings.cutout);
  const billingKey = useSelectedProjectKey();

  useEffect(() => {
    if (!billingKey) return;
    const current = findModel(generation.model);
    if (current && current.provider === billingKey.provider) return;

    const next = findModel(defaultModelForProvider(billingKey.provider));
    store().setGeneration({
      model: next?.id ?? defaultModelForProvider(billingKey.provider),
      imageCount: next ? Math.min(generation.imageCount, next.maxImagesPerRequest) : 1
    });
  }, [billingKey, generation.imageCount, generation.model, store]);

  const sheetOn = animation.enabled || itemGrid.enabled;
  const promptSpec = { prefix: "", body: promptBody, suffix: "" };
  const composed = composePrompt(promptSpec);
  const reserved = loopReservedSlots(loop.enabled);
  const create = planCreate({
    prompt: promptSpec,
    variables,
    batches,
    imageCount: generation.imageCount,
    sheet: animation.enabled || itemGrid.enabled,
    loopSteps: loop.enabled ? loop.steps : 0,
    chunkCells: chunk.enabled ? chunk.columns * chunk.rows : 0,
    bases: sheetOn ? 0 : bases.length,
    startNoun: each.enabled ? "image" : loop.enabled || chunk.enabled ? "start" : "template",
    requiresStart: loop.enabled || chunk.enabled || each.enabled,
    hasStart: each.enabled
      ? bases.length > 0
      : bases.length > 0 && bases.every((entry) => entry.source.kind === "asset"),
    missingStart: each.enabled ? "add images to edit first" : undefined,
    each: each.enabled,
    reserved,
    animate: animateExpansions && !loop.enabled && !chunk.enabled && !each.enabled && !sheetOn
  });
  const canAnimate = create.expansions > 1 && !loop.enabled && !chunk.enabled && !each.enabled && !sheetOn;
  const expansions = expandPrompt(promptSpec, variables, reserved).map((entry) =>
    loop.enabled
      ? { ...entry, prompt: bindPrompt(entry.prompt, loopBindings({ steps: loop.steps, index: 1 })) }
      : entry
  );
  const folderHint = suggestedFolder({
    animation: animation.enabled,
    itemGrid: itemGrid.enabled && !animation.enabled,
    many: create.images > 1 && !loop.enabled && !chunk.enabled
  });

  return (
    <Panel
      pane="left"
      lead={<ProviderHeader />}
    >
      {!canGenerate ? (
        <p className="mb-3 rounded border border-amber-700 bg-amber-950/40 p-2 text-[11px] text-amber-200">
          You can edit this project but not generate in it. Generation bills the owner&apos;s image
          model key, so they have to grant it separately.
        </p>
      ) : !projectHasKey ? (
        <p className="mb-3 rounded border border-amber-700 bg-amber-950/40 p-2 text-[11px] text-amber-200">
          {project?.isOwner ? (
            <>
              You have no image model key yet. Add one in{" "}
              <Link href="/settings" className="underline">
                settings
              </Link>
              .
            </>
          ) : (
            "The owner of this project has no image model key, so nothing can be generated in it yet."
          )}
        </p>
      ) : null}

      {showModel ? <ModelAndSize /> : null}

      <Section id="generate.prompt" label="prompt">
        <div className="mb-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
              Prompt
            </span>
            <span className="flex-1" />
            <span className="text-[10px] text-slate-500">{promptBody.length} chars</span>
            <TextButton
              title="Reset prompt, modes, templates, and job settings. Keeps the current model."
              onClick={() => store().resetGenerateDefaults()}
            >
              reset
            </TextButton>
            <SnippetLibrary value={promptBody} onLoad={(value) => ui().setPromptBody(value)} />
          </div>
          <textarea
            rows={8}
            value={promptBody}
            placeholder="a rusty steel footlocker, closed lid, worn paint"
            onChange={(event) => ui().setPromptBody(event.target.value)}
          />
        </div>

        <VariablesEditor />

        <details className="mb-2">
          <summary className="cursor-pointer text-[11px] text-slate-400">
            Preview composed prompt
            {expansions.length > 1 ? ` · first of ${expansions.length}` : ""}
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded bg-[var(--color-ink-800)] p-2 text-[10px] whitespace-pre-wrap text-slate-400">
            {(expansions[0] ? composePrompt(expansions[0].prompt) : composed) || "(empty)"}
            {expansions.length > 1 ? `\n\n+${expansions.length - 1} more` : ""}
          </pre>
        </details>
      </Section>

      <Field
        label="Folder"
        hint={folderHint ? `defaults to ${folderHint}` : "optional"}
      >
        <input
          type="text"
          value={folder}
          placeholder={folderHint || "library folder"}
          maxLength={255}
          onChange={(event) => ui().setFolder(event.target.value)}
        />
      </Field>

      {canAnimate ? (
        <Toggle
          label="Collect into an animation"
          checked={animateExpansions}
          onChange={(value) => ui().setAnimateExpansions(value)}
        />
      ) : null}

      <Button
        variant="primary"
        className="mb-1 w-full py-1.5 text-sm"
        disabled={busy !== null || !canGenerate || create.blocked !== null}
        title={create.blocked ?? undefined}
        onClick={() => void store().generate()}
      >
        {busy === "queueing"
          ? "queueing..."
          : create.images > 1
            ? `Create ×${create.images}`
            : "Create"}
      </Button>
      {create.blocked ? (
        <p className="mb-3 text-[10px] leading-snug text-amber-300">{create.blocked}</p>
      ) : create.breakdown ? (
        <p className="mb-3 text-[10px] leading-snug text-slate-500">{create.breakdown}</p>
      ) : (
        <div className="mb-3" />
      )}

      <Section id="generate.modes" label="modes">
        <LoopMode canEdit={modelOrDefault(generation.model).supportsEdit} />
        <ChunkMode canEdit={modelOrDefault(generation.model).supportsEdit} />
        <EachMode canEdit={modelOrDefault(generation.model).supportsEdit} />
        <AnimationMode />
        <ItemGridMode />
      </Section>

      <Section id="generate.job" label="job">
        <Row className="mb-2">
          <div className="flex-1">
            <Field label="Batches" hint="parallel jobs">
              <NumberInput value={batches} min={1} onChange={(value) => ui().setBatches(value)} />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Images per job">
              <NumberInput
                value={
                  loop.enabled || chunk.enabled || each.enabled || animation.enabled || itemGrid.enabled || (canAnimate && animateExpansions)
                    ? 1
                    : generation.imageCount
                }
                min={1}
                max={modelOrDefault(generation.model).maxImagesPerRequest}
                disabled={
                  loop.enabled ||
                  chunk.enabled ||
                  each.enabled ||
                  animation.enabled ||
                  itemGrid.enabled ||
                  (canAnimate && animateExpansions)
                }
                onChange={(value) =>
                  store().setGeneration({
                    imageCount: Math.min(
                      modelOrDefault(generation.model).maxImagesPerRequest,
                      Math.max(1, value)
                    )
                  })
                }
              />
            </Field>
          </div>
        </Row>
      </Section>

      <Section id="generate.size" label="size">
        <DownsampleControls
          processing={processing}
          onChange={(patch) => store().setDefaultProcessing(patch)}
          hint={
            mask?.source.kind === "template" && isPixelConstraintTemplate(mask.source.templateId)
              ? `Pixel constraint uses this as the checkerboard (${pixelConstraintWindow(processing.targetSize).width}×${pixelConstraintWindow(processing.targetSize).height} cells if an axis is 0). Unchecking keeps these values for the plate but skips sampling.`
              : "New assets shrink to this. 0 on one axis takes the other. The raw source is always kept."
          }
        />
      </Section>

      <Section id="generate.template" label="template">
        <TemplatePanel />
        <Toggle
          label="Clip result to iso diamond"
          checked={projectCutout.clipToIso}
          disabled={project?.role === "viewer"}
          onChange={(clipToIso) => useDoc.getState().patchSettings({ cutout: { clipToIso } })}
        />
      </Section>
    </Panel>
  );
}
