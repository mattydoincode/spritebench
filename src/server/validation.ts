import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CUTOUT_MODES,
  DISTANCE_MODES,
  DITHER_MODES,
  MASK_SOURCES,
  ORIENTATIONS,
  PIXELATE_MODES,
  TEMPLATE_FIT_MODES
} from "@/core/types";
import { findModel, modelIds } from "@/providers/models";

const size = z.object({
  width: z.number().finite(),
  height: z.number().finite()
});

const crop = z.object({
  kind: z.literal("crop"),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite()
});

/**
 * Processing settings arrive from the client on nearly every write. Parsed
 * loosely on purpose: `withDefaults()` still runs afterwards and fills gaps,
 * so the job here is rejecting hostile shapes, not enforcing completeness.
 */
export const processingSchema = z
  .object({
    edits: z.array(crop),
    orientation: z.enum(ORIENTATIONS),
    flipHorizontal: z.boolean(),
    flipVertical: z.boolean(),
    cutout: z.enum(CUTOUT_MODES),
    chromaKey: z.string().regex(/^#?[0-9a-fA-F]{3,8}$/),
    cutoutTolerance: z.number().min(0).max(1),
    cutoutLocalTolerance: z.number().min(0).max(1),
    cutoutLuminanceThreshold: z.number().min(0).max(1),
    skipCutoutTransparentBorder: z.number().min(0).max(1),
    sampleCornersOnly: z.boolean(),
    despeckleMinimumNeighbors: z.number().int().min(0).max(8),
    fillHoles: z.boolean(),
    erodePixels: z.number().int().min(0).max(64),
    trimToContent: z.boolean(),
    trimPadding: z.number().int().min(0).max(512),
    targetSize: size,
    pixelate: z.enum(PIXELATE_MODES),
    snapAlpha: z.boolean(),
    alphaThreshold: z.number().min(0).max(1),
    paletteFile: z.string().max(255),
    dither: z.enum(DITHER_MODES),
    ditherStrength: z.number().min(0).max(4),
    distanceMode: z.enum(DISTANCE_MODES)
  })
  .partial();

/**
 * The model is checked against the capability registry rather than accepted as
 * free text, so an unknown model is refused here instead of after the user has
 * waited for the provider to reject it.
 */
export const generationSchema = z
  .object({
    model: z.string().refine((value) => findModel(value) !== null, {
      message: `must be one of ${modelIds().join(", ")}`
    }),
    quality: z.enum(["auto", "low", "medium", "high"]),
    background: z.enum(["auto", "transparent", "opaque"]),
    moderation: z.enum(["auto", "low"]),
    size,
    useAutoSize: z.boolean(),
    imageCount: z.number().int().min(1).max(10)
  })
  .partial()
  .refine(
    (value) =>
      value.model === undefined ||
      value.imageCount === undefined ||
      value.imageCount <= (findModel(value.model)?.maxImagesPerRequest ?? 10),
    { message: "imageCount is above what this model accepts per request", path: ["imageCount"] }
  );

export const templateSpecSchema = z.object({
  file: z.string().min(1).max(255),
  fit: z.enum(TEMPLATE_FIT_MODES),
  maskSource: z.enum(MASK_SOURCES),
  matchAspect: z.boolean(),
  dilatePixels: z.number().int().min(0).max(256),
  useAsMask: z.boolean()
});

export const generateBodySchema = z.object({
  promptBody: z.string().trim().min(1).max(8000),
  promptPrefix: z.string().max(8000).optional(),
  promptSuffix: z.string().max(8000).optional(),
  generation: generationSchema.optional(),
  processing: processingSchema.optional(),
  folder: z.string().max(255).optional(),
  template: templateSpecSchema.nullish(),
  label: z.string().max(255).optional(),
  batches: z.number().int().min(1).max(20).optional(),
  remember: z.boolean().optional()
});

export const rerunBodySchema = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(100),
  promptPrefix: z.string().max(8000).optional(),
  promptSuffix: z.string().max(8000).optional(),
  useStoredGeneration: z.boolean().optional(),
  useStoredProcessing: z.boolean().optional()
});

export const approveBodySchema = z.object({
  assetId: z.string().uuid(),
  name: z.string().max(255).optional(),
  subfolder: z.string().max(255).optional()
});

export const assetPatchSchema = z.object({
  name: z.string().max(255).optional(),
  folder: z.string().max(255).optional(),
  tags: z.array(z.string().max(64)).max(64).optional(),
  processing: processingSchema.optional(),
  approvedName: z.string().max(255).nullish()
});

export const settingsPatchSchema = z.object({
  promptPrefix: z.string().max(8000).optional(),
  promptSuffix: z.string().max(8000).optional(),
  assetSlug: z.string().max(120).optional(),
  generation: generationSchema.optional(),
  processing: processingSchema.optional(),
  activeCompositionId: z.string().uuid().nullish(),
  cutTemplateBackgroundOnPaste: z.boolean().optional(),
  templateCutTolerance: z.number().min(0).max(1).optional()
});

const stagedItemSchema = z.object({
  id: z.string().min(1).max(64),
  assetId: z.string().min(1).max(64),
  x: z.number().finite(),
  y: z.number().finite(),
  footprint: size,
  zIndex: z.number().finite(),
  flipHorizontal: z.boolean(),
  flipVertical: z.boolean(),
  showSource: z.boolean(),
  opacity: z.number().min(0).max(1)
});

const repeatGroupSchema = z.object({
  id: z.string().min(1).max(64),
  assetIds: z.array(z.string().min(1).max(64)).max(500),
  x: z.number().finite(),
  y: z.number().finite(),
  cell: size,
  marginX: z.number().finite(),
  marginY: z.number().finite(),
  countX: z.number().int().min(0).max(1000),
  countY: z.number().int().min(0).max(1000),
  fillX: z.boolean(),
  fillY: z.boolean(),
  // Added after the first compositions were saved, so absent in older documents.
  randomRotate: z.boolean().default(false),
  background: z.string().max(255).default(""),
  zIndex: z.number().finite(),
  opacity: z.number().min(0).max(1),
  seed: z.number().finite()
});

export const compositionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  updatedAt: z.string().max(64).default(""),
  unitsPerCell: z.number().positive().finite(),
  camera: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    zoom: z.number().positive().finite()
  }),
  items: z.array(stagedItemSchema).max(5000),
  groups: z.array(repeatGroupSchema).max(500),
  palettePool: z.array(z.string().max(255)).max(64),
  palette: z.string().max(255),
  paletteDither: z.enum(DITHER_MODES),
  paletteDitherStrength: z.number().min(0).max(4),
  version: z.number().int().min(0).optional()
});

export const providerKeyBodySchema = z.object({
  provider: z.enum(["openai"]),
  key: z.string().trim().min(8).max(500)
});

export class ValidationError extends Error {
  constructor(readonly issues: z.ZodIssue[]) {
    super("invalid request body");
    this.name = "ValidationError";
  }
}

/** Parses a JSON body, or throws ValidationError. */
export async function parseBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ValidationError([
      { code: "custom", path: [], message: "body must be valid JSON" } as z.ZodIssue
    ]);
  }

  const result = schema.safeParse(raw);
  if (!result.success) throw new ValidationError(result.error.issues);

  return result.data;
}

export function validationResponse(error: ValidationError): NextResponse {
  return NextResponse.json(
    {
      error: error.issues
        .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
        .join("; ")
    },
    { status: 400 }
  );
}

/** Wraps a handler so ValidationError becomes a 400 instead of a 500. */
export async function withValidation(
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ValidationError) return validationResponse(error);
    throw error;
  }
}
