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
import { findModel, modelIds, providerIds } from "@/providers/models";
import { IMAGE_QUALITIES } from "@/shared/model";
import { ForbiddenError, UnauthorizedError } from "./errors";

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

const pixelGrid = z.object({
  kind: z.literal("pixelGrid"),
  columns: z.number().int().min(1).max(512),
  rows: z.number().int().min(1).max(512),
  canvasWidth: z.number().int().min(1).max(8192).optional(),
  canvasHeight: z.number().int().min(1).max(8192).optional(),
  originX: z.number().int().min(0).max(8192).optional(),
  originY: z.number().int().min(0).max(8192).optional(),
  cell: z.number().int().min(1).max(8192).optional()
});

/**
 * Processing settings arrive from the client on nearly every write. Parsed
 * loosely on purpose: `withDefaults()` still runs afterwards and fills gaps,
 * so the job here is rejecting hostile shapes, not enforcing completeness.
 */
export const processingSchema = z
  .object({
    edits: z.array(z.union([crop, pixelGrid])),
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
    paletteId: z.string().max(64),
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
    quality: z.enum(IMAGE_QUALITIES),
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
  )
  .refine(
    (value) => {
      if (value.model === undefined || value.quality === undefined) return true;
      const model = findModel(value.model);
      return model === null || !model.supportsQuality || model.qualities.includes(value.quality);
    },
    { message: "quality is not supported by this model", path: ["quality"] }
  );

/**
 * The grid an animation sheet was asked for. Bounds are generous on purpose:
 * this is a note about what the prompt described, not something the server
 * acts on, and the slicer lets you override all of it anyway.
 */
export const sequencePlanSchema = z.object({
  columns: z.number().int().min(1).max(32),
  rows: z.number().int().min(1).max(32),
  fps: z.number().int().min(1).max(60),
  kind: z.enum(["animation", "set"]).optional(),
  actions: z
    .array(
      z.object({
        name: z.string().max(255),
        frames: z.number().int().min(1).max(32)
      })
    )
    .min(1)
    .max(32)
});

const imageSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("template"), templateId: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("asset"), assetId: z.string().uuid() })
]);

export const baseSpecSchema = z.object({
  source: imageSourceSchema,
  fit: z.enum(TEMPLATE_FIT_MODES),
  matchAspect: z.boolean()
});

export const maskSpecSchema = z.object({
  source: imageSourceSchema,
  maskSource: z.enum(MASK_SOURCES),
  dilatePixels: z.number().int().min(0).max(256),
  fit: z.enum(TEMPLATE_FIT_MODES),
  window: z
    .object({
      width: z.number().int().min(1).max(512),
      height: z.number().int().min(1).max(512)
    })
    .optional()
});

const rectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite()
});

const loopRequestSchema = z.object({
  steps: z.number().int().min(2).max(20)
});

const loopJobSchema = z.object({
  steps: z.number().int().min(1).max(20),
  index: z.number().int().min(1).max(20)
});

const chunkRequestSchema = z.object({
  columns: z.number().int().min(1).max(16),
  rows: z.number().int().min(1).max(16)
});

const chunkJobSchema = chunkRequestSchema.extend({
  index: z.number().int().min(0).max(256),
  rect: rectSchema
});

export const jobInputsSchema = z.object({
  base: baseSpecSchema.nullish(),
  mask: maskSpecSchema.nullish(),
  loop: z.union([loopJobSchema, loopRequestSchema]).nullish(),
  chunk: z.union([chunkJobSchema, chunkRequestSchema]).nullish()
});

export const generateBodySchema = z.object({
  promptBody: z.string().trim().min(1).max(8000),
  promptPrefix: z.string().max(8000).optional(),
  promptSuffix: z.string().max(8000).optional(),
  promptGuide: z.string().max(8000).optional(),
  promptExtra: z.string().max(8000).optional(),
  /** Which of the owner's keys to bill. Validated against the project. */
  providerKeyId: z.string().uuid().nullish(),
  generation: generationSchema.optional(),
  processing: processingSchema.optional(),
  folder: z.string().max(255).optional(),
  inputs: jobInputsSchema.nullish(),
  sequencePlan: sequencePlanSchema.nullish(),
  label: z.string().max(255).optional(),
  batches: z.number().int().min(1).max(20).optional(),
  variables: z
    .array(
      z.object({
        name: z
          .string()
          .trim()
          .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be a slot name like color"),
        values: z.string().max(2000)
      })
    )
    .max(20)
    .optional(),
  remember: z.boolean().optional()
});

export const rerunBodySchema = z.object({
  assetIds: z.array(z.string().uuid()).min(1).max(100),
  promptPrefix: z.string().max(8000).optional(),
  promptSuffix: z.string().max(8000).optional(),
  providerKeyId: z.string().uuid().nullish(),
  useStoredGeneration: z.boolean().optional(),
  useStoredProcessing: z.boolean().optional(),
  folder: z.string().max(255).optional()
});

export const approveBodySchema = z.object({
  assetId: z.string().uuid(),
  /** Overrides the name the export is filed under. Optional. */
  name: z.string().max(255).optional(),
  subfolder: z.string().max(255).optional()
});

/**
 * Editable asset fields now live in the project's Yjs document, so the only
 * thing left to PATCH on the row is nothing -- the route exists solely to
 * soft-delete. Kept as a schema so a stray body is rejected rather than
 * silently ignored.
 */
export const assetPatchSchema = z.object({});

export const settingsPatchSchema = z.object({
  generation: generationSchema.optional(),
  processing: processingSchema.optional(),
  cutTemplateBackgroundOnPaste: z.boolean().optional(),
  templateCutTolerance: z.number().min(0).max(1).optional()
});

export const projectBodySchema = z.object({
  name: z.string().trim().min(1).max(120)
});

const PROVIDER_ID_VALUES = providerIds() as [string, ...string[]];

export const providerKeyBodySchema = z.object({
  provider: z.enum(PROVIDER_ID_VALUES),
  label: z.string().trim().max(120).optional(),
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

/**
 * Wraps a handler so the three "the caller got it wrong" errors become the
 * status they mean instead of a 500.
 *
 * Authorization throws rather than returning a union precisely so that it can
 * be caught here: a handler cannot forget to check something that aborts.
 */
export async function withValidation(
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof ValidationError) return validationResponse(error);

    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }
}
