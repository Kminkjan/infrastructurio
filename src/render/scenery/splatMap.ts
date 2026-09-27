import type { DioramaScenery, SplatPath } from "../../core/scenarios/baltic-diorama";

/**
 * Paints the terrain's data textures from a scenery layout (art direction
 * "Terrain and water", read by `shaderChunks/splat.ts`):
 *
 * - splat, RGBA8 at 1 m per texel: dirt (roads, lanes, farm yards), cobble
 *   (town squares and streets), field and forest-floor weights, with soft
 *   edges about a metre wide;
 * - field, RG8 on the same grid: crop index and furrow heading (mod 6) of the
 *   field with the strongest weight at each texel, rim included, for `texelFetch`;
 * - AO, R8 at 1,024² over the map (about 2 × 1.5 m per texel on the default
 *   map): darker under canopies, trees and around buildings, box-blurred.
 *
 * Texel (i, j) covers sim plan x ∈ [i, i + 1)·texel and y ∈ [j, j + 1)·texel.
 * Presentation data only: floats are fine here, nothing feeds back to the sim.
 */

export const SPLAT_TEXEL_M = 1;
export const AO_SIZE = 1024;
const EDGE_FEATHER_M = 0.8;
const FIELD_FEATHER_M = 0.6;
const FOREST_FLOOR_MAX = 0.85;
const YARD_DIRT = 0.55;

export interface SplatMaps {
  readonly width: number;
  readonly height: number;
  readonly texelM: number;
  /** RGBA per texel: dirt, cobble, field, forest floor (0–255). */
  readonly splat: Uint8Array;
  /** RG per texel: crop index 0–3, furrow heading 0–5. */
  readonly field: Uint8Array;
  readonly aoWidth: number;
  readonly aoHeight: number;
  /** Plan metres the AO map spans (the map extent). */
  readonly aoSizeM: { readonly x: number; readonly y: number };
  readonly ao: Uint8Array;
}

const DIRT = 0;
const COBBLE = 1;
const FIELD = 2;
const FOREST = 3;

export function buildSplatMaps(s: DioramaScenery, extent: { widthM: number; heightM: number }, texelM = SPLAT_TEXEL_M, aoSize = AO_SIZE): SplatMaps {
  const width = Math.ceil(extent.widthM / texelM);
  const height = Math.ceil(extent.heightM / texelM);
  const splat = new Uint8Array(width * height * 4);
  const field = new Uint8Array(width * height * 2);
  const grid = { width, height, texelM };

  paintForestFloor(splat, grid, s);
  for (const f of s.fields) {
    paintBox(grid, f.xMm / 1000, f.yMm / 1000, (f.heading * Math.PI) / 6, f.lengthMm / 2000, f.widthMm / 2000, FIELD_FEATHER_M, (index, weight) => {
      // The categorical crop and furrow follow the strongest field weight, feathered rim
      // included: a rim left at 0 would draw crop 0 (rye) around every other crop.
      const v = byte(weight);
      if (v > 0 && v >= (splat[4 * index + FIELD] ?? 0)) {
        field[2 * index] = f.crop;
        field[2 * index + 1] = f.heading % 6;
      }
      writeMax(splat, 4 * index + FIELD, weight);
      // Fields cover the forest floor.
      splat[4 * index + FOREST] = Math.round((splat[4 * index + FOREST] ?? 0) * (1 - weight));
    });
  }
  for (const lot of s.lots) {
    if (lot.kind !== "farmstead") continue;
    paintBox(grid, lot.xMm / 1000, lot.yMm / 1000, (lot.heading * Math.PI) / 6, lot.lengthMm / 2000 + 3, lot.widthMm / 2000 + 3, 1.5, (index, weight) => writeMax(splat, 4 * index + DIRT, weight * YARD_DIRT));
  }
  for (const path of [...s.roads, ...s.streets]) paintPath(splat, grid, path);

  const aoSizeM = { x: extent.widthM, y: extent.heightM };
  const ao = paintAo(s, aoSize, aoSizeM);
  return { width, height, texelM, splat, field, aoWidth: aoSize, aoHeight: aoSize, aoSizeM, ao };
}

interface Grid {
  readonly width: number;
  readonly height: number;
  readonly texelM: number;
}

/** A 0–1 weight as the byte the texture stores. */
function byte(weight: number): number {
  return Math.round(255 * Math.min(1, Math.max(0, weight)));
}

function writeMax(data: Uint8Array, i: number, weight: number): void {
  const v = byte(weight);
  if (v > (data[i] ?? 0)) data[i] = v;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** A splat path: every texel within half its width (feathered) of a segment. */
function paintPath(splat: Uint8Array, g: Grid, path: SplatPath): void {
  const channel = path.surface === "cobble" ? COBBLE : DIRT;
  const half = path.widthMm / 2000;
  const reach = half + EDGE_FEATHER_M;
  for (let k = 0; k + 1 < path.points.length; k++) {
    const a = path.points[k];
    const b = path.points[k + 1];
    if (!a || !b) continue;
    const ax = a.xMm / 1000;
    const ay = a.yMm / 1000;
    const bx = b.xMm / 1000;
    const by = b.yMm / 1000;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach) / g.texelM));
    const i1 = Math.min(g.width - 1, Math.floor((Math.max(ax, bx) + reach) / g.texelM));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by) - reach) / g.texelM));
    const j1 = Math.min(g.height - 1, Math.floor((Math.max(ay, by) + reach) / g.texelM));
    for (let j = j0; j <= j1; j++) {
      const py = (j + 0.5) * g.texelM;
      for (let i = i0; i <= i1; i++) {
        const px = (i + 0.5) * g.texelM;
        const t = lenSq === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lenSq));
        const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        if (d >= reach) continue;
        writeMax(splat, 4 * (j * g.width + i) + channel, 1 - smoothstep(half - EDGE_FEATHER_M, reach, d));
      }
    }
  }
}

/** Visits every texel of an oriented box (centre, angle, half extents) with its feathered weight. */
function paintBox(g: Grid, cx: number, cy: number, angle: number, halfL: number, halfW: number, feather: number, visit: (index: number, weight: number) => void): void {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const rx = Math.abs(c) * halfL + Math.abs(s) * halfW + feather;
  const ry = Math.abs(s) * halfL + Math.abs(c) * halfW + feather;
  const i0 = Math.max(0, Math.floor((cx - rx) / g.texelM));
  const i1 = Math.min(g.width - 1, Math.floor((cx + rx) / g.texelM));
  const j0 = Math.max(0, Math.floor((cy - ry) / g.texelM));
  const j1 = Math.min(g.height - 1, Math.floor((cy + ry) / g.texelM));
  for (let j = j0; j <= j1; j++) {
    const py = (j + 0.5) * g.texelM - cy;
    for (let i = i0; i <= i1; i++) {
      const px = (i + 0.5) * g.texelM - cx;
      const u = px * c + py * s;
      const v = -px * s + py * c;
      const edge = Math.max(Math.abs(u) - halfL, Math.abs(v) - halfW);
      if (edge >= feather) continue;
      visit(j * g.width + i, 1 - smoothstep(-feather, feather, edge));
    }
  }
}

/** Bilinear forest density (0–1) at a plan point, from the 20 m cell grid. */
function forestDensity(s: DioramaScenery, xM: number, yM: number): number {
  const f = s.forest;
  const cell = f.cellMm / 1000;
  const fx = xM / cell - 0.5;
  const fy = yM / cell - 0.5;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const tx = fx - i;
  const ty = fy - j;
  const at = (a: number, b: number) => (a < 0 || b < 0 || a >= f.columns || b >= f.rows ? 0 : (f.density[b * f.columns + a] ?? 0) / 255);
  return (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty;
}

function paintForestFloor(splat: Uint8Array, g: Grid, s: DioramaScenery): void {
  for (let j = 0; j < g.height; j++) {
    const y = (j + 0.5) * g.texelM;
    for (let i = 0; i < g.width; i++) {
      const d = forestDensity(s, (i + 0.5) * g.texelM, y);
      if (d > 0.1) splat[4 * (j * g.width + i) + FOREST] = Math.round(255 * FOREST_FLOOR_MAX * smoothstep(0.15, 0.65, d));
    }
  }
}

/** The world AO tint map: canopy, individual trees and building contact shadows, then a 3 × 3 blur. */
function paintAo(s: DioramaScenery, size: number, sizeM: { x: number; y: number }): Uint8Array {
  const acc = new Float32Array(size * size);
  const tx = sizeM.x / size;
  const ty = sizeM.y / size;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) acc[j * size + i] = 0.3 * forestDensity(s, (i + 0.5) * tx, (j + 0.5) * ty);
  }
  const splash = (x: number, y: number, radius: number, strength: number) => {
    const i0 = Math.max(0, Math.floor((x - radius) / tx));
    const i1 = Math.min(size - 1, Math.floor((x + radius) / tx));
    const j0 = Math.max(0, Math.floor((y - radius) / ty));
    const j1 = Math.min(size - 1, Math.floor((y + radius) / ty));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot((i + 0.5) * tx - x, (j + 0.5) * ty - y);
        if (d < radius) acc[j * size + i] = (acc[j * size + i] ?? 0) + strength * (1 - d / radius);
      }
    }
  };
  for (let k = 0; k < s.trees.count; k++) splash((s.trees.xMm[k] ?? 0) / 1000, (s.trees.yMm[k] ?? 0) / 1000, 3.2, 0.35);
  for (const lot of s.lots) {
    const angle = (lot.heading * Math.PI) / 6;
    const cx = lot.xMm / 1000;
    const cy = lot.yMm / 1000;
    const halfL = lot.lengthMm / 2000;
    const halfW = lot.widthMm / 2000;
    const reach = 4;
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    const rx = Math.abs(c) * halfL + Math.abs(sn) * halfW + reach;
    const ry = Math.abs(sn) * halfL + Math.abs(c) * halfW + reach;
    for (let j = Math.max(0, Math.floor((cy - ry) / ty)); j <= Math.min(size - 1, Math.floor((cy + ry) / ty)); j++) {
      for (let i = Math.max(0, Math.floor((cx - rx) / tx)); i <= Math.min(size - 1, Math.floor((cx + rx) / tx)); i++) {
        const px = (i + 0.5) * tx - cx;
        const py = (j + 0.5) * ty - cy;
        const edge = Math.max(Math.abs(px * c + py * sn) - halfL, Math.abs(-px * sn + py * c) - halfW);
        if (edge < reach) acc[j * size + i] = (acc[j * size + i] ?? 0) + 0.7 * (1 - smoothstep(0, reach, edge));
      }
    }
  }
  const out = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let sum = 0;
      let n = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const a = i + di;
          const b = j + dj;
          if (a < 0 || b < 0 || a >= size || b >= size) continue;
          sum += acc[b * size + a] ?? 0;
          n += 1;
        }
      }
      out[j * size + i] = Math.round(255 * Math.min(1, sum / n));
    }
  }
  return out;
}
