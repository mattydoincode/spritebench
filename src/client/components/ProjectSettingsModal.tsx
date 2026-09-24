"use client";

import { MAX_CHROMA_KEYS } from "@/core/settings";
import { CUTOUT_LABELS, CUTOUT_MODES } from "@/core/types";
import { useDoc } from "@/client/stores/doc";
import { useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";
import type { IsoLight } from "@/core/isoTemplate";
import type { ProjectCutoutPatch } from "@/shared/projectSettings";
import { IsoLightField } from "./IsoLightField";
import { IsoPitchField } from "./IsoPitchField";
import {
  Button,
  ColorInput,
  Field,
  Modal,
  Row,
  Select,
  Slider,
  TextButton,
  Toggle
} from "./ui";

function MethodHeading({
  active,
  children
}: {
  active: boolean;
  children: string;
}) {
  return (
    <h3
      className={`mb-2 mt-4 text-[10px] font-semibold tracking-widest uppercase ${
        active ? "text-slate-200" : "text-slate-500"
      }`}
    >
      {children}
      {active ? <span className="ml-2 font-normal text-slate-500">default</span> : null}
    </h3>
  );
}

export function ProjectSettingsModal() {
  const settings = useDoc((state) => state.settings);
  const role = useServer((state) => state.project?.role);
  const readOnly = role === "viewer";
  const cutout = settings.cutout;
  const patch = (next: ProjectCutoutPatch) => useDoc.getState().patchSettings({ cutout: next });
  const setIsoPitch = (isoPitch: number) => useDoc.getState().patchSettings({ isoPitch });
  const setIsoLight = (isoLight: IsoLight) => useDoc.getState().patchSettings({ isoLight });

  return (
    <Modal
      title="Project settings"
      width={520}
      onClose={() => useUi.getState().closeProjectSettings()}
    >
      <fieldset disabled={readOnly} className="min-w-0 disabled:opacity-60">
        <p className="mb-3 text-[11px] leading-snug text-slate-400">
          Cutout applies to new generations. Iso pitch and lighting are the
          defaults for the template builder; pitch also seeds iso repeaters.
        </p>

        <IsoPitchField
          label="Default iso"
          pitch={settings.isoPitch}
          onChange={setIsoPitch}
        />
        <IsoLightField
          label="Default light"
          light={settings.isoLight}
          onChange={setIsoLight}
        />

        {readOnly ? (
          <p className="mb-3 text-[11px] text-amber-300">Read only on this project.</p>
        ) : null}

        <Field label="Default cutout">
          <Select
            value={cutout.mode}
            options={CUTOUT_MODES}
            labels={CUTOUT_LABELS}
            onChange={(mode) => patch({ mode })}
          />
        </Field>

        <MethodHeading active={cutout.mode === "edgeFloodFill"}>
          flood fill from the edges
        </MethodHeading>
        <Field label="Tolerance" hint="how far a colour can stray">
          <Slider
            min={0}
            max={1}
            value={cutout.edgeFloodFill.cutoutTolerance}
            onChange={(cutoutTolerance) => patch({ edgeFloodFill: { cutoutTolerance } })}
          />
        </Field>
        <Field label="Local tolerance" hint="stops the fill at edges">
          <Slider
            min={0}
            max={1}
            value={cutout.edgeFloodFill.cutoutLocalTolerance}
            onChange={(cutoutLocalTolerance) => patch({ edgeFloodFill: { cutoutLocalTolerance } })}
          />
        </Field>
        <Field label="Skip cutout when the border is this transparent">
          <Slider
            min={0}
            max={1}
            value={cutout.edgeFloodFill.skipCutoutTransparentBorder}
            onChange={(skipCutoutTransparentBorder) =>
              patch({ edgeFloodFill: { skipCutoutTransparentBorder } })
            }
          />
        </Field>
        <Toggle
          label="Sample only the corners for the background colour"
          checked={cutout.edgeFloodFill.sampleCornersOnly}
          onChange={(sampleCornersOnly) => patch({ edgeFloodFill: { sampleCornersOnly } })}
        />

        <MethodHeading active={cutout.mode === "chromaKey"}>chroma key colours</MethodHeading>
        <Field label="Tolerance" hint="how far a colour can stray">
          <Slider
            min={0}
            max={1}
            value={cutout.chromaKey.cutoutTolerance}
            onChange={(cutoutTolerance) => patch({ chromaKey: { cutoutTolerance } })}
          />
        </Field>
        <div className="mb-2">
          <span className="mb-1 block text-[11px] uppercase tracking-wide text-slate-400">
            Key colours
          </span>
          {cutout.chromaKey.chromaKeys.map((colour, index) => (
            <Row key={index} className="mb-1">
              <ColorInput
                value={colour}
                fallback="#ff00ff"
                onChange={(value) => {
                  const chromaKeys = cutout.chromaKey.chromaKeys.slice();
                  chromaKeys[index] = value;
                  patch({ chromaKey: { chromaKeys } });
                }}
              />
              <TextButton
                danger
                title="Remove this key colour"
                onClick={() =>
                  patch({
                    chromaKey: {
                      chromaKeys: cutout.chromaKey.chromaKeys.filter((_, at) => at !== index)
                    }
                  })
                }
              >
                remove
              </TextButton>
            </Row>
          ))}
          <Button
            className="w-full"
            disabled={cutout.chromaKey.chromaKeys.length >= MAX_CHROMA_KEYS}
            title="Add another colour to punch out"
            onClick={() =>
              patch({
                chromaKey: {
                  chromaKeys: [
                    ...cutout.chromaKey.chromaKeys,
                    cutout.chromaKey.chromaKeys.at(-1) ?? "#ff00ff"
                  ]
                }
              })
            }
          >
            add colour
          </Button>
        </div>

        <MethodHeading
          active={cutout.mode === "luminanceAbove" || cutout.mode === "luminanceBelow"}
        >
          luminance
        </MethodHeading>
        <Field label="Luminance threshold">
          <Slider
            min={0}
            max={1}
            value={cutout.luminance.cutoutLuminanceThreshold}
            onChange={(cutoutLuminanceThreshold) =>
              patch({ luminance: { cutoutLuminanceThreshold } })
            }
          />
        </Field>

        <h3 className="mb-2 mt-4 text-[10px] font-semibold tracking-widest text-slate-500 uppercase">
          every new asset
        </h3>
        <Toggle
          label="Snap alpha to fully on or off"
          checked={cutout.snapAlpha}
          onChange={(snapAlpha) => patch({ snapAlpha })}
        />
        <Field label="Alpha threshold">
          <Slider
            min={0}
            max={1}
            value={cutout.alphaThreshold}
            onChange={(alphaThreshold) => patch({ alphaThreshold })}
          />
        </Field>
        <Toggle
          label="Trim to content"
          checked={cutout.trimToContent}
          disabled={cutout.clipToIso}
          onChange={(trimToContent) => patch({ trimToContent })}
        />
        <Toggle
          label="Clip to iso diamond"
          checked={cutout.clipToIso}
          onChange={(clipToIso) => patch({ clipToIso })}
        />
      </fieldset>
    </Modal>
  );
}
