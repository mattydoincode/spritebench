import { clampIsoPitch, DIMETRIC_PITCH } from "@/core/iso";
import { clampIsoLight, DEFAULT_ISO_LIGHT, type IsoLight } from "@/core/isoTemplate";
import { DEFAULT_PROCESSING, MAX_CHROMA_KEYS, withDefaults, type ProcessingSettings } from "@/core/settings";
import { CUTOUT_MODES, type CutoutMode } from "@/core/types";

export interface FloodFillCutoutDefaults {
  cutoutTolerance: number;
  cutoutLocalTolerance: number;
  skipCutoutTransparentBorder: number;
  sampleCornersOnly: boolean;
}

export interface ChromaKeyCutoutDefaults {
  chromaKeys: string[];
  cutoutTolerance: number;
}

export interface LuminanceCutoutDefaults {
  cutoutLuminanceThreshold: number;
}

export interface ProjectCutoutSettings {
  mode: CutoutMode;
  edgeFloodFill: FloodFillCutoutDefaults;
  chromaKey: ChromaKeyCutoutDefaults;
  luminance: LuminanceCutoutDefaults;
  snapAlpha: boolean;
  alphaThreshold: number;
  trimToContent: boolean;
  clipToIso: boolean;
}

export interface ProjectSettings {
  cutout: ProjectCutoutSettings;
  isoPitch: number;
  isoLight: IsoLight;
}

export interface ProjectCutoutPatch {
  mode?: CutoutMode;
  snapAlpha?: boolean;
  alphaThreshold?: number;
  trimToContent?: boolean;
  clipToIso?: boolean;
  edgeFloodFill?: Partial<FloodFillCutoutDefaults>;
  chromaKey?: Partial<ChromaKeyCutoutDefaults>;
  luminance?: Partial<LuminanceCutoutDefaults>;
}

export interface ProjectSettingsPatch {
  cutout?: ProjectCutoutPatch;
  isoPitch?: number;
  isoLight?: IsoLight;
}

export const DEFAULT_PROJECT_CUTOUT: ProjectCutoutSettings = {
  mode: DEFAULT_PROCESSING.cutout,
  edgeFloodFill: {
    cutoutTolerance: DEFAULT_PROCESSING.cutoutTolerance,
    cutoutLocalTolerance: DEFAULT_PROCESSING.cutoutLocalTolerance,
    skipCutoutTransparentBorder: DEFAULT_PROCESSING.skipCutoutTransparentBorder,
    sampleCornersOnly: DEFAULT_PROCESSING.sampleCornersOnly
  },
  chromaKey: {
    chromaKeys: [...DEFAULT_PROCESSING.chromaKeys],
    cutoutTolerance: DEFAULT_PROCESSING.cutoutTolerance
  },
  luminance: {
    cutoutLuminanceThreshold: DEFAULT_PROCESSING.cutoutLuminanceThreshold
  },
  snapAlpha: DEFAULT_PROCESSING.snapAlpha,
  alphaThreshold: DEFAULT_PROCESSING.alphaThreshold,
  trimToContent: DEFAULT_PROCESSING.trimToContent,
  clipToIso: DEFAULT_PROCESSING.clipToIso
};

export const DEFAULT_ISO_PITCH = DIMETRIC_PITCH;

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  cutout: cloneCutout(DEFAULT_PROJECT_CUTOUT),
  isoPitch: DEFAULT_ISO_PITCH,
  isoLight: DEFAULT_ISO_LIGHT
};

function cloneCutout(cutout: ProjectCutoutSettings): ProjectCutoutSettings {
  return {
    ...cutout,
    edgeFloodFill: { ...cutout.edgeFloodFill },
    chromaKey: {
      ...cutout.chromaKey,
      chromaKeys: [...cutout.chromaKey.chromaKeys]
    },
    luminance: { ...cutout.luminance }
  };
}

function clamp01(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function mode(value: unknown, fallback: CutoutMode): CutoutMode {
  return typeof value === "string" && (CUTOUT_MODES as readonly string[]).includes(value)
    ? (value as CutoutMode)
    : fallback;
}

function chromaKeys(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .slice(0, MAX_CHROMA_KEYS);
}

export function withProjectCutout(partial?: ProjectCutoutPatch | null): ProjectCutoutSettings {
  const from = partial ?? {};
  const flood = from.edgeFloodFill ?? {};
  const chroma = from.chromaKey ?? {};
  const lum = from.luminance ?? {};
  const base = DEFAULT_PROJECT_CUTOUT;

  return {
    mode: mode(from.mode, base.mode),
    edgeFloodFill: {
      cutoutTolerance: clamp01(flood.cutoutTolerance, base.edgeFloodFill.cutoutTolerance),
      cutoutLocalTolerance: clamp01(
        flood.cutoutLocalTolerance,
        base.edgeFloodFill.cutoutLocalTolerance
      ),
      skipCutoutTransparentBorder: clamp01(
        flood.skipCutoutTransparentBorder,
        base.edgeFloodFill.skipCutoutTransparentBorder
      ),
      sampleCornersOnly: bool(flood.sampleCornersOnly, base.edgeFloodFill.sampleCornersOnly)
    },
    chromaKey: {
      chromaKeys: chromaKeys(chroma.chromaKeys, base.chromaKey.chromaKeys),
      cutoutTolerance: clamp01(chroma.cutoutTolerance, base.chromaKey.cutoutTolerance)
    },
    luminance: {
      cutoutLuminanceThreshold: clamp01(
        lum.cutoutLuminanceThreshold,
        base.luminance.cutoutLuminanceThreshold
      )
    },
    snapAlpha: bool(from.snapAlpha, base.snapAlpha),
    alphaThreshold: clamp01(from.alphaThreshold, base.alphaThreshold),
    trimToContent: bool(from.trimToContent, base.trimToContent),
    clipToIso: bool(from.clipToIso, base.clipToIso)
  };
}

export function withProjectSettings(
  partial?: { cutout?: ProjectCutoutPatch | null; isoPitch?: number; isoLight?: unknown } | null
): ProjectSettings {
  return {
    cutout: withProjectCutout(partial?.cutout),
    isoPitch: clampIsoPitch(
      typeof partial?.isoPitch === "number" ? partial.isoPitch : DEFAULT_ISO_PITCH
    ),
    isoLight: clampIsoLight(partial?.isoLight)
  };
}

/** The processing fields a new asset gets from the project's cutout defaults. */
export function cutoutProcessingPatch(cutout: ProjectCutoutSettings): Partial<ProcessingSettings> {
  const shared: Partial<ProcessingSettings> = {
    cutout: cutout.mode,
    snapAlpha: cutout.snapAlpha,
    alphaThreshold: cutout.alphaThreshold,
    trimToContent: cutout.trimToContent,
    clipToIso: cutout.clipToIso
  };

  if (cutout.mode === "edgeFloodFill") {
    return {
      ...shared,
      cutoutTolerance: cutout.edgeFloodFill.cutoutTolerance,
      cutoutLocalTolerance: cutout.edgeFloodFill.cutoutLocalTolerance,
      skipCutoutTransparentBorder: cutout.edgeFloodFill.skipCutoutTransparentBorder,
      sampleCornersOnly: cutout.edgeFloodFill.sampleCornersOnly
    };
  }

  if (cutout.mode === "chromaKey") {
    return {
      ...shared,
      chromaKeys: [...cutout.chromaKey.chromaKeys],
      cutoutTolerance: cutout.chromaKey.cutoutTolerance
    };
  }

  if (cutout.mode === "luminanceAbove" || cutout.mode === "luminanceBelow") {
    return {
      ...shared,
      cutoutLuminanceThreshold: cutout.luminance.cutoutLuminanceThreshold
    };
  }

  return shared;
}

export function applyProjectCutout(
  processing: ProcessingSettings,
  settings: ProjectSettings
): ProcessingSettings {
  return { ...processing, ...cutoutProcessingPatch(settings.cutout) };
}

/**
 * What a new generation is processed with: the caller's working defaults,
 * then any request overrides, then the project's cutout. Cutout wins so a
 * remembered personal setting cannot outrank the project.
 */
export function processingForNewAsset(
  userProcessing: ProcessingSettings,
  project: ProjectSettings,
  request?: Partial<ProcessingSettings> | null
): ProcessingSettings {
  return applyProjectCutout(withDefaults({ ...userProcessing, ...(request ?? {}) }), project);
}
