import { Color, Vector3 } from "three";
import { LATTICE_SPACING_M, type Terrain, unit } from "../../core/sim/api";
import { palette } from "../art/palette";
import { simToWorld } from "../coords";
import { neighbourHeading, neighbourIndex } from "./offsetGrid";

/**
 * Per-node presentation data for the terrain mesh, computed once from the
 * sim's heights (art direction "Terrain and water"): smooth normals, baked
 * vertex colours, and each node's ring distance to water. Computing these per
 * node over the whole map, not per chunk, keeps chunk seams invisible.
 */
export interface TerrainShading {
  /** World-space unit normals, xyz per node. */
  readonly normals: Float32Array;
  /** Linear-space RGB per node. */
  readonly colors: Float32Array;
  /** Lattice rings to the nearest water node: 0 on water, WATER_DISTANCE_FAR beyond the cap. */
  readonly waterDistance: Uint8Array;
  /**
   * Linear-space RGB per node for made ground: the land recipe without the shore soil tint, on
   * water nodes at the water level. Earthworks blend toward it as they move, so an embankment
   * running into a lake stays grassed down to the waterline detail's thin wet line instead of
   * taking the underwater bed's or the shore rings' brown (render pass iteration, 2026-09-27).
   * Away from water it equals `colors`.
   */
  readonly dryColors: Float32Array;
}

export const WATER_DISTANCE_FAR = 255;
/** Rings the water-distance search expands; soil and the water mesh need only a few. */
export const WATER_DISTANCE_CAP = 8;

/** Soil tint on land by ring distance to water (index = rings). */
const SOIL_BY_RING = [0, 0.7, 0.45, 0.2] as const;
/** Grass patches: value-noise cells of about 70 m, in columns and rows. */
const PATCH_CELL_COLS = 14;
const PATCH_CELL_ROWS = 16;
/** Baked-AO window: ±5 nodes (about 25 m) around each node. */
const AO_RADIUS = 5;
/** Low ground is slightly darker than high ground overall. */
const HEIGHT_SHADE_MIN = 0.93;
/** Bed depth (dm) at which the underwater colour is fully deep. */
const BED_DEEP_DM = 25;

/**
 * The baked shading recipe. `D11A_TERRAIN_COLOURS` is the look Look Gate A
 * scored; the terrain look variants (2026-09-27) calm the 70 m patches, drop
 * the per-node jitter and the soft meadow (their shader draws crisp detail
 * instead), and smooth the heights behind the normals, because their relief
 * shading steepens slopes and would otherwise amplify the 1 dm height steps
 * into streaks along the lattice rows.
 */
export interface TerrainColourOptions {
  /**
   * Passes of a six-neighbour binomial filter (weights 2 : 1 × 6, missing
   * neighbours replaced by the node) on the heights behind the normals only;
   * 0 is D11a's exact least-squares normal of the Int16 heights.
   */
  readonly normalSmoothing: number;
  /** Share of the 70 m grass patch noise: 1 spans shade → light grass (D11a). */
  readonly patchAmount: number;
  /**
   * Per-node jitter on top of the patches, so flat ground is not one flat colour.
   * Kept small in D11a: stronger jitter outlines the lattice triangles as mottling.
   */
  readonly jitter: number;
  /** Meadow on the highest ground, blended over the top 40% of the land's height span. */
  readonly meadowStrength: number;
  /** Darkening of a node this far (`aoFullDm`) below its ±25 m mean. */
  readonly aoStrength: number;
  readonly aoFullDm: number;
  /** Lightening of a node `ridgeFullDm` above its ±25 m mean (0 in D11a). */
  readonly ridgeStrength: number;
  readonly ridgeFullDm: number;
}

export const D11A_TERRAIN_COLOURS: TerrainColourOptions = {
  normalSmoothing: 0,
  patchAmount: 1,
  jitter: 0.06,
  meadowStrength: 0.4,
  aoStrength: 0.22,
  aoFullDm: 30,
  ridgeStrength: 0,
  ridgeFullDm: 30,
};

export function computeTerrainShading(t: Terrain, colours: TerrainColourOptions = D11A_TERRAIN_COLOURS): TerrainShading {
  const waterDistance = computeWaterDistance(t);
  const heights = colours.normalSmoothing > 0 ? smoothHeightsDm(t, colours.normalSmoothing) : t.heightsDm;
  const colors = computeNodeColors(t, waterDistance, colours);
  return { normals: computeNodeNormals(t, heights), colors, waterDistance, dryColors: computeDryColors(t, colors, waterDistance, colours) };
}

/**
 * Heights (dm, float) after `passes` of a six-neighbour binomial filter:
 * h′ = (2·h + Σ neighbours) / 8, a missing edge neighbour counting as the node
 * itself. Presentation only (shading normals); the sim's heights never change.
 */
export function smoothHeightsDm(t: Terrain, passes: number): Float64Array {
  const { columns, rows } = t;
  let from = Float64Array.from(t.heightsDm);
  let to = new Float64Array(from.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const index = row * columns + col;
        const h0 = from[index] ?? 0;
        let sum = 2 * h0;
        for (let n = 0; n < 6; n++) {
          const ni = neighbourIndex(columns, rows, col, row, n);
          sum += ni >= 0 ? (from[ni] ?? 0) : h0;
        }
        to[index] = sum / 8;
      }
    }
    [from, to] = [to, from];
  }
  return from;
}

/** Multi-source breadth-first search over the six-neighbour lattice from every water node. */
export function computeWaterDistance(t: Terrain, cap: number = WATER_DISTANCE_CAP): Uint8Array {
  const { columns, rows } = t;
  const distance = new Uint8Array(columns * rows).fill(WATER_DISTANCE_FAR);
  const queue = new Int32Array(columns * rows);
  let tail = 0;
  for (let i = 0; i < t.water.length; i++) {
    if (t.water[i] === 1) {
      distance[i] = 0;
      queue[tail++] = i;
    }
  }
  for (let head = 0; head < tail; head++) {
    const index = queue[head] ?? 0;
    const d = distance[index] ?? 0;
    if (d >= cap) continue;
    const row = Math.floor(index / columns);
    const col = index - row * columns;
    for (let n = 0; n < 6; n++) {
      const next = neighbourIndex(columns, rows, col, row, n);
      if (next >= 0 && distance[next] === WATER_DISTANCE_FAR) {
        distance[next] = d + 1;
        queue[tail++] = next;
      }
    }
  }
  return distance;
}

/**
 * Smooth normals from the least-squares height gradient over the six
 * neighbours: minimise Σ (h_i − h_0 − a·u_i·∇h)² over unit directions u_i,
 * i.e. solve (Σ u_i·u_iᵀ)·∇h = Σ u_i·(h_i − h_0)/a. In the interior the matrix
 * is 3·I. A missing edge neighbour is mirrored through the node
 * (2·h_0 − h_opposite); a pair with neither side on the map (map corners) is
 * left out of the sum. Either way the result is exact on a plane. `heightsDm`
 * defaults to the terrain's own (the smoothed heights of a terrain look variant
 * otherwise).
 */
export function computeNodeNormals(t: Terrain, heightsDm: ArrayLike<number> = t.heightsDm): Float32Array {
  const { columns, rows } = t;
  const normals = new Float32Array(columns * rows * 3);
  const units = [0, 1, 2, 3, 4, 5].map((i) => unit(neighbourHeading(i)));
  const n = new Vector3();
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const index = row * columns + col;
      const h0 = (heightsDm[index] ?? 0) / 10;
      let axx = 0;
      let axy = 0;
      let ayy = 0;
      let bx = 0;
      let by = 0;
      for (let i = 0; i < 6; i++) {
        const u = units[i];
        if (!u) continue;
        const ni = neighbourIndex(columns, rows, col, row, i);
        let h: number;
        if (ni >= 0) h = (heightsDm[ni] ?? 0) / 10;
        else {
          const opposite = neighbourIndex(columns, rows, col, row, (i + 3) % 6);
          if (opposite < 0) continue;
          h = 2 * h0 - (heightsDm[opposite] ?? 0) / 10;
        }
        axx += u.x * u.x;
        axy += u.x * u.y;
        ayy += u.y * u.y;
        bx += (u.x * (h - h0)) / LATTICE_SPACING_M;
        by += (u.y * (h - h0)) / LATTICE_SPACING_M;
      }
      let gx = 0;
      let gy = 0;
      const det = axx * ayy - axy * axy;
      if (det > 1e-9) {
        gx = (ayy * bx - axy * by) / det;
        gy = (axx * by - axy * bx) / det;
      } else if (axx > 1e-9) {
        // A one-row map only has east–west neighbours.
        gx = bx / axx;
      }
      const len = Math.hypot(gx, gy, 1);
      simToWorld(-gx / len, -gy / len, 1 / len, n);
      normals[3 * index] = n.x;
      normals[3 * index + 1] = n.y;
      normals[3 * index + 2] = n.z;
    }
  }
  return normals;
}

/**
 * Baked vertex colours, all from the palette and mixed in linear space:
 * grass patches between shade, base and light plus a little per-node jitter;
 * meadow on the highest ground; soil on the rings nearest water; darker in
 * hollows (baked AO), lighter on ridges (off in D11a) and slightly darker low
 * down; and an underwater bed that darkens toward deep water, which shows as a
 * wet band where the shoreline triangles cross the water surface.
 */
export function computeNodeColors(t: Terrain, waterDistance: Uint8Array, o: TerrainColourOptions = D11A_TERRAIN_COLOURS): Float32Array {
  const { columns, rows, heightsDm, waterLevelDm } = t;
  const colors = new Float32Array(columns * rows * 3);
  const land = landColourer(t, o);
  const soil = new Color(palette.soil);
  const deep = new Color(palette.waterDeep);
  const c = new Color();

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const index = row * columns + col;
      const h = heightsDm[index] ?? 0;
      if (h < waterLevelDm) {
        const depth = smoothstep(0, BED_DEEP_DM, waterLevelDm - h);
        c.copy(soil).lerp(deep, 0.35 + 0.5 * depth).multiplyScalar(0.85);
      } else land(col, row, h, waterDistance[index] ?? WATER_DISTANCE_FAR, c);
      colors[3 * index] = c.r;
      colors[3 * index + 1] = c.g;
      colors[3 * index + 2] = c.b;
    }
  }
  return colors;
}

/**
 * `colors` with the shore soil tint taken out: every node within the soil rings of water, and
 * every water node (taken at the water level), recoloured by the land recipe with no soil.
 * Other nodes keep their colour exactly.
 */
export function computeDryColors(t: Terrain, colors: Float32Array, waterDistance: Uint8Array, o: TerrainColourOptions = D11A_TERRAIN_COLOURS): Float32Array {
  const out = Float32Array.from(colors);
  const land = landColourer(t, o);
  const c = new Color();
  for (let index = 0; index < t.heightsDm.length; index++) {
    if ((waterDistance[index] ?? WATER_DISTANCE_FAR) >= SOIL_BY_RING.length) continue;
    const row = Math.floor(index / t.columns);
    land(index - row * t.columns, row, Math.max(t.heightsDm[index] ?? 0, t.waterLevelDm), WATER_DISTANCE_FAR, c);
    out[3 * index] = c.r;
    out[3 * index + 1] = c.g;
    out[3 * index + 2] = c.b;
  }
  return out;
}

/**
 * The land colour recipe as a function of a node (col, row), a height `h` (dm) and a ring
 * distance to water: grass patches between shade, base and light plus a little per-node
 * jitter; meadow on the highest ground; soil on the rings nearest water; darker in hollows
 * below the ±25 m mean (baked AO), lighter on ridges (off in D11a) and slightly darker low
 * down.
 */
function landColourer(t: Terrain, o: TerrainColourOptions): (col: number, row: number, h: number, ring: number, out: Color) => Color {
  const { columns, heightsDm, waterLevelDm } = t;
  const mean = localMeanHeights(t, AO_RADIUS);
  let minLand = Infinity;
  let maxLand = -Infinity;
  for (let i = 0; i < heightsDm.length; i++) {
    const h = heightsDm[i] ?? 0;
    if (h >= waterLevelDm) {
      minLand = Math.min(minLand, h);
      maxLand = Math.max(maxLand, h);
    }
  }
  const landSpan = Math.max(1, maxLand - minLand);
  const grass = new Color(palette.grass);
  const grassLight = new Color(palette.grassLight);
  const grassShade = new Color(palette.grassShade);
  const meadow = new Color(palette.meadow);
  const soil = new Color(palette.soil);
  return (col, row, h, ring, c) => {
    const index = row * columns + col;
    const noise = patchNoise(col, row);
    // At patchAmount 1 the noise is used as is, so D11a's colours stay bit-identical.
    const patch = o.patchAmount === 1 ? noise : 0.5 + (noise - 0.5) * o.patchAmount;
    const v = clamp01(patch + o.jitter * (hash01(col, row, 0x5eed) * 2 - 1));
    if (v < 0.5) c.copy(grassShade).lerp(grass, v * 2);
    else c.copy(grass).lerp(grassLight, (v - 0.5) * 2);
    const high = (h - minLand) / landSpan;
    c.lerp(meadow, o.meadowStrength * smoothstep(0.6, 1, high));
    const soilWeight = ring < SOIL_BY_RING.length ? (SOIL_BY_RING[ring] ?? 0) : 0;
    if (soilWeight > 0) c.lerp(soil, soilWeight);
    const relief = (mean[index] ?? h) - h;
    const hollow = smoothstep(0, o.aoFullDm, relief);
    const ridge = smoothstep(0, o.ridgeFullDm, -relief);
    return c.multiplyScalar((1 - o.aoStrength * hollow) * (1 + o.ridgeStrength * ridge) * (HEIGHT_SHADE_MIN + (1 - HEIGHT_SHADE_MIN) * high));
  };
}

/**
 * Mean height (dm) over a (2R+1)² window of offset columns and rows, clamped at
 * the map edge: a separable box filter via running sums, O(n). The offset rows
 * make the window slightly sheared, which is harmless for a shading term.
 */
export function localMeanHeights(t: Terrain, radius: number): Float32Array {
  const { columns, rows, heightsDm } = t;
  const across = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row++) {
    const base = row * columns;
    let sum = 0;
    for (let c = 0; c <= Math.min(radius, columns - 1); c++) sum += heightsDm[base + c] ?? 0;
    for (let col = 0; col < columns; col++) {
      const lo = Math.max(0, col - radius);
      const hi = Math.min(columns - 1, col + radius);
      across[base + col] = sum / (hi - lo + 1);
      const add = col + radius + 1;
      const drop = col - radius;
      if (add < columns) sum += heightsDm[base + add] ?? 0;
      if (drop >= 0) sum -= heightsDm[base + drop] ?? 0;
    }
  }
  const mean = new Float32Array(columns * rows);
  for (let col = 0; col < columns; col++) {
    let sum = 0;
    for (let r = 0; r <= Math.min(radius, rows - 1); r++) sum += across[r * columns + col] ?? 0;
    for (let row = 0; row < rows; row++) {
      const lo = Math.max(0, row - radius);
      const hi = Math.min(rows - 1, row + radius);
      mean[row * columns + col] = sum / (hi - lo + 1);
      const add = row + radius + 1;
      const drop = row - radius;
      if (add < rows) sum += across[add * columns + col] ?? 0;
      if (drop >= 0) sum -= across[drop * columns + col] ?? 0;
    }
  }
  return mean;
}

/** Smooth value noise in [0, 1] over offset coordinates, for grass patches. */
function patchNoise(col: number, row: number): number {
  const x = col / PATCH_CELL_COLS;
  const y = row / PATCH_CELL_ROWS;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const sx = smoothstep(0, 1, x - x0);
  const sy = smoothstep(0, 1, y - y0);
  const a = hash01(x0, y0, 0x9a7c);
  const b = hash01(x0 + 1, y0, 0x9a7c);
  const c = hash01(x0, y0 + 1, 0x9a7c);
  const d = hash01(x0 + 1, y0 + 1, 0x9a7c);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

/** Cheap integer hash to [0, 1): presentation noise only, never sim state. */
function hash01(a: number, b: number, salt: number): number {
  let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ salt;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
