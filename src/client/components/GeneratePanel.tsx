"use client";

import { useEffect, useRef, useState } from "react";
import { useStudio } from "@/client/store";
import { modelIds, modelOrDefault, snapRequestSize } from "@/providers/models";
import { composePrompt } from "@/shared/model";
import { Button, Divider, Field, NumberInput, Panel, Row, Select, Toggle } from "./ui";
import { TemplatePanel } from "./TemplatePanel";

function Scratchpad() {
  const scratch = useStudio((state) => state.scratch);
  const ready = useStudio((state) => state.ready);
  const store = useStudio.getState;

  const [open, setOpen] = useState(false);
  const opened = useRef(false);

  useEffect(() => {
    if (!ready || opened.current) return;
    opened.current = true;
    if (scratch.length > 0) setOpen(true);
  }, [ready, scratch]);

  return (
    <div className="mb-2">
      <Row className="mb-1">
        <Button variant="ghost" onClick={() => setOpen(!open)}>
          {open ? "\u25be" : "\u25b8"} Scratchpad
        </Button>
      </Row>

      {open ? (
        <textarea
          rows={12}
          value={scratch}
          placeholder="park prompts here, nothing here is ever sent anywhere"
          onChange={(event) => store().setScratch(event.target.value)}
        />
      ) : null}
    </div>
  );
}

export function GeneratePanel() {
  const settings = useStudio((state) => state.settings);
  const promptBody = useStudio((state) => state.promptBody);
  const batches = useStudio((state) => state.batches);
  const folder = useStudio((state) => state.folder);
  const busy = useStudio((state) => state.busy);
  const hasApiKey = useStudio((state) => state.hasApiKey);
  const store = useStudio.getState;

  const [showPrompts, setShowPrompts] = useState(true);
  const [showModel, setShowModel] = useState(false);

  const generation = settings.generation;
  const processing = settings.processing;
  const model = modelOrDefault(generation.model);
  const snapped = generation.useAutoSize
    ? null
    : snapRequestSize(generation.size, generation.model);

  const composed = composePrompt({
    prefix: settings.promptPrefix,
    body: promptBody,
    suffix: settings.promptSuffix
  });

  return (
    <Panel
      title="Generate"
      actions={
        <Button
          variant="primary"
          disabled={busy !== null || !hasApiKey}
          onClick={() => void store().generate()}
        >
          {busy === "queueing" ? "queueing..." : `Create${batches > 1 ? ` x${batches}` : ""}`}
        </Button>
      }
    >
      {!hasApiKey ? (
        <p className="mb-3 rounded border border-amber-700 bg-amber-950/40 p-2 text-[11px] text-amber-200">
          No OpenAI key found. Add OPEN_AI_API_KEY to the .env file at the project root, then
          reload.
        </p>
      ) : null}

      <Field label="Prompt" hint={`${promptBody.length} chars`}>
        <textarea
          rows={5}
          value={promptBody}
          placeholder="a rusty steel footlocker, closed lid, worn paint"
          onChange={(event) => store().setPromptBody(event.target.value)}
        />
      </Field>

      <Scratchpad />

      <Row className="mb-2">
        <div className="flex-1">
          <Field label="Batches" hint="parallel jobs">
            <NumberInput
              value={batches}
              min={1}
              onChange={(value) => store().setBatches(value)}
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Images per job">
            <NumberInput
              value={generation.imageCount}
              min={1}
              onChange={(value) => store().setGeneration({ imageCount: Math.max(1, value) })}
            />
          </Field>
        </div>
      </Row>

      <Field label="Library folder" hint="optional">
        <input
          type="text"
          value={folder}
          placeholder="props/containers"
          onChange={(event) => store().setFolder(event.target.value)}
        />
      </Field>

      <Row>
        <div className="flex-1">
          <Field label="Asset width" hint="0 = from height">
            <NumberInput
              value={processing.targetSize.width}
              min={0}
              onChange={(value) =>
                store().setDefaultProcessing({
                  targetSize: { ...processing.targetSize, width: Math.max(0, Math.round(value)) }
                })
              }
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Asset height" hint="0 = from width">
            <NumberInput
              value={processing.targetSize.height}
              min={0}
              onChange={(value) =>
                store().setDefaultProcessing({
                  targetSize: { ...processing.targetSize, height: Math.max(0, Math.round(value)) }
                })
              }
            />
          </Field>
        </div>
      </Row>

      <Row className="mb-2 flex-wrap">
        {[16, 24, 32, 48, 64, 128, 256].map((height) => (
          <Button
            key={height}
            variant={
              processing.targetSize.height === height && processing.targetSize.width === 0
                ? "primary"
                : "ghost"
            }
            onClick={() => store().setDefaultProcessing({ targetSize: { width: 0, height } })}
          >
            {height}
          </Button>
        ))}
      </Row>

      <p className="mb-2 text-[10px] leading-snug text-slate-500">
        New assets get downsampled to this, keeping their aspect ratio. The raw{" "}
        {generation.useAutoSize ? "generated" : `${generation.size.width}px`} source is always kept,
        so you can change it per asset later in the inspector.
      </p>

      <Divider />

      <Row className="mb-2">
        <Button variant="ghost" onClick={() => setShowPrompts(!showPrompts)}>
          {showPrompts ? "\u25be" : "\u25b8"} Prefix and suffix
        </Button>
      </Row>

      {showPrompts ? (
        <>
          <Field label="Prefix" hint="prepended to every prompt">
            <textarea
              rows={4}
              value={settings.promptPrefix}
              onChange={(event) => store().patchSettings({ promptPrefix: event.target.value })}
            />
          </Field>

          <Field label="Suffix" hint="appended to every prompt">
            <textarea
              rows={2}
              value={settings.promptSuffix}
              onChange={(event) => store().patchSettings({ promptSuffix: event.target.value })}
            />
          </Field>

          <details className="mb-2">
            <summary className="cursor-pointer text-[11px] text-slate-400">
              Preview composed prompt
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-[var(--color-ink-800)] p-2 text-[10px] whitespace-pre-wrap text-slate-400">
              {composed || "(empty)"}
            </pre>
          </details>
        </>
      ) : null}

      <Divider />

      <TemplatePanel />

      <Divider />

      <Row className="mb-2">
        <Button variant="ghost" onClick={() => setShowModel(!showModel)}>
          {showModel ? "\u25be" : "\u25b8"} Model and size
        </Button>
      </Row>

      {showModel ? (
        <>
          <Field label="Model">
            <Select
              value={generation.model}
              options={modelIds()}
              onChange={(value) => store().setGeneration({ model: value })}
            />
          </Field>

          <Row>
            <div className="flex-1">
              <Field label="Quality">
                <Select
                  value={generation.quality}
                  options={["auto", "low", "medium", "high"] as const}
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

          <Toggle
            label="Let the model pick the size"
            checked={generation.useAutoSize}
            onChange={(value) => store().setGeneration({ useAutoSize: value })}
          />

          {!generation.useAutoSize ? (
            <Row>
              <div className="flex-1">
                <Field label="Request width">
                  <NumberInput
                    value={generation.size.width}
                    min={16}
                    step={16}
                    onChange={(value) =>
                      store().setGeneration({
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
                        size: { ...generation.size, height: Math.round(value) }
                      })
                    }
                  />
                </Field>
              </div>
            </Row>
          ) : null}

          {snapped ? (
            <p className="text-[10px] text-slate-500">
              The API will receive {snapped.width}x{snapped.height} after snapping to its edge and
              total-pixel rules.
            </p>
          ) : null}

          <Field label="Filename slug" hint="prefix for saved sources">
            <input
              type="text"
              value={settings.assetSlug}
              onChange={(event) => store().patchSettings({ assetSlug: event.target.value })}
            />
          </Field>

        </>
      ) : null}
    </Panel>
  );
}
