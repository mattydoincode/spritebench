"use client";

import { useEffect, useRef } from "react";
import { useDoc } from "@/client/stores/doc";
import { useServer } from "@/client/stores/server";
import { defaultPaneSize, useUi } from "@/client/stores/ui";
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
import { SHEET_FRAMES_TEMPLATE_ID, SHEET_FRAMES_TEMPLATE_NAME } from "@/core/frameMask";
import {
  ISO_21_TEMPLATE_ID,
  ISO_21_TEMPLATE_NAME,
  ISO_DIAMOND_TEMPLATE_ID,
  ISO_DIAMOND_TEMPLATE_NAME
} from "@/core/isoMask";
import {
  isPixelConstraintTemplate,
  PIXEL_CONSTRAINT_TEMPLATE_ID,
  PIXEL_CONSTRAINT_TEMPLATE_NAME,
  pixelConstraintWindow
} from "@/core/pixelMask";
import { suggestedFolder } from "@/shared/folder";
import { planAnimation, planItemGrid } from "@/shared/animationPrompt";
import { activeFeaturePrompts } from "@/shared/featurePrompt";
import { SuggestedPrompt } from "./SuggestedPrompt";
import { expandPrompt, loopBindings, loopReservedSlots, planCreate } from "@/shared/promptVars";
import { expandSnippets, snippetRefs } from "@/shared/snippets";
import { sourceUrl } from "@/client/api";
import type { BaseSpec, ImageSource } from "@/shared/model";
import { DownsampleControls } from "./DownsampleControls";
import {
  Button,
  Field,
  NumberInput,
  Panel,
  Row,
  Section,
  Select,
  Toggle
} from "./ui";
import { DropZone, TemplatePanel } from "./TemplatePanel";
import { LeftTabs } from "./LeftTabs";
import { PromptEditor } from "./PromptEditor";

const BUILTIN_TEMPLATE_NAMES: Record<string, string> = {
  [ISO_DIAMOND_TEMPLATE_ID]: ISO_DIAMOND_TEMPLATE_NAME,
  [ISO_21_TEMPLATE_ID]: ISO_21_TEMPLATE_NAME,
  [PIXEL_CONSTRAINT_TEMPLATE_ID]: PIXEL_CONSTRAINT_TEMPLATE_NAME,
  [SHEET_FRAMES_TEMPLATE_ID]: SHEET_FRAMES_TEMPLATE_NAME
};

function keyCaption(key: { provider: string; label: string; keySuffix: string }): string {
  const suffix = key.keySuffix.replace(/^\.\.\./, "");
  return `${providerLabel(key.provider)} · ${key.label || "key"}${suffix ? ` …${suffix}` : ""}`;
}

/**
 * Which key is about to be billed. Always a dropdown, even with one key, so
 * switching providers is a choice here rather than a trip to settings.
 */
function KeyField() {
  const project = useServer((state) => state.project);
  const keys = useServer((state) => state.projectKeys);
  const remembered = useUi((state) => (project ? state.providerKeyId[project.id] : undefined));

  if (!project) return null;

  if (keys.length === 0) {
    return (
      <Field label="Key">
        {project.isOwner ? (
          <button
            type="button"
            onClick={() => useUi.getState().openSettings("account")}
            className="text-[11px] text-amber-300 hover:underline"
          >
            add a key
          </button>
        ) : (
          <span className="text-[11px] text-amber-300">no key</span>
        )}
      </Field>
    );
  }

  const selected = keys.some((key) => key.id === remembered) ? remembered : keys[0].id;

  return (
    <Field label="Key">
      <select
        value={selected ?? keys[0].id}
        title={project.isOwner ? "Which of your keys pays" : `${project.name} owner's key`}
        onChange={(event) => useUi.getState().setProviderKey(project.id, event.target.value)}
      >
        {keys.map((key) => (
          <option key={key.id} value={key.id}>
            {keyCaption(key)}
            {key.valid === false ? " (rejected)" : ""}
          </option>
        ))}
      </select>
    </Field>
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
    <>
      <KeyField />

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
          onChange={(value) => store().setGeneration({ model: value })}
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
    </>
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
            , then Generate. Lands in a batch folder like variables.
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
  const promptHeight = useUi((state) => state.layout.prompt);
  const snippets = useDoc((state) => state.snippets);
  const templates = useServer((state) => state.templates);
  const store = useServer.getState;
  const ui = useUi.getState;

  const canGenerate = project !== null && (project.isOwner || project.canGenerate);
  const projectHasKey = project === null || projectKeys.length > 0;

  const generation = settings.generation;
  const processing = settings.processing;
  const projectCutout = useDoc((state) => state.settings.cutout);
  const billingKey = useSelectedProjectKey();

  useEffect(() => {
    if (!billingKey) return;
    const current = findModel(generation.model);
    if (current && current.provider === billingKey.provider) return;

    store().setGeneration({ model: defaultModelForProvider(billingKey.provider) });
  }, [billingKey, generation.model, store]);

  const sheetOn = animation.enabled || itemGrid.enabled;
  // Everything below plans against the prompt as it will be sent: snippets
  // filled in, so their `{variables}` count like any others.
  const promptSpec = { prefix: "", body: expandSnippets(promptBody, snippets), suffix: "" };
  const missingSnippets = snippetRefs(promptBody).filter(
    (name) => !snippets.some((entry) => entry.name === name)
  );
  const reserved = loopReservedSlots(loop.enabled);
  const create = planCreate({
    prompt: promptSpec,
    variables,
    batches,
    imageCount: 1,
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
  if (!create.blocked && missingSnippets.length > 0) {
    create.blocked = `no snippet named ${missingSnippets.map((name) => `@${name}`).join(", ")}`;
  }
  const canAnimate = create.expansions > 1 && !loop.enabled && !chunk.enabled && !each.enabled && !sheetOn;
  const bindings = expandPrompt(promptSpec, variables, reserved).map((entry) =>
    loop.enabled
      ? { ...entry.bindings, ...loopBindings({ steps: loop.steps, index: 1 }) }
      : entry.bindings
  );

  const templateName = (source: ImageSource) =>
    source.kind === "asset"
      ? "a library image"
      : (templates.find((entry) => entry.id === source.templateId)?.name ??
        BUILTIN_TEMPLATE_NAMES[source.templateId] ??
        "a template");
  const summary = [
    animation.enabled ? "animation sheet" : null,
    itemGrid.enabled && !animation.enabled ? `item grid ${itemGrid.columns}×${itemGrid.rows}` : null,
    loop.enabled ? `loop, ${loop.steps} steps` : null,
    chunk.enabled ? `chunks ${chunk.columns}×${chunk.rows}` : null,
    each.enabled ? "edit each image" : null,
    mask ? `mask: ${templateName(mask.source)}` : null,
    !sheetOn && bases.length > 0
      ? bases.length === 1
        ? `image: ${templateName(bases[0].source)}`
        : `${bases.length} images`
      : null,
    each.enabled && billingKey?.provider === "gemini" ? "Gemini revise guide" : null
  ].filter((entry): entry is string => entry !== null);
  const folderHint = suggestedFolder({
    animation: animation.enabled,
    itemGrid: itemGrid.enabled && !animation.enabled,
    many: create.images > 1 && !loop.enabled && !chunk.enabled
  });

  const prompt = (
    <PromptEditor bindings={bindings} summary={summary}>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="primary"
          className="flex-1 py-1.5 text-sm"
          disabled={busy !== null || !canGenerate || create.blocked !== null}
          title={create.blocked ?? undefined}
          onClick={() => void store().generate()}
        >
          {busy === "queueing"
            ? "queueing..."
            : create.images > 1
              ? `Generate ×${create.images}`
              : "Generate"}
        </Button>
        <label
          className="flex shrink-0 items-center gap-1.5 text-[10px] tracking-wider text-slate-500 uppercase"
          title="Batches: how many jobs to run in parallel"
        >
          batches
          <NumberInput
            integer
            value={batches}
            min={1}
            width={44}
            onChange={(value) => ui().setBatches(value)}
          />
        </label>
      </div>
      {create.blocked ? (
        <p className="mt-1 shrink-0 text-[10px] leading-snug text-amber-300">{create.blocked}</p>
      ) : create.breakdown ? (
        <p className="mt-1 shrink-0 text-[10px] leading-snug text-slate-500">{create.breakdown}</p>
      ) : null}
    </PromptEditor>
  );

  return (
    <Panel
      tabs={<LeftTabs />}
      footer={prompt}
      footerSize={{
        height: promptHeight,
        onDrag: (delta) => ui().setPaneSize("prompt", promptHeight - delta),
        onReset: () => ui().setPaneSize("prompt", defaultPaneSize("prompt"))
      }}
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
              <button
                type="button"
                onClick={() => useUi.getState().openSettings("account")}
                className="underline"
              >
                settings
              </button>
              .
            </>
          ) : (
            "The owner of this project has no image model key, so nothing can be generated in it yet."
          )}
        </p>
      ) : null}

      <Section id="generate.model" label="model">
        <ModelAndSize />
      </Section>

      <Section id="generate.modes" label="modes">
        <LoopMode canEdit={modelOrDefault(generation.model).supportsEdit} />
        <ChunkMode canEdit={modelOrDefault(generation.model).supportsEdit} />
        <EachMode canEdit={modelOrDefault(generation.model).supportsEdit} />
        <AnimationMode />
        <ItemGridMode />
      </Section>

      <Section id="generate.output" label="output">
        <Field label="Folder" hint={folderHint ? `defaults to ${folderHint}` : "optional"}>
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
