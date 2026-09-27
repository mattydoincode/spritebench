"use client";

import { MAX_CHROMA_KEYS } from "@/core/settings";
import { providerLabel } from "@/providers/models";
import { CUTOUT_LABELS, CUTOUT_MODES } from "@/core/types";
import { useDoc } from "@/client/stores/doc";
import { useServer } from "@/client/stores/server";
import { useUi, type SettingsTab } from "@/client/stores/ui";
import type { IsoLight } from "@/core/isoTemplate";
import type { ProjectCutoutPatch } from "@/shared/projectSettings";
import { AccountSettingsSections } from "./AccountSettings";
import { ProjectAccess } from "./ProjectAccess";
import { IsoLightField } from "./IsoLightField";
import { IsoPitchField } from "./IsoPitchField";
import {
  Button,
  ColorInput,
  Field,
  Modal,
  Row,
  Select,
  PanelTab,
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

/**
 * One settings dialog for the studio: who has this project (the default tab,
 * like a Share dialog), the project's defaults, and your account (keys,
 * machine, tokens). The Project and Account tabs are the same components the
 * dashboard uses, so neither drifts.
 */
export function SettingsModal() {
  const tab = useUi((state) => state.settingsTab) ?? "project";
  const projectId = useServer((state) => state.project?.id ?? null);
  const setTab = (next: SettingsTab) => useUi.getState().openSettings(next);

  return (
    <Modal
      title="Settings"
      width={720}
      pinTop
      tabs={
        <>
          <PanelTab selected={tab === "project"} onClick={() => setTab("project")}>
            Project
          </PanelTab>
          <PanelTab selected={tab === "defaults"} onClick={() => setTab("defaults")}>
            Defaults
          </PanelTab>
          <PanelTab selected={tab === "account"} onClick={() => setTab("account")}>
            Account &amp; keys
          </PanelTab>
        </>
      }
      onClose={() => useUi.getState().closeSettings()}
    >
      {tab === "account" ? (
        <div className="page-shell p-2">
          <AccountSettingsSections />
        </div>
      ) : tab === "defaults" ? (
        <ProjectSettings />
      ) : projectId ? (
        <div className="page-shell p-2">
          <ProjectAccess projectId={projectId} />
        </div>
      ) : null}
    </Modal>
  );
}

/**
 * Which of the owner's keys this project bills, per provider. Only providers
 * with a key are listed; "account default" follows whatever the owner marks
 * as default in their account. Owner only -- everyone else sees it read-only.
 */
function BillingDefaults() {
  const project = useServer((state) => state.project);
  const keys = useServer((state) => state.projectKeys);
  const keyDefaults = useServer((state) => state.keyDefaults);

  const providers = [...new Set(keys.map((key) => key.provider))];
  const caption = (key: (typeof keys)[number]) =>
    `${key.label || "unlabelled"} …${key.keySuffix.replace(/^\.\.\./, "")}`;

  return (
    <>
      <MethodHeading active={false}>billing</MethodHeading>
      {providers.length === 0 ? (
        <p className="mb-3 text-[11px] text-slate-500">
          No keys yet.{" "}
          {project?.isOwner ? (
            <button
              type="button"
              onClick={() => useUi.getState().openSettings("account")}
              className="underline"
            >
              Add one
            </button>
          ) : null}
        </p>
      ) : (
        providers.map((provider) => {
          const options = keys.filter((key) => key.provider === provider);
          const fallback = options.find((key) => key.isDefault);

          return (
            <Field key={provider} label={providerLabel(provider)}>
              <select
                value={keyDefaults[provider] ?? ""}
                disabled={!project?.isOwner}
                title={project?.isOwner ? undefined : "Only the owner can change which key pays"}
                onChange={(event) =>
                  void useServer
                    .getState()
                    .setProjectKeyDefault(provider, event.target.value || null)
                }
              >
                <option value="">
                  {fallback
                    ? `Account default (${caption(fallback)})`
                    : options.length === 1
                      ? `Only key (${caption(options[0])})`
                      : "Account default (none set)"}
                </option>
                {options.map((key) => (
                  <option key={key.id} value={key.id}>
                    {caption(key)}
                  </option>
                ))}
              </select>
            </Field>
          );
        })
      )}
    </>
  );
}

function ProjectSettings() {
  const settings = useDoc((state) => state.settings);
  const role = useServer((state) => state.project?.role);
  const readOnly = role === "viewer";
  const cutout = settings.cutout;
  const patch = (next: ProjectCutoutPatch) => useDoc.getState().patchSettings({ cutout: next });
  const setIsoPitch = (isoPitch: number) => useDoc.getState().patchSettings({ isoPitch });
  const setIsoLight = (isoLight: IsoLight) => useDoc.getState().patchSettings({ isoLight });

  return (
    <fieldset disabled={readOnly} className="min-w-0 disabled:opacity-60">
      <BillingDefaults />

      <MethodHeading active={false}>defaults</MethodHeading>
      <p className="mb-3 text-[11px] leading-snug text-slate-400">
        Defaults for new generations and templates.
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
  );
}
