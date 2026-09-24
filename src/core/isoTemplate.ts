import {
  DIMETRIC_PITCH,
  clampIsoTemplatePitch,
  isoDiamondRatioForPitch
} from "./iso";
import { pointInIsoDiamond } from "./isoMask";
import { createImage, toByte } from "./pixels";
import type { Rgb, RgbaImage } from "./types";

export const ISO_TEMPLATE_SHAPES = [
  "diamond",
  "prism",
  "sphere",
  "intersection",
  "building"
] as const;
export type IsoTemplateShape = (typeof ISO_TEMPLATE_SHAPES)[number];

export const ISO_LIGHTS = ["nw", "ne", "se", "sw"] as const;
export type IsoLight = (typeof ISO_LIGHTS)[number];
export const DEFAULT_ISO_LIGHT: IsoLight = "nw";

export const ISO_TEMPLATE_YAWS = [45, 0] as const;
export type IsoTemplateYaw = (typeof ISO_TEMPLATE_YAWS)[number];
export const DEFAULT_ISO_TEMPLATE_YAW: IsoTemplateYaw = 45;

export function clampIsoTemplateYaw(value: unknown): IsoTemplateYaw {
  return value === 0 ? 0 : 45;
}

export function clampIsoLight(value: unknown): IsoLight {
  return typeof value === "string" && (ISO_LIGHTS as readonly string[]).includes(value)
    ? (value as IsoLight)
    : DEFAULT_ISO_LIGHT;
}

export const ISO_TEMPLATE_SHAPE_LABELS: Record<IsoTemplateShape, string> = {
  diamond: "diamond",
  prism: "prism",
  sphere: "sphere",
  intersection: "intersection",
  building: "building"
};

export const ISO_LIGHT_LABELS: Record<IsoLight, string> = {
  nw: "NW",
  ne: "NE",
  se: "SE",
  sw: "SW"
};

export const ISO_TEMPLATE_FILL: Rgb = { r: 168, g: 156, b: 142 };
export const ISO_TEMPLATE_TOP: Rgb = { r: 214, g: 206, b: 190 };
export const ISO_TEMPLATE_LOT: Rgb = { r: 230, g: 209, b: 168 };
export const ISO_TEMPLATE_ROAD: Rgb = { r: 74, g: 74, b: 79 };
export const ISO_TEMPLATE_SIDEWALK: Rgb = { r: 199, g: 196, b: 189 };
export const ISO_TEMPLATE_DIAMOND: Rgb = { r: 48, g: 58, b: 74 };
export const ISO_TEMPLATE_SPHERE: Rgb = { r: 180, g: 176, b: 168 };

const AMBIENT = 0.3;
const LIGHT_LIFT = 0.8;
const EDGE_SHADE = 0.62;
const START_OFFSET = 48;

export type IsoIntersectionZone = "outside" | "road" | "sidewalk" | "lot";

export interface IsoTemplateSpec {
  shape: IsoTemplateShape;
  width: number;
  pitch: number;
  yaw: IsoTemplateYaw;
  light: IsoLight;
  extentX: number;
  extentY: number;
  extentZ: number;
  roadWidth: number;
  sidewalkWidth: number;
  fill: Rgb;
  top: Rgb;
  road: Rgb;
  sidewalk: Rgb;
  lot: Rgb;
}

export function defaultIsoTemplateSpec(): IsoTemplateSpec {
  return {
    shape: "prism",
    width: 512,
    pitch: DIMETRIC_PITCH,
    yaw: DEFAULT_ISO_TEMPLATE_YAW,
    light: DEFAULT_ISO_LIGHT,
    extentX: 1,
    extentY: 1,
    extentZ: 1,
    roadWidth: 0.22,
    sidewalkWidth: 0.14,
    fill: { ...ISO_TEMPLATE_FILL },
    top: { ...ISO_TEMPLATE_TOP },
    road: { ...ISO_TEMPLATE_ROAD },
    sidewalk: { ...ISO_TEMPLATE_SIDEWALK },
    lot: { ...ISO_TEMPLATE_LOT }
  };
}

export function normalizeIsoTemplateSpec(partial?: Partial<IsoTemplateSpec>): IsoTemplateSpec {
  const base = defaultIsoTemplateSpec();
  const next = { ...base, ...partial };
  const shape = ISO_TEMPLATE_SHAPES.includes(next.shape as IsoTemplateShape)
    ? (next.shape as IsoTemplateShape)
    : base.shape;
  const light = clampIsoLight(next.light);
  const { roadWidth, sidewalkWidth } = clampRoadSidewalk(next.roadWidth, next.sidewalkWidth);

  return {
    shape,
    width: clampInt(next.width, 16, 2048, base.width),
    pitch: clampIsoTemplatePitch(next.pitch),
    yaw: clampIsoTemplateYaw(next.yaw),
    light,
    extentX: clampNum(next.extentX, 0.05, 8, base.extentX),
    extentY: clampNum(next.extentY, 0.05, 8, base.extentY),
    extentZ: clampNum(next.extentZ, 0.05, 8, base.extentZ),
    roadWidth,
    sidewalkWidth,
    fill: rgb(
      partial?.fill,
      shape === "diamond" ? ISO_TEMPLATE_DIAMOND : shape === "sphere" ? ISO_TEMPLATE_SPHERE : base.fill
    ),
    top: rgb(next.top, base.top),
    road: rgb(next.road, base.road),
    sidewalk: rgb(next.sidewalk, base.sidewalk),
    lot: rgb(next.lot, base.lot)
  };
}

export function isoTemplateFileName(spec: IsoTemplateSpec): string {
  return `iso-${normalizeIsoTemplateSpec(spec).shape}.png`;
}

/**
 * Light direction in world space. +X is southeast, +Y southwest, +Z up, so
 * −X is northwest — the usual sun for a north-up diamond.
 */
export function isoLightVector(light: IsoLight): [number, number, number] {
  const compass: Record<IsoLight, [number, number]> = {
    nw: [-1, 0],
    ne: [0, -1],
    se: [1, 0],
    sw: [0, 1]
  };
  const [x, y] = compass[clampIsoLight(light)];
  return normalize(x, y, LIGHT_LIFT);
}

export function lambertShade(nx: number, ny: number, nz: number, light: IsoLight): number {
  const [lx, ly, lz] = isoLightVector(light);
  const den = Math.hypot(nx, ny, nz) || 1;
  const lambert = Math.max(0, (nx * lx + ny * ly + nz * lz) / den);
  return AMBIENT + (1 - AMBIENT) * lambert;
}

export function classifyIsoIntersection(
  worldX: number,
  worldY: number,
  pitchWidth: number,
  pitchHeight: number,
  blockWidth: number,
  blockHeight: number,
  walkWidth: number,
  walkHeight: number
): IsoIntersectionZone {
  if (!containsDiamond(worldX, worldY, 0, 0, pitchWidth, pitchHeight)) return "outside";

  const corners: Array<[number, number]> = [
    [0, 0],
    [-1, 0],
    [0, -1],
    [-1, -1]
  ];

  for (const [cx, cy] of corners) {
    const [bx, by] = blockCenter(cx, cy, pitchWidth, pitchHeight);
    if (containsDiamond(worldX, worldY, bx, by, blockWidth, blockHeight)) return "lot";
    if (containsDiamond(worldX, worldY, bx, by, walkWidth, walkHeight)) return "sidewalk";
  }

  return "road";
}

export function renderIsoTemplate(partial?: Partial<IsoTemplateSpec>): RgbaImage {
  const spec = normalizeIsoTemplateSpec(partial);
  if (spec.shape === "diamond") return renderDiamond(spec);
  if (spec.shape === "intersection") return renderIntersection(spec);
  return renderVolume(spec);
}

function renderDiamond(spec: IsoTemplateSpec): RgbaImage {
  const ratio = isoDiamondRatioForPitch(spec.pitch);
  const width = spec.width;
  const height = Math.max(1, Math.round(width / ratio));
  const image = createImage(width, height);
  const [lx, ly] = screenLight(spec.light);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!pointInIsoDiamond(x, y, width, height)) continue;
      const nx = (x + 0.5) / width - 0.5;
      const ny = (y + 0.5) / height - 0.5;
      const along = nx * lx + ny * ly;
      const shade = 0.78 + 0.22 * (0.5 + along);
      writeRgb(image, x, y, tint(spec.fill, shade));
    }
  }

  return image;
}

function renderIntersection(spec: IsoTemplateSpec): RgbaImage {
  const ratio = isoDiamondRatioForPitch(spec.pitch);
  const width = spec.width;
  const height = Math.max(1, Math.round(width / ratio));
  const pitchHeight = 1;
  const pitchWidth = pitchHeight * ratio;
  const blockHeight = Math.max(0.04, 1 - spec.roadWidth - 2 * spec.sidewalkWidth);
  const walkHeight = blockHeight + 2 * spec.sidewalkWidth;
  const blockWidth = blockHeight * ratio;
  const walkWidth = walkHeight * ratio;
  const image = createImage(width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const worldX = ((x + 0.5) / width - 0.5) * pitchWidth;
      const worldY = ((y + 0.5) / height - 0.5) * pitchHeight;
      const zone = classifyIsoIntersection(
        worldX,
        worldY,
        pitchWidth,
        pitchHeight,
        blockWidth,
        blockHeight,
        walkWidth,
        walkHeight
      );
      if (zone === "outside") continue;
      const color = zone === "lot" ? spec.lot : zone === "sidewalk" ? spec.sidewalk : spec.road;
      writeRgb(image, x, y, color);
    }
  }

  return image;
}

function renderVolume(spec: IsoTemplateSpec): RgbaImage {
  const pitch = (spec.pitch * Math.PI) / 180;
  const sine = Math.sin(pitch);
  const cosine = Math.cos(pitch);
  const yaw = spec.yaw;
  const points = volumePoints(spec);
  const projected = points.map(([x, y, z]) => project(x, y, z, sine, cosine, yaw));
  const minX = Math.min(...projected.map((p) => p[0]));
  const maxX = Math.max(...projected.map((p) => p[0]));
  const minY = Math.min(...projected.map((p) => p[1]));
  const maxY = Math.max(...projected.map((p) => p[1]));
  const contentW = Math.max(maxX - minX, 1e-6);
  const contentH = Math.max(maxY - minY, 1e-6);
  const pad = Math.max(4, Math.round(spec.width * 0.04));
  const scale = (spec.width - pad * 2) / contentW;
  const width = spec.width;
  const height = Math.max(1, Math.round(contentH * scale + pad * 2));
  const offsetX = pad - minX * scale;
  const offsetY = pad - minY * scale;
  const [camX, camY, camZ] = cameraVector(sine, cosine, yaw);
  const dx = -camX;
  const dy = -camY;
  const dz = -camZ;
  const image = createImage(width, height);
  const faces = new Uint8Array(width * height);
  const box = prismBox(spec);
  const lot = spec.shape === "building" ? lotHalf(spec) : 0;
  const radius = spec.shape === "sphere" ? spec.extentX * 0.5 : 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = (x + 0.5 - offsetX) / scale;
      const sy = (y + 0.5 - offsetY) / scale;
      const [x0, y0, z0] = unprojectScreen(sx, sy, sine, cosine, yaw);
      const ox = x0 + camX * START_OFFSET;
      const oy = y0 + camY * START_OFFSET;
      const oz = z0 + camZ * START_OFFSET;
      const hit = hitVolume(ox, oy, oz, dx, dy, dz, spec, box, lot, radius);
      if (!hit) continue;

      const shade = lambertShade(hit.nx, hit.ny, hit.nz, spec.light);
      writeRgb(image, x, y, tint(hit.color, shade));
      faces[y * width + x] = hit.face;
    }
  }

  darkenCreases(image, faces);
  return image;
}

function hitVolume(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  spec: IsoTemplateSpec,
  box: Aabb | null,
  lot: number,
  radius: number
): Hit | null {
  let best: Hit | null = null;

  if (box) {
    const boxHit = rayAabb(ox, oy, oz, dx, dy, dz, box);
    if (boxHit) {
      best = {
        ...boxHit,
        color: boxHit.nz > 0.5 ? spec.top : spec.fill,
        face: faceId(boxHit.nx, boxHit.ny, boxHit.nz)
      };
    }
  }

  if (radius > 0) {
    const sphereHit = raySphere(ox, oy, oz, dx, dy, dz, 0, 0, radius, radius);
    if (sphereHit && (!best || sphereHit.t < best.t)) {
      best = { ...sphereHit, color: spec.fill, face: 8 };
    }
  }

  if (lot > 0) {
    const ground = rayPlaneZ(ox, oy, oz, dx, dy, dz, 0);
    if (
      ground &&
      Math.abs(ground.x) <= lot &&
      Math.abs(ground.y) <= lot &&
      (!best || ground.t < best.t)
    ) {
      best = {
        t: ground.t,
        nx: 0,
        ny: 0,
        nz: 1,
        color: spec.lot,
        face: 7
      };
    }
  }

  return best;
}

function volumePoints(spec: IsoTemplateSpec): Array<[number, number, number]> {
  if (spec.shape === "sphere") {
    const r = spec.extentX * 0.5;
    return [
      [-r, -r, 0],
      [r, -r, 0],
      [-r, r, 0],
      [r, r, 0],
      [-r, -r, 2 * r],
      [r, -r, 2 * r],
      [-r, r, 2 * r],
      [r, r, 2 * r]
    ];
  }

  const hx = spec.extentX * 0.5;
  const hy = spec.extentY * 0.5;
  const hz = spec.extentZ;
  const pad = spec.shape === "building" ? lotHalf(spec) : Math.max(hx, hy);
  return [
    [-pad, -pad, 0],
    [pad, -pad, 0],
    [-pad, pad, 0],
    [pad, pad, 0],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [-hx, hy, hz],
    [hx, hy, hz]
  ];
}

function prismBox(spec: IsoTemplateSpec): Aabb | null {
  if (spec.shape !== "prism" && spec.shape !== "building") return null;
  return {
    minX: -spec.extentX * 0.5,
    maxX: spec.extentX * 0.5,
    minY: -spec.extentY * 0.5,
    maxY: spec.extentY * 0.5,
    minZ: 0,
    maxZ: spec.extentZ
  };
}

function lotHalf(spec: IsoTemplateSpec): number {
  return Math.max(spec.extentX, spec.extentY) * 0.5 * 1.35;
}

function project(
  x: number,
  y: number,
  z: number,
  sine: number,
  cosine: number,
  yaw: IsoTemplateYaw
): [number, number] {
  if (yaw === 0) return [x, y * sine - z * cosine];
  return [x - y, (x + y) * sine - z * cosine];
}

function cameraVector(sine: number, cosine: number, yaw: IsoTemplateYaw): [number, number, number] {
  if (yaw === 0) return normalize(0, cosine, sine);
  return normalize(cosine, cosine, 2 * sine);
}

function unprojectScreen(
  sx: number,
  sy: number,
  sine: number,
  cosine: number,
  yaw: IsoTemplateYaw
): [number, number, number] {
  if (yaw === 0) return [sx, sy * sine, -sy * cosine];
  const q = sy / (2 * sine * sine + cosine * cosine || 1);
  return [sx * 0.5 + q * sine, -sx * 0.5 + q * sine, -q * cosine];
}

function screenLight(light: IsoLight): [number, number] {
  switch (light) {
    case "ne":
      return [0.75, -0.65];
    case "se":
      return [0.75, 0.65];
    case "sw":
      return [-0.75, 0.65];
    default:
      return [-0.75, -0.65];
  }
}

interface Aabb {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

interface Hit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
  color: Rgb;
  face: number;
}

function rayAabb(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  box: Aabb
): { t: number; nx: number; ny: number; nz: number } | null {
  const x = slab(ox, dx, box.minX, box.maxX);
  const y = slab(oy, dy, box.minY, box.maxY);
  const z = slab(oz, dz, box.minZ, box.maxZ);
  if (!x || !y || !z) return null;
  const tEnter = Math.max(x.tmin, y.tmin, z.tmin);
  const tExit = Math.min(x.tmax, y.tmax, z.tmax);
  if (tExit < tEnter || tExit < 0) return null;
  const t = tEnter >= 0 ? tEnter : tExit;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  if (t === x.tmin || (tEnter < 0 && t === x.tmax)) nx = dx >= 0 ? -1 : 1;
  else if (t === y.tmin || (tEnter < 0 && t === y.tmax)) ny = dy >= 0 ? -1 : 1;
  else nz = dz >= 0 ? -1 : 1;
  return { t, nx, ny, nz };
}

function slab(
  origin: number,
  dir: number,
  min: number,
  max: number
): { tmin: number; tmax: number } | null {
  if (Math.abs(dir) < 1e-10) {
    if (origin < min || origin > max) return null;
    return { tmin: Number.NEGATIVE_INFINITY, tmax: Number.POSITIVE_INFINITY };
  }
  const t1 = (min - origin) / dir;
  const t2 = (max - origin) / dir;
  return { tmin: Math.min(t1, t2), tmax: Math.max(t1, t2) };
}

function raySphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  radius: number
): { t: number; nx: number; ny: number; nz: number } | null {
  const px = ox - cx;
  const py = oy - cy;
  const pz = oz - cz;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (px * dx + py * dy + pz * dz);
  const c = px * px + py * py + pz * pz - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a <= 0) return null;
  const root = Math.sqrt(disc);
  const t0 = (-b - root) / (2 * a);
  const t1 = (-b + root) / (2 * a);
  const t = t0 >= 0 ? t0 : t1;
  if (t < 0) return null;
  const hx = ox + dx * t - cx;
  const hy = oy + dy * t - cy;
  const hz = oz + dz * t - cz;
  const [nx, ny, nz] = normalize(hx, hy, hz);
  return { t, nx, ny, nz };
}

function rayPlaneZ(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  z: number
): { t: number; x: number; y: number } | null {
  if (Math.abs(dz) < 1e-10) return null;
  const t = (z - oz) / dz;
  if (t < 0) return null;
  return { t, x: ox + dx * t, y: oy + dy * t };
}

function darkenCreases(image: RgbaImage, faces: Uint8Array): void {
  const { width, height, data } = image;
  const next = new Uint8ClampedArray(data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const face = faces[i];
      if (face === 0) continue;
      const edge =
        (x > 0 && faces[i - 1] !== face) ||
        (x + 1 < width && faces[i + 1] !== face) ||
        (y > 0 && faces[i - width] !== face) ||
        (y + 1 < height && faces[i + width] !== face);
      if (!edge) continue;
      const p = i * 4;
      next[p] = toByte((data[p] / 255) * EDGE_SHADE);
      next[p + 1] = toByte((data[p + 1] / 255) * EDGE_SHADE);
      next[p + 2] = toByte((data[p + 2] / 255) * EDGE_SHADE);
    }
  }
  data.set(next);
}

function faceId(nx: number, ny: number, nz: number): number {
  if (Math.abs(nz) >= Math.abs(nx) && Math.abs(nz) >= Math.abs(ny)) return nz >= 0 ? 5 : 6;
  if (Math.abs(nx) >= Math.abs(ny)) return nx >= 0 ? 1 : 2;
  return ny >= 0 ? 3 : 4;
}

function containsDiamond(
  px: number,
  py: number,
  cx: number,
  cy: number,
  width: number,
  height: number
): boolean {
  const halfW = width * 0.5;
  const halfH = height * 0.5;
  if (halfW <= 0 || halfH <= 0) return false;
  return Math.abs(px - cx) / halfW + Math.abs(py - cy) / halfH <= 1;
}

function blockCenter(cellX: number, cellY: number, pitchWidth: number, pitchHeight: number): [number, number] {
  return [
    (cellX + 0.5 - (cellY + 0.5)) * (pitchWidth * 0.5),
    (cellX + 0.5 + cellY + 0.5) * (pitchHeight * 0.5)
  ];
}

function writeRgb(image: RgbaImage, x: number, y: number, color: Rgb): void {
  const i = (y * image.width + x) * 4;
  image.data[i] = color.r;
  image.data[i + 1] = color.g;
  image.data[i + 2] = color.b;
  image.data[i + 3] = 255;
}

function tint(color: Rgb, shade: number): Rgb {
  const t = Math.min(1, Math.max(0, shade));
  return {
    r: toByte((color.r / 255) * t),
    g: toByte((color.g / 255) * t),
    b: toByte((color.b / 255) * t)
  };
}

function rgb(value: Rgb | undefined, fallback: Rgb): Rgb {
  if (!value) return { ...fallback };
  return {
    r: clampInt(value.r, 0, 255, fallback.r),
    g: clampInt(value.g, 0, 255, fallback.g),
    b: clampInt(value.b, 0, 255, fallback.b)
  };
}

function clampRoadSidewalk(road: number, sidewalk: number): { roadWidth: number; sidewalkWidth: number } {
  let roadWidth = clampNum(road, 0.02, 0.7, 0.22);
  let sidewalkWidth = clampNum(sidewalk, 0, 0.4, 0.14);
  if (roadWidth + 2 * sidewalkWidth > 0.94) {
    sidewalkWidth = Math.max(0, (0.94 - roadWidth) / 2);
  }
  return { roadWidth, sidewalkWidth };
}

function clampNum(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  return Math.round(clampNum(value, min, max, fallback));
}

function normalize(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}
