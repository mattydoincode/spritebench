"use client";

import { useEffect, useRef, useState } from "react";
import { useStudio } from "@/client/store";
import { MASK_SOURCES, TEMPLATE_FIT_MODES } from "@/core/types";
import { Button, Field, NumberInput, Row, Select, Slider, Toggle } from "./ui";

const MASK_LABELS: Record<string, string> = {
  alphaFromTemplate: "edit where template is transparent",
  transparentWhereDark: "edit the dark strokes",
  transparentWhereLight: "edit the light areas",
  keepInsideShape: "edit inside the drawn shape",
  keepOutsideShape: "protect the shape, edit around it"
};

export function TemplatePanel() {
  const template = useStudio((state) => state.template);
  const templates = useStudio((state) => state.templates);
  const settings = useStudio((state) => state.settings);
  const busy = useStudio((state) => state.busy);
  const store = useStudio.getState;

  const [showAlpha, setShowAlpha] = useState(false);
  const dropRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

      const file = [...(event.clipboardData?.items ?? [])]
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .find((entry): entry is File => entry !== null);

      if (!file) return;

      event.preventDefault();
      void store().uploadTemplate(file);
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [store]);

  const current = templates.find((entry) => entry.file === template?.file) ?? null;

  return (
    <div>
      <Row className="mb-2 justify-between">
        <span className="text-[11px] uppercase tracking-wide text-slate-400">Template</span>
        {template ? (
          <Button variant="ghost" onClick={() => store().setTemplate(null)}>
            use text only
          </Button>
        ) : null}
      </Row>

      <div
        ref={dropRef}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file) void store().uploadTemplate(file);
        }}
        className="mb-2 rounded border border-dashed border-[var(--color-edge)] p-3 text-center text-[11px] text-slate-500"
      >
        {busy === "saving template"
          ? "processing template..."
          : "paste a sketch (Ctrl+V) or drop a PNG here"}
      </div>

      <Toggle
        label="Remove the white background on paste"
        checked={settings.cutTemplateBackgroundOnPaste}
        onChange={(value) => store().patchSettings({ cutTemplateBackgroundOnPaste: value })}
      />

      {settings.cutTemplateBackgroundOnPaste ? (
        <Field label="Paste cut tolerance">
          <Slider
            min={0}
            max={1}
            value={settings.templateCutTolerance}
            onChange={(value) => store().patchSettings({ templateCutTolerance: value })}
          />
        </Field>
      ) : null}

      {templates.length > 0 ? (
        <Field label="Saved templates">
          <Select
            value={template?.file ?? ""}
            options={["", ...templates.map((entry) => entry.file)] as const}
            labels={{ "": "(none)" }}
            onChange={(value) => {
              if (!value) {
                store().setTemplate(null);
                return;
              }

              store().setTemplate({
                file: value,
                fit: template?.fit ?? "contain",
                maskSource: template?.maskSource ?? "keepOutsideShape",
                matchAspect: template?.matchAspect ?? true,
                dilatePixels: template?.dilatePixels ?? 0,
                useAsMask: template?.useAsMask ?? true
              });
            }}
          />
        </Field>
      ) : null}

      {template && current ? (
        <>
          <div className="checkerboard mb-2 flex items-center justify-center rounded p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={template.file}
              src={`/api/templates/file?file=${encodeURIComponent(template.file)}&alpha=${showAlpha}`}
              style={{ maxHeight: 140, imageRendering: "pixelated" }}
            />
          </div>

          <Row className="mb-2 justify-between">
            <span className="text-[10px] text-slate-500">
              {current.width}x{current.height}
            </span>
            <Row>
              <Button variant="ghost" onClick={() => setShowAlpha(!showAlpha)}>
                {showAlpha ? "show colour" : "show alpha"}
              </Button>
              <Button
                variant="danger"
                onClick={() => void store().deleteTemplate(template.file)}
              >
                delete
              </Button>
            </Row>
          </Row>

          <Toggle
            label="Send as a mask to images/edits"
            checked={template.useAsMask}
            onChange={(value) => store().setTemplate({ ...template, useAsMask: value })}
          />

          <Field label="Fit" hint="how the sketch maps onto the request size">
            <Select
              value={template.fit}
              options={TEMPLATE_FIT_MODES}
              onChange={(value) => store().setTemplate({ ...template, fit: value })}
            />
          </Field>

          {template.useAsMask ? (
            <>
              <Field label="Editable region">
                <Select
                  value={template.maskSource}
                  options={MASK_SOURCES}
                  labels={MASK_LABELS}
                  onChange={(value) => store().setTemplate({ ...template, maskSource: value })}
                />
              </Field>

              <Field label="Grow editable region" hint="pixels">
                <NumberInput
                  value={template.dilatePixels}
                  min={0}
                  onChange={(value) =>
                    store().setTemplate({ ...template, dilatePixels: Math.max(0, value) })
                  }
                />
              </Field>
            </>
          ) : null}

          <Toggle
            label="Match the request aspect to the sketch"
            checked={template.matchAspect}
            onChange={(value) => store().setTemplate({ ...template, matchAspect: value })}
          />

          <p className="text-[10px] leading-snug text-slate-500">
            A mask guides the model, it is not a hard stencil. Expect the silhouette to be
            approximate.
          </p>
        </>
      ) : null}
    </div>
  );
}
