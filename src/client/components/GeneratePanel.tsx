"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useDoc } from "@/client/stores/doc";
import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";
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
import { composePrompt, type PromptSnippetKind } from "@/shared/model";
import { planAnimation, planItemGrid } from "@/shared/animationPrompt";
import {
  activeFeaturePrompts,
  resolveFeatureText,
  workingPrompt
} from "@/shared/featurePrompt";
import {
  bindPrompt,
  expandPrompt,
  insertSlot,
  LOOP_SLOT_NAMES,
  loopBindings,
  loopReservedSlots,
  nextVariableName,
  offeredVariables,
  planCreate
} from "@/shared/promptVars";
import { Button, Divider, Field, NumberInput, Panel, Row, Select, TextButton, Toggle } from "./ui";
import { TemplatePanel } from "./TemplatePanel";

const SIZE_PRESETS = [16, 24, 32, 48, 64, 128, 256] as const;

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
function ProviderHeader({
  expanded,
  onToggle
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
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
        onClick={onToggle}
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
  const sheetSize = sheet ? snapRequestSize(sheet.size, generation.model) : null;

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

      {sheet && sheetSize ? (
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
 * Opt-in library of named versions for one prompt part.
 *
 * Hidden behind "saved" so the working field stays the thing you see. Saving
 * writes to the shared document; loading copies into the working field.
 */
function SnippetLibrary({
  kind,
  value,
  onLoad
}: {
  kind: PromptSnippetKind;
  value: string;
  onLoad: (text: string) => void;
}) {
  const all = useDoc((state) => state.snippets);
  const snippets = useMemo(() => all.filter((entry) => entry.kind === kind), [all, kind]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed || value.trim().length === 0) return;

    useDoc.getState().savePromptSnippet(kind, trimmed, value);
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

function PromptSection({
  title,
  kind,
  value,
  onChange,
  rows,
  hint,
  locked = false,
  startOpen = false,
  onReset
}: {
  title: string;
  kind: PromptSnippetKind | "body" | "feature";
  value: string;
  onChange: (value: string) => void;
  rows: number;
  hint?: string;
  locked?: boolean;
  startOpen?: boolean;
  onReset?: () => void;
}) {
  const [open, setOpen] = useState(startOpen);

  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center gap-2">
        {locked ? (
          <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            {title}
          </span>
        ) : (
          <TextButton
            className="text-[11px] font-semibold tracking-wider uppercase"
            onClick={() => setOpen(!open)}
          >
            {open ? "\u25be" : "\u25b8"} {title}
          </TextButton>
        )}

        <span className="flex-1" />
        {hint ? <span className="text-[10px] text-slate-500">{hint}</span> : null}
        {onReset ? (
          <TextButton title="Restore the default instructions" onClick={onReset}>
            reset
          </TextButton>
        ) : null}
        {kind !== "body" && kind !== "feature" ? (
          <SnippetLibrary kind={kind} value={value} onLoad={onChange} />
        ) : null}
      </div>

      {locked || open ? (
        <textarea
          rows={rows}
          value={value}
          placeholder={
            kind === "scratch"
              ? "park prompts here, nothing here is ever sent anywhere"
              : kind === "prefix"
                ? "prepended to every prompt in this project"
                : kind === "suffix"
                  ? "appended to every prompt in this project"
                  : kind === "feature"
                    ? "extra instructions sent with this feature"
                    : "a rusty steel footlocker, closed lid, worn paint"
          }
          onChange={(event) => onChange(event.target.value)}
        />
      ) : null}
    </div>
  );
}

/**
 * Asking for an animation sheet instead of a single image.
 *
 * The table is the unit: each row is a cycle, columns are the longest cycle,
 * unused cells are masked. The canvas size falls out of that plus the sprite
 * size -- you cannot pick an 8x1 strip because the provider would refuse it.
 */
function VariablesEditor() {
  const promptBody = useUi((state) => state.promptBody);
  const variables = useUi((state) => state.variables);
  const loop = useUi((state) => state.loop);
  const animation = useUi((state) => state.animation);
  const itemGrid = useUi((state) => state.itemGrid);
  const mask = useUi((state) => state.mask);
  const base = useUi((state) => state.base);
  const featurePrompts = useUi((state) => state.featurePrompts);
  const model = useServer((state) => state.settings.generation.model);
  const projectSettings = useDoc((state) => state.project);
  const ui = useUi.getState;

  const reserved = loopReservedSlots(loop.enabled);
  const sheetOn = animation.enabled || itemGrid.enabled;
  const prompt = workingPrompt({
    prefix: projectSettings.promptPrefix,
    body: promptBody,
    suffix: projectSettings.promptSuffix,
    model,
    mask: sheetOn ? null : mask,
    base: sheetOn ? null : base,
    animation,
    itemGrid,
    overrides: featurePrompts
  });
  const rows = offeredVariables(prompt, variables, reserved).filter(
    (entry) => !reserved.includes(entry.name)
  );

  const write = (next: typeof rows) => ui().setVariables(next);

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
        <Row key={`${entry.name}-${index}`} className="mb-1">
          <input
            type="text"
            className="w-24 shrink-0"
            value={entry.name}
            spellCheck={false}
            onChange={(event) => {
              const name = event.target.value.replace(/[^A-Za-z0-9_]/g, "");
              write(rows.map((row, at) => (at === index ? { ...row, name } : row)));
            }}
          />
          <input
            type="text"
            className="min-w-0 flex-1"
            value={entry.values}
            placeholder="green, red, blue"
            onChange={(event) =>
              write(rows.map((row, at) => (at === index ? { ...row, values: event.target.value } : row)))
            }
          />
          <Button
            variant="ghost"
            title="Remove this variable"
            onClick={() => write(rows.filter((_, at) => at !== index))}
          >
            ×
          </Button>
        </Row>
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
  const ui = useUi.getState;

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

          <Field label="Sprite size" hint="px">
            <NumberInput
              integer
              min={8}
              max={512}
              value={itemGrid.cellSize}
              onChange={(cellSize) => ui().setItemGrid({ cellSize })}
            />
          </Field>

          <p className="mb-2 text-[10px] leading-snug text-slate-500">
            One image, {planned.sheet.columns}×{planned.sheet.rows} at {planned.sheet.size.width}×
            {planned.sheet.size.height}, {planned.sheet.cell}px cells down to {itemGrid.cellSize}px
            {planned.sheet.spare > 0
              ? `. ${planned.sheet.spare} cell${planned.sheet.spare === 1 ? "" : "s"} masked`
              : ""}
            . Lands as one set of {itemGrid.columns * itemGrid.rows} items.
          </p>
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
          <p className="mb-2 text-[10px] leading-snug text-slate-500">
            Needs a starting image. {loop.steps} edits in series.{" "}
            {`{step}`} and {`{total_steps}`} fill per job.
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
  const ui = useUi.getState;

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

          <Field label="Sprite size" hint="px">
            <NumberInput
              integer
              min={8}
              max={512}
              value={animation.cellSize}
              onChange={(cellSize) => ui().setAnimation({ cellSize })}
            />
          </Field>

          <p className="mb-2 text-[10px] leading-snug text-slate-500">
            One image, {planned.sheet.columns}×{planned.sheet.rows} at {planned.sheet.size.width}×
            {planned.sheet.size.height}, {planned.sheet.cell}px cells down to {animation.cellSize}px
            {planned.sheet.spare > 0
              ? `. ${planned.sheet.spare} cell${planned.sheet.spare === 1 ? "" : "s"} masked`
              : ""}
            . Each action becomes its own animation when it lands.
          </p>
        </>
      ) : null}
    </div>
  );
}

function SizeAxis({
  label,
  value,
  onChange
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="mb-1.5">
      <Row>
        <span className="w-10 shrink-0 text-[11px] tracking-wide text-slate-400 uppercase">
          {label}
        </span>
        <NumberInput integer min={0} width={52} value={value} onChange={onChange} />
        <div className="flex min-w-0 flex-1 flex-wrap gap-px">
          {SIZE_PRESETS.map((size) => (
            <button
              type="button"
              key={size}
              title={`Set ${label.toLowerCase()} to ${size}px`}
              onClick={() => onChange(size)}
              className={`rounded px-1 py-0.5 text-[10px] tabular-nums transition ${
                value === size
                  ? "bg-[var(--color-accent-dim)] text-white"
                  : "text-slate-500 hover:bg-[var(--color-ink-600)] hover:text-white"
              }`}
            >
              {size}
            </button>
          ))}
        </div>
      </Row>
    </div>
  );
}

export function GeneratePanel() {
  const settings = useServer((state) => state.settings);
  const project = useServer((state) => state.project);
  const projectKeys = useServer((state) => state.projectKeys);
  const projectSettings = useDoc((state) => state.project);
  const promptBody = useUi((state) => state.promptBody);
  const animation = useUi((state) => state.animation);
  const itemGrid = useUi((state) => state.itemGrid);
  const loop = useUi((state) => state.loop);
  const chunk = useUi((state) => state.chunk);
  const base = useUi((state) => state.base);
  const mask = useUi((state) => state.mask);
  const variables = useUi((state) => state.variables);
  const featurePrompts = useUi((state) => state.featurePrompts);
  const scratch = useUi((state) => state.scratch);
  const batches = useUi((state) => state.batches);
  const folder = useUi((state) => state.folder);
  const busy = useUi((state) => state.busy);
  const store = useServer.getState;
  const ui = useUi.getState;

  const canGenerate = project !== null && (project.isOwner || project.canGenerate);
  const projectHasKey = project === null || projectKeys.length > 0;

  const [showModel, setShowModel] = useState(false);

  const generation = settings.generation;
  const processing = settings.processing;
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
  const extras = activeFeaturePrompts({
    model: generation.model,
    mask: sheetOn ? null : mask,
    base: sheetOn ? null : base,
    animation,
    itemGrid
  });
  const promptSpec = workingPrompt({
    prefix: projectSettings.promptPrefix,
    body: promptBody,
    suffix: projectSettings.promptSuffix,
    model: generation.model,
    mask: sheetOn ? null : mask,
    base: sheetOn ? null : base,
    animation,
    itemGrid,
    overrides: featurePrompts
  });
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
    requiresStart: loop.enabled || chunk.enabled,
    hasStart: base?.source.kind === "asset",
    reserved
  });
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
      lead={<ProviderHeader expanded={showModel} onToggle={() => setShowModel(!showModel)} />}
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

      <PromptSection
        title="Scratch"
        kind="scratch"
        rows={8}
        value={scratch}
        onChange={(value) => ui().setScratch(value)}
      />

      <PromptSection
        title="Prefix"
        kind="prefix"
        rows={4}
        value={projectSettings.promptPrefix}
        onChange={(value) => useDoc.getState().patchProjectSettings({ promptPrefix: value })}
      />

      <PromptSection
        title="Prompt"
        kind="body"
        locked
        rows={5}
        hint={`${promptBody.length} chars`}
        value={promptBody}
        onChange={(value) => ui().setPromptBody(value)}
      />

      <PromptSection
        title="Suffix"
        kind="suffix"
        rows={2}
        value={projectSettings.promptSuffix}
        onChange={(value) => useDoc.getState().patchProjectSettings({ promptSuffix: value })}
      />

      {extras.map((entry) => {
        const text = resolveFeatureText(entry, featurePrompts);
        const edited = Object.prototype.hasOwnProperty.call(featurePrompts, entry.id);
        return (
          <PromptSection
            key={entry.id}
            title={entry.label}
            kind="feature"
            rows={entry.slot === "guide" ? 5 : 4}
            startOpen
            hint={edited ? "edited" : "sent with this request"}
            value={text}
            onChange={(value) => ui().setFeaturePrompt(entry.id, value)}
            onReset={edited ? () => ui().resetFeaturePrompt(entry.id) : undefined}
          />
        );
      })}

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

      <LoopMode canEdit={modelOrDefault(generation.model).supportsEdit} />
      <ChunkMode canEdit={modelOrDefault(generation.model).supportsEdit} />
      <AnimationMode />
      <ItemGridMode />

      <Row className="mb-2">
        <div className="flex-1">
          <Field label="Batches" hint="parallel jobs">
            <NumberInput value={batches} min={1} onChange={(value) => ui().setBatches(value)} />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Images per job">
            <NumberInput
              value={loop.enabled || chunk.enabled || animation.enabled || itemGrid.enabled ? 1 : generation.imageCount}
              min={1}
              max={modelOrDefault(generation.model).maxImagesPerRequest}
              disabled={loop.enabled || chunk.enabled || animation.enabled || itemGrid.enabled}
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

      <div className="mb-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
        Asset size
      </div>

      <SizeAxis
        label="W"
        value={processing.targetSize.width}
        onChange={(width) =>
          store().setDefaultProcessing({
            targetSize: { ...processing.targetSize, width: Math.max(0, Math.round(width)) }
          })
        }
      />
      <SizeAxis
        label="H"
        value={processing.targetSize.height}
        onChange={(height) =>
          store().setDefaultProcessing({
            targetSize: { ...processing.targetSize, height: Math.max(0, Math.round(height)) }
          })
        }
      />

      <p className="mb-2 text-[10px] leading-snug text-slate-500">
        {mask?.source.kind === "template" && isPixelConstraintTemplate(mask.source.templateId)
          ? `Pixel constraint uses this as the checkerboard (${pixelConstraintWindow(processing.targetSize).width}×${pixelConstraintWindow(processing.targetSize).height} cells if an axis is 0). The request size above is the plate; each cell is one finished pixel.`
          : "0 keeps the generated size. Otherwise new assets downsample to this, keeping their aspect. The raw source is always kept, so you can change it per asset later in the inspector."}
      </p>

      <Divider />

      <TemplatePanel />
    </Panel>
  );
}
