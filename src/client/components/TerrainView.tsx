"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isAssetDrag, readAssetDrag } from "@/client/dragAssets";
import { processor } from "@/client/processor";
import { resolveAssetsNow } from "@/client/stores/assets";
import { useDoc } from "@/client/stores/doc";
import { EMPTY_PALETTE, useServer } from "@/client/stores/server";
import { useUi } from "@/client/stores/ui";
import { createImage } from "@/core/pixels";
import { buildSceneTerrainMesh, meshFocus, type TerrainBuildOptions } from "@/core/terrain";
import type { RgbaImage, Rgb } from "@/core/types";
import { defaultTerrain, type TerrainGroup } from "@/shared/model";
import { Button } from "./ui";

const VERT = `#version 300 es
in vec3 a_position;
in vec3 a_normal;
in vec3 a_color;
uniform mat4 u_mvp;
out vec3 v_color;
out vec3 v_normal;
void main() {
  gl_Position = u_mvp * vec4(a_position, 1.0);
  v_normal = a_normal;
  v_color = a_color;
}
`;

const FRAG = `#version 300 es
precision highp float;
in vec3 v_color;
in vec3 v_normal;
uniform vec3 u_light;
out vec4 outColor;
void main() {
  float lit = max(0.18, dot(normalize(v_normal), normalize(u_light)));
  outColor = vec4(v_color * lit, 1.0);
}
`;

function rgbaFromBitmap(bitmap: ImageBitmap): RgbaImage {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return createImage(1, 1);

  context.drawImage(bitmap, 0, 0);
  const frame = context.getImageData(0, 0, bitmap.width, bitmap.height);
  return {
    width: bitmap.width,
    height: bitmap.height,
    data: new Uint8ClampedArray(frame.data)
  };
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "compile failed";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("program");
  const vs = compile(gl, gl.VERTEX_SHADER, vert);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "link failed";
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

function perspective(out: Float32Array, fov: number, aspect: number, near: number, far: number): void {
  const f = 1 / Math.tan(fov / 2);
  out.fill(0);
  out[0] = f / Math.max(0.0001, aspect);
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
}

function lookAt(
  out: Float32Array,
  eye: [number, number, number],
  target: [number, number, number],
  up: [number, number, number]
): void {
  const zx = eye[0] - target[0];
  const zy = eye[1] - target[1];
  const zz = eye[2] - target[2];
  let zlen = Math.hypot(zx, zy, zz) || 1;
  const z0 = zx / zlen;
  const z1 = zy / zlen;
  const z2 = zz / zlen;

  let x0 = up[1] * z2 - up[2] * z1;
  let x1 = up[2] * z0 - up[0] * z2;
  let x2 = up[0] * z1 - up[1] * z0;
  const xlen = Math.hypot(x0, x1, x2) || 1;
  x0 /= xlen;
  x1 /= xlen;
  x2 /= xlen;

  const y0 = z1 * x2 - z2 * x1;
  const y1 = z2 * x0 - z0 * x2;
  const y2 = z0 * x1 - z1 * x0;

  out[0] = x0;
  out[1] = y0;
  out[2] = z0;
  out[3] = 0;
  out[4] = x1;
  out[5] = y1;
  out[6] = z1;
  out[7] = 0;
  out[8] = x2;
  out[9] = y2;
  out[10] = z2;
  out[11] = 0;
  out[12] = -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]);
  out[13] = -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]);
  out[14] = -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]);
  out[15] = 1;
}

function multiply(out: Float32Array, a: Float32Array, b: Float32Array): void {
  const t = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      t[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3];
    }
  }
  out.set(t);
}

function uniqueAssetIds(terrains: TerrainGroup[]): string[] {
  const ids = new Set<string>();
  for (const terrain of terrains) {
    for (const tile of terrain.tiles) {
      if (tile.heightAssetId) ids.add(tile.heightAssetId);
      if (tile.colorAssetId) ids.add(tile.colorAssetId);
    }
  }
  return [...ids];
}

export function TerrainView({
  sceneId,
  terrains,
  palette
}: {
  sceneId: string;
  terrains: TerrainGroup[];
  palette: Rgb[];
}) {
  const projectId = useServer((state) => state.project?.id ?? null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [images, setImages] = useState<Record<string, RgbaImage>>({});
  const [dropping, setDropping] = useState(false);
  const orbit = useRef({ yaw: 0.7, pitch: 0.55, distance: 0 });
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const redraw = useRef<(() => void) | null>(null);

  const assetKey = uniqueAssetIds(terrains).join(",");

  useEffect(() => {
    if (!projectId) return;

    let cancelled = false;
    const ids = assetKey ? assetKey.split(",") : [];

    void (async () => {
      const next: Record<string, RgbaImage> = {};
      const assets = resolveAssetsNow();
      for (const id of ids) {
        const asset = assets.find((entry) => entry.id === id);
        if (!asset) continue;

        try {
          const preview = await processor.process(
            projectId,
            asset.id,
            asset.processing,
            EMPTY_PALETTE,
            false,
            asset.hasSource === false ? "thumb" : "source"
          );
          if (cancelled) return;
          next[id] = rgbaFromBitmap(preview.processed);
        } catch {
          // A missing decode leaves that cell as the flat placeholder.
        }
      }

      if (!cancelled) setImages(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [assetKey, projectId]);

  const mesh = useMemo(() => {
    const builds: TerrainBuildOptions[] = terrains.map((terrain) => ({
      x: terrain.x,
      y: terrain.y,
      countX: terrain.countX,
      countY: terrain.countY,
      tileSize: terrain.tileSize,
      samples: terrain.samples,
      low: terrain.low,
      high: terrain.high,
      seaLevel: terrain.seaLevel,
      flattenSea: terrain.flattenSea,
      gradientId: terrain.gradientId,
      palette,
      tiles: terrain.tiles.map((tile) => ({
        height: images[tile.heightAssetId] ?? null,
        color: images[tile.colorAssetId] ?? null
      }))
    }));

    return buildSceneTerrainMesh(builds);
  }, [images, palette, terrains]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    if (!gl) return;

    const program = link(gl, VERT, FRAG);
    const vao = gl.createVertexArray();
    const position = gl.createBuffer();
    const normal = gl.createBuffer();
    const color = gl.createBuffer();
    const index = gl.createBuffer();
    if (!vao || !position || !normal || !color || !index) return;

    const locPosition = gl.getAttribLocation(program, "a_position");
    const locNormal = gl.getAttribLocation(program, "a_normal");
    const locColor = gl.getAttribLocation(program, "a_color");
    const locMvp = gl.getUniformLocation(program, "u_mvp");
    const locLight = gl.getUniformLocation(program, "u_light");

    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, position);
    gl.enableVertexAttribArray(locPosition);
    gl.vertexAttribPointer(locPosition, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, normal);
    gl.enableVertexAttribArray(locNormal);
    gl.vertexAttribPointer(locNormal, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, color);
    gl.enableVertexAttribArray(locColor);
    gl.vertexAttribPointer(locColor, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bindVertexArray(null);

    const proj = new Float32Array(16);
    const view = new Float32Array(16);
    const mvp = new Float32Array(16);

    const upload = () => {
      gl.bindBuffer(gl.ARRAY_BUFFER, position);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, normal);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, color);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.colors, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.DYNAMIC_DRAW);
    };

    upload();

    const focus = meshFocus(mesh);
    if (
      orbit.current.distance <= 0 ||
      orbit.current.distance > focus.radius * 12 ||
      orbit.current.distance < focus.radius * 0.2
    ) {
      orbit.current.distance = focus.radius * 2.4;
    }

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.06, 0.07, 0.09, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      if (mesh.vertexCount === 0 || mesh.indices.length === 0) return;

      const { yaw, pitch, distance } = orbit.current;
      const eye: [number, number, number] = [
        focus.center[0] + Math.cos(pitch) * Math.sin(yaw) * distance,
        focus.center[1] + Math.sin(pitch) * distance,
        focus.center[2] + Math.cos(pitch) * Math.cos(yaw) * distance
      ];

      perspective(proj, Math.PI / 4, width / Math.max(1, height), 0.5, distance + focus.radius * 8);
      lookAt(view, eye, focus.center, [0, 1, 0]);
      multiply(mvp, proj, view);

      gl.useProgram(program);
      gl.uniformMatrix4fv(locMvp, false, mvp);
      gl.uniform3f(locLight, 0.35, 0.85, 0.4);
      gl.bindVertexArray(vao);
      gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
    };

    draw();

    const onResize = () => draw();
    const observer = new ResizeObserver(onResize);
    observer.observe(canvas);

    const host = canvas;
    const onMove = (event: PointerEvent) => {
      if (!drag.current) return;
      const dx = event.clientX - drag.current.x;
      const dy = event.clientY - drag.current.y;
      orbit.current.yaw = drag.current.yaw + dx * 0.008;
      orbit.current.pitch = Math.min(1.4, Math.max(0.08, drag.current.pitch + dy * 0.008));
      draw();
    };
    const onUp = () => {
      drag.current = null;
    };

    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onUp);

    redraw.current = draw;

    return () => {
      redraw.current = null;
      observer.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      gl.deleteBuffer(position);
      gl.deleteBuffer(normal);
      gl.deleteBuffer(color);
      gl.deleteBuffer(index);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    };
  }, [mesh]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      yaw: orbit.current.yaw,
      pitch: orbit.current.pitch
    };
  };

  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const focus = meshFocus(mesh);
    const next = orbit.current.distance * Math.exp(event.deltaY * 0.0015);
    orbit.current.distance = Math.min(focus.radius * 12, Math.max(focus.radius * 0.4, next));
    redraw.current?.();
  };

  const onDrop = (event: React.DragEvent) => {
    if (!isAssetDrag(event)) return;
    event.preventDefault();
    setDropping(false);

    const ids = readAssetDrag(event);
    if (ids.length === 0) return;

    if (terrains.length === 0) {
      const id = crypto.randomUUID();
      const terrain = defaultTerrain(id, 0, 0);
      terrain.tiles[0] = { heightAssetId: ids[0], colorAssetId: ids[1] ?? "" };
      useDoc.getState().addTerrain(sceneId, terrain);
      useUi.getState().setActiveTerrain(id);
      return;
    }

    const target = useUi.getState().activeTerrainId
      ? terrains.find((entry) => entry.id === useUi.getState().activeTerrainId)
      : terrains[0];
    if (!target) return;

    const empty = target.tiles.findIndex((tile) => !tile.heightAssetId);
    const index = empty >= 0 ? empty : 0;
    useDoc.getState().setTerrainTile(sceneId, target.id, index, { heightAssetId: ids[0] });
    useUi.getState().setActiveTerrain(target.id);
  };

  return (
    <div
      className="absolute inset-0"
      onDragOver={(event) => {
        if (!isAssetDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDropping(false);
      }}
      onDrop={onDrop}
      style={{ boxShadow: dropping ? "inset 0 0 0 2px var(--color-accent)" : undefined }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ touchAction: "none", cursor: "grab" }}
        onPointerDown={onPointerDown}
        onWheel={onWheel}
      />

      {terrains.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="pointer-events-auto rounded-lg border border-[var(--color-edge)] bg-[var(--color-ink-800)]/90 px-3 py-2 text-center">
            <p className="mb-2 text-[11px] text-slate-400">
              Drop a heightmap here, or add a terrain from Elements.
            </p>
            <Button
              onClick={() => {
                const id = crypto.randomUUID();
                useDoc.getState().addTerrain(sceneId, defaultTerrain(id, 0, 0));
                useUi.getState().setActiveTerrain(id);
              }}
            >
              + terrain
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
