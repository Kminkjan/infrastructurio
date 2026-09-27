import { type Axial, axial, toWorld } from "./lattice";
import { canonicalJson, fnv1a32, fnv1a32Bytes, hash32, hex32 } from "./util/hash";
import { divFloor, isqrt } from "./util/int";
import { createPrng } from "./util/prng";

/**
 * Static seeded terrain at lattice nodes (simulation model §7, ADR 0010).
 *
 * Heights are integer decimetres, one per lattice node, stored row-major in
 * an offset-row layout: row = r, col = q + floor(r/2). That turns the
 * rhombus of axial coordinates into a rectangle of about 2.0 × 1.5 km with
 * its origin at the south-west corner, where even rows sit at x = 5·col m and
 * odd rows half a step east.
 *
 * Generation is integer-only once each node's position is in millimetres:
 * hash value-noise on rotated grids (exact Pythagorean-triple rotations),
 * fixed-point smoothstep, a rational soft floor, integer distances via `isqrt`.
 * No transcendentals and no float accumulation, so the same
 * {seed, columns, rows, generatorVersion} gives bit-identical heights on every
 * engine. River and lake positions scale with the map, so a save must carry
 * the size too (open for D12) unless a generator version fixes it. Bump
 * TERRAIN_GENERATOR_VERSION on any change that moves a single height once a
 * version has shipped; the golden hash test will insist.
 *
 * The river and lake invariants (one west → east river, one separate lake)
 * are tested at DEFAULT_TERRAIN_SIZE; a 40-seed probe found them at every
 * size from 300 × 260 nodes up. Smaller maps still generate, but the lake is
 * left out whenever no candidate clears the river (often from 240 × 208
 * down), and around 100 × 87 the river can leave through the north or south
 * edge.
 */

/**
 * Version 2 (D11a, 2026-09-26): each octave's grid is rotated and offset, so
 * the octaves no longer share axis-aligned cell edges (version 1 banded along
 * x and y at Far zoom), and the hard land clamp became a soft floor, so
 * lowland keeps relief instead of lying perfectly flat at 10.5 m.
 */
export const TERRAIN_GENERATOR_VERSION = 2;
/** 400 × 346 nodes ≈ 1997.5 m × 1494 m. */
export const DEFAULT_TERRAIN_SIZE = { columns: 400, rows: 346 } as const;

export interface TerrainParams {
  readonly seed: string;
  readonly columns: number;
  readonly rows: number;
}

/** Generated terrain. Read-only by contract: never write to its typed arrays. */
export interface Terrain {
  readonly seed: string;
  readonly generatorVersion: number;
  /** Nodes per row. */
  readonly columns: number;
  readonly rows: number;
  readonly waterLevelDm: number;
  /** Row-major: index = row * columns + col. */
  readonly heightsDm: Int16Array;
  /** 1 where the node is water (height < waterLevelDm), same indexing. */
  readonly water: Uint8Array;
}

const MIN_SIZE = 2;
/** Keeps squared distances in mm (≈ 3e14 at this size) far below 2^53. */
const MAX_SIZE = 4096;

const WATER_LEVEL_DM = 100;
const BASE_HEIGHT_DM = 200;
/** Dry land never dips below this outside the river and lake, so no random ponds. */
const LAND_FLOOR_DM = WATER_LEVEL_DM + 5;
/** Where a bank starts: a low shelf just above the water. */
const SHORE_DM = WATER_LEVEL_DM + 6;
const RIVER_BED_DM = WATER_LEVEL_DM - 18;
const LAKE_BED_DM = WATER_LEVEL_DM - 25;
/**
 * Width of the bed-to-shelf ramp, centred on the channel edge. Without it the
 * bank jumps 2.3–3.4 m across one 5 m lattice edge, so the waterline crossed
 * every shore edge at the same fraction and traced the lattice instead of the
 * river's curve. Over 10 m the crossing moves smoothly with distance and the
 * water edge only shifts outward by about 1.7 m (river) and 2.2 m (lake).
 */
const SHELF_RAMP_MM = 10_000;
const SHELF_RAMP_HALF_MM = divFloor(SHELF_RAMP_MM, 2);

/**
 * A grid rotation (cos, sin) = (a/c, b/c) from a Pythagorean triple
 * a² + b² = c², so rotating integer mm stays exact up to one floor and never
 * needs trigonometry. A square grid repeats every 90° and the lattice every
 * 30°, so what matters is the angle modulo 30°: each is about 15° from both.
 */
export interface GridRotation {
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

interface Octave {
  readonly cellMm: number;
  readonly amplitudeDm: number;
  readonly rotation: GridRotation;
}

/**
 * Value-noise octaves, coarse to fine. The rotations (16.3°, 43.6°, 75.8°)
 * are about 30° apart modulo 90°, so no two octaves share cell edges and none
 * lines up with the lattice or the screen at any rest yaw.
 */
const OCTAVES: readonly Octave[] = [
  { cellMm: 420_000, amplitudeDm: 170, rotation: { a: 24, b: 7, c: 25 } },
  { cellMm: 150_000, amplitudeDm: 60, rotation: { a: 21, b: 20, c: 29 } },
  { cellMm: 55_000, amplitudeDm: 22, rotation: { a: 16, b: 63, c: 65 } },
];
/** The octaves' grid rotations, coarse to fine (exported for tests). */
export const OCTAVE_ROTATIONS: readonly GridRotation[] = OCTAVES.map((o) => o.rotation);
/** The finest octave is added after the soft floor, so lowland keeps its small-scale relief. */
const DETAIL_OCTAVE = OCTAVES.length - 1;
/** Salts the per-octave grid offsets apart from the corner values in hash32. */
const OFFSET_SALT = 0x4f464653;
/**
 * The soft floor for the coarse octaves: at least the detail octave's full
 * amplitude above LAND_FLOOR_DM, so adding the detail octave back can never
 * reach below it (sampleNoise is bounded by ±amplitudeDm exactly).
 */
const SOFT_FLOOR_DM = LAND_FLOOR_DM + 22;
/** Above this the coarse height is untouched; below it the soft floor eases in. */
const SOFT_KNEE_DM = SOFT_FLOOR_DM + 45;
/** Noise corner values span −NOISE_RANGE..NOISE_RANGE. */
const NOISE_RANGE = 1000;

/** Exact row pitch 5000·√3/2 mm; only ever multiplied by r and rounded once. */
const ROW_PITCH_MM = 4330.127018922193;
/** Half a lattice step: node x is an exact multiple of it. */
const HALF_STEP_MM = 2500;

const RIVER_CELL_MM = 600_000;
const RIVER_SWING_MM = 220_000;
const RIVER_CENTRE_PERCENT = 46;
const RIVER_HALF_WIDTH_MM = 16_000;
const RIVER_BANK_MM = 90_000;
/** Distinguishes the river's 1-D noise from the 2-D octaves in hash32. */
const RIVER_SALT = 0x52495652;
/** Centreline samples beyond each map edge, so edge nodes see the whole bank. */
const RIVER_PAD_SAMPLES = divFloor(RIVER_BANK_MM, HALF_STEP_MM);

const LAKE_RADIUS_MM = 130_000;
const LAKE_BANK_MM = LAKE_RADIUS_MM + 70_000;
const LAKE_EDGE_MARGIN_MM = LAKE_BANK_MM + 50_000;
/** Lake and river banks never touch, so the two water bodies stay separate. */
const LAKE_RIVER_CLEARANCE_MM = LAKE_BANK_MM + RIVER_BANK_MM + 30_000;
const LAKE_ATTEMPTS = 256;

/** Fixed-point one for interpolation weights. */
const ONE = 1024;

const INT16_MIN = -32768;
const INT16_MAX = 32767;

/** Axial node of an offset (col, row) position: q = col − floor(row/2), r = row. */
export function nodeOfOffset(col: number, row: number): Axial {
  return axial(col - divFloor(row, 2), row);
}

/** Offset position of a node, or undefined when it lies outside the map. */
export function offsetOfNode(t: Terrain, a: Axial): { col: number; row: number } | undefined {
  if (!Number.isSafeInteger(a.q) || !Number.isSafeInteger(a.r)) return undefined;
  const row = a.r;
  if (row < 0 || row >= t.rows) return undefined;
  const col = a.q + divFloor(row, 2);
  if (col < 0 || col >= t.columns) return undefined;
  return { col, row };
}

/** Terrain height at a node in dm, or undefined outside the map. */
export function heightDmAt(t: Terrain, a: Axial): number | undefined {
  const o = offsetOfNode(t, a);
  return o === undefined ? undefined : t.heightsDm[o.row * t.columns + o.col];
}

/** Whether a node is water; false outside the map. */
export function isWaterAt(t: Terrain, a: Axial): boolean {
  const o = offsetOfNode(t, a);
  return o !== undefined && t.water[o.row * t.columns + o.col] === 1;
}

/**
 * Identity hash of a terrain: FNV-1a over its canonical parameters, then the
 * heights as little-endian Int16 bytes (explicitly, not the host's byte
 * order), then the water mask. 8 hex digits.
 */
export function terrainHash(t: Terrain): string {
  const params = canonicalJson({
    columns: t.columns,
    generatorVersion: t.generatorVersion,
    rows: t.rows,
    seed: t.seed,
    waterLevelDm: t.waterLevelDm,
  });
  const heightBytes = new Uint8Array(t.heightsDm.length * 2);
  for (let i = 0; i < t.heightsDm.length; i++) {
    const v = t.heightsDm[i] ?? 0;
    heightBytes[2 * i] = v & 0xff;
    heightBytes[2 * i + 1] = (v >> 8) & 0xff;
  }
  return hex32(fnv1a32Bytes(t.water, fnv1a32Bytes(heightBytes, fnv1a32(params))));
}

/**
 * A node's plan position in integer mm (x east, y north), exactly as
 * generation computes it: x = 2500·(2·col + row parity), y = round(row · 4330.127…).
 */
export function nodePositionMm(col: number, row: number): { xMm: number; yMm: number } {
  return { xMm: HALF_STEP_MM * (2 * col + (row - 2 * divFloor(row, 2))), yMm: rowYMm(row) };
}

/** The map's extent in integer mm from the south-west node: the eastmost odd-row node and the last row. */
export function terrainExtentMm(t: Pick<Terrain, "columns" | "rows">): { widthMm: number; heightMm: number } {
  return { widthMm: HALF_STEP_MM * (2 * (t.columns - 1) + 1), heightMm: rowYMm(t.rows - 1) };
}

/** Extent of the map's nodes in sim metres (x east, y north), origin south-west. */
export function terrainBoundsM(t: Terrain): { minX: number; maxX: number; minY: number; maxY: number } {
  const eastmost = toWorld(nodeOfOffset(t.columns - 1, t.rows > 1 ? 1 : 0));
  const northmost = toWorld(nodeOfOffset(0, t.rows - 1));
  return { minX: 0, maxX: eastmost.x, minY: 0, maxY: northmost.y };
}

export function generateTerrain(params: TerrainParams): Terrain {
  const { seed, columns, rows } = params;
  if (typeof seed !== "string") throw new RangeError("terrain seed must be a string");
  for (const [name, n] of [["columns", columns], ["rows", rows]] as const) {
    if (!Number.isSafeInteger(n) || n < MIN_SIZE || n > MAX_SIZE) {
      throw new RangeError(`terrain ${name} must be an integer in [${MIN_SIZE}, ${MAX_SIZE}], got ${n}`);
    }
  }

  const seedHash = fnv1a32(seed);
  const widthMm = HALF_STEP_MM * (2 * (columns - 1) + 1);
  const heightMm = rowYMm(rows - 1);
  const octaves = OCTAVES.map((o, i) => buildNoiseGrid(o, i, seedHash, widthMm, heightMm));
  const detail = octaves[DETAIL_OCTAVE];
  if (detail === undefined) throw new Error("terrain needs a detail octave");
  const river = buildRiver(seedHash, columns, heightMm);
  const lake = placeLake(seed, river, widthMm, heightMm);

  const count = columns * rows;
  const heightsDm = new Int16Array(count);
  const water = new Uint8Array(count);
  const riverBankSq = RIVER_BANK_MM * RIVER_BANK_MM;
  const lakeBankSq = LAKE_BANK_MM * LAKE_BANK_MM;

  for (let row = 0; row < rows; row++) {
    const yMm = rowYMm(row);
    const parity = row - 2 * divFloor(row, 2);
    const nearRiverBand = yMm >= river.minYMm - RIVER_BANK_MM && yMm <= river.maxYMm + RIVER_BANK_MM;
    for (let col = 0; col < columns; col++) {
      // xMm = 2500·(2q + r) with q = col − floor(row/2), i.e. 2500·(2·col + parity).
      const sample = 2 * col + parity;
      const xMm = HALF_STEP_MM * sample;

      let coarse = BASE_HEIGHT_DM;
      for (let o = 0; o < DETAIL_OCTAVE; o++) {
        const grid = octaves[o];
        if (grid !== undefined) coarse += sampleNoise(grid, xMm, yMm);
      }
      // softFloor ≥ SOFT_FLOOR_DM and the detail octave ≥ −22 dm, so natural ≥ LAND_FLOOR_DM.
      const natural = softFloor(coarse) + sampleNoise(detail, xMm, yMm);

      let h = natural;
      if (nearRiverBand) {
        const dSq = riverDistanceSq(river, sample, yMm);
        if (dSq < riverBankSq) {
          h = Math.min(h, shapeWaterBody(isqrt(dSq), RIVER_HALF_WIDTH_MM, RIVER_BANK_MM, RIVER_BED_DM, natural));
        }
      }
      if (lake !== undefined) {
        const dx = xMm - lake.xMm;
        const dy = yMm - lake.yMm;
        const dSq = dx * dx + dy * dy;
        if (dSq < lakeBankSq) {
          h = Math.min(h, shapeWaterBody(isqrt(dSq), LAKE_RADIUS_MM, LAKE_BANK_MM, LAKE_BED_DM, natural));
        }
      }

      // ADR 0012: typed arrays are storage with a checked range, never a silent wrap.
      if (h < INT16_MIN || h > INT16_MAX) throw new RangeError(`terrain height ${h} dm overflows Int16`);
      const index = row * columns + col;
      heightsDm[index] = h;
      water[index] = h < WATER_LEVEL_DM ? 1 : 0;
    }
  }

  return Object.freeze({
    seed,
    generatorVersion: TERRAIN_GENERATOR_VERSION,
    columns,
    rows,
    waterLevelDm: WATER_LEVEL_DM,
    heightsDm,
    water,
  });
}

/** Node y in mm for a row: the one float step, rounded once per row. */
function rowYMm(row: number): number {
  return Math.round(row * ROW_PITCH_MM);
}

/**
 * A C¹ soft floor for the coarse relief: the identity above SOFT_KNEE_DM, and
 * below it F + k²/(k + (K − n)) with k = K − F, which meets the identity with
 * value and slope 1 at the knee and eases toward F from above as n falls. It
 * is rational, so it stays integer with one floor. Version 1 clamped instead
 * and left about 10% of the golden map exactly flat at 10.5 m.
 */
export function softFloor(n: number): number {
  if (n >= SOFT_KNEE_DM) return n;
  const k = SOFT_KNEE_DM - SOFT_FLOOR_DM;
  return SOFT_FLOOR_DM + divFloor(k * k, k + (SOFT_KNEE_DM - n));
}

/** Rotates integer mm (x, y) by a Pythagorean-triple rotation; exact up to one floor per axis. */
export function rotateMm(rotation: GridRotation, x: number, y: number): { u: number; v: number } {
  const { a, b, c } = rotation;
  return { u: divFloor(a * x - b * y, c), v: divFloor(b * x + a * y, c) };
}

/** Smoothstep of t ∈ [0, ONE] in ONE-scaled fixed point; t²·(3·ONE − 2t) ≤ 2^30. */
function smooth(t: number): number {
  return divFloor(t * t * (3 * ONE - 2 * t), ONE * ONE);
}

/** Noise corner value in −NOISE_RANGE..NOISE_RANGE (tiny modulo bias is harmless here). */
function cornerValue(hash: number): number {
  return (hash % (2 * NOISE_RANGE + 1)) - NOISE_RANGE;
}

interface NoiseGrid {
  readonly cellMm: number;
  readonly amplitudeDm: number;
  readonly rotation: GridRotation;
  /** Seeded grid offset in rotated mm, in [0, cellMm). */
  readonly offsetU: number;
  readonly offsetV: number;
  /** Absolute cell index of the table's first column and row. */
  readonly cellU0: number;
  readonly cellV0: number;
  readonly width: number;
  readonly values: Int16Array;
}

/**
 * Precomputes one octave's corner values over the map's rotated bounding box,
 * so the per-node loop interpolates from a table instead of hashing four
 * corners per node. Corners hash their absolute cell index, so a feature's
 * value does not depend on where the table starts.
 */
function buildNoiseGrid(
  { cellMm, amplitudeDm, rotation }: Octave,
  octave: number,
  seedHash: number,
  widthMm: number,
  heightMm: number,
): NoiseGrid {
  const offsetU = hash32(octave, 0, OFFSET_SALT, seedHash) % cellMm;
  const offsetV = hash32(octave, 1, OFFSET_SALT, seedHash) % cellMm;
  let minU = Number.MAX_SAFE_INTEGER;
  let maxU = Number.MIN_SAFE_INTEGER;
  let minV = Number.MAX_SAFE_INTEGER;
  let maxV = Number.MIN_SAFE_INTEGER;
  // The rotation is linear, so the map's rotated extremes are at its corners.
  for (const [x, y] of [[0, 0], [widthMm, 0], [0, heightMm], [widthMm, heightMm]] as const) {
    const { u, v } = rotateMm(rotation, x, y);
    minU = Math.min(minU, u + offsetU);
    maxU = Math.max(maxU, u + offsetU);
    minV = Math.min(minV, v + offsetV);
    maxV = Math.max(maxV, v + offsetV);
  }
  const cellU0 = divFloor(minU, cellMm);
  const cellV0 = divFloor(minV, cellMm);
  const width = divFloor(maxU, cellMm) - cellU0 + 2;
  const height = divFloor(maxV, cellMm) - cellV0 + 2;
  const values = new Int16Array(width * height);
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      values[cy * width + cx] = cornerValue(hash32(cellU0 + cx, cellV0 + cy, octave, seedHash));
    }
  }
  return { cellMm, amplitudeDm, rotation, offsetU, offsetV, cellU0, cellV0, width, values };
}

/**
 * Bilinear value noise with smoothstep weights, scaled to ±amplitudeDm, on
 * the octave's rotated and offset grid. The weighted sum is kept at full
 * precision (|sum| ≤ 1000·2^20) and divided once, so there is a single floor
 * per octave.
 */
function sampleNoise(grid: NoiseGrid, xMm: number, yMm: number): number {
  const { cellMm, amplitudeDm, width, values, rotation } = grid;
  const { a, b, c } = rotation;
  const u = divFloor(a * xMm - b * yMm, c) + grid.offsetU;
  const v = divFloor(b * xMm + a * yMm, c) + grid.offsetV;
  const cu = divFloor(u, cellMm);
  const cv = divFloor(v, cellMm);
  const sx = smooth(divFloor((u - cu * cellMm) * ONE, cellMm));
  const sy = smooth(divFloor((v - cv * cellMm) * ONE, cellMm));
  const i = (cv - grid.cellV0) * width + (cu - grid.cellU0);
  const v00 = values[i] ?? 0;
  const v10 = values[i + 1] ?? 0;
  const v01 = values[i + width] ?? 0;
  const v11 = values[i + width + 1] ?? 0;
  const sum =
    v00 * (ONE - sx) * (ONE - sy) + v10 * sx * (ONE - sy) + v01 * (ONE - sx) * sy + v11 * sx * sy;
  return divFloor(sum * amplitudeDm, NOISE_RANGE * ONE * ONE);
}

interface River {
  /** Centreline y in mm at x = (index − RIVER_PAD_SAMPLES)·HALF_STEP_MM. */
  readonly yMm: readonly number[];
  readonly minYMm: number;
  readonly maxYMm: number;
}

/**
 * Samples the river centreline yC(x) = 46% of the map height + one octave of
 * 1-D value noise (600 m cells) × 220 m, every half step (2.5 m) across the
 * map plus a bank's width beyond each edge. Every node x is a sample x, so
 * distance queries need no interpolation.
 */
function buildRiver(seedHash: number, columns: number, heightMm: number): River {
  const base = divFloor(RIVER_CENTRE_PERCENT * heightMm, 100);
  const samples = 2 * (columns - 1) + 2 + 2 * RIVER_PAD_SAMPLES;
  const yMm: number[] = [];
  let minYMm = Number.MAX_SAFE_INTEGER;
  let maxYMm = Number.MIN_SAFE_INTEGER;
  for (let k = 0; k < samples; k++) {
    const xMm = (k - RIVER_PAD_SAMPLES) * HALF_STEP_MM;
    const cx = divFloor(xMm, RIVER_CELL_MM);
    const s = smooth(divFloor((xMm - cx * RIVER_CELL_MM) * ONE, RIVER_CELL_MM));
    const n0 = cornerValue(hash32(cx, RIVER_SALT, seedHash));
    const n1 = cornerValue(hash32(cx + 1, RIVER_SALT, seedHash));
    const y = base + divFloor((n0 * (ONE - s) + n1 * s) * RIVER_SWING_MM, NOISE_RANGE * ONE);
    yMm.push(y);
    if (y < minYMm) minYMm = y;
    if (y > maxYMm) maxYMm = y;
  }
  return { yMm, minYMm, maxYMm };
}

/**
 * Squared distance (mm²) from a point at half-step sample `sample` and height
 * `yMm` to the nearest centreline sample within one bank width in x. Samples
 * are 2.5 m apart, so this overestimates the true distance to the curve by
 * at most about 0.1 m at the 16 m channel edge.
 */
function riverDistanceSq(river: River, sample: number, yMm: number): number {
  const centre = sample + RIVER_PAD_SAMPLES;
  const from = Math.max(0, centre - RIVER_PAD_SAMPLES);
  const to = Math.min(river.yMm.length - 1, centre + RIVER_PAD_SAMPLES);
  let best = Number.MAX_SAFE_INTEGER;
  for (let k = from; k <= to; k++) {
    const dx = (k - centre) * HALF_STEP_MM;
    const dy = yMm - (river.yMm[k] ?? 0);
    const dSq = dx * dx + dy * dy;
    if (dSq < best) best = dSq;
  }
  return best;
}

/**
 * Height of a water body's cross-section at distance `dMm` from its centre.
 * A flat bed, then a ramp SHELF_RAMP_MM wide centred on `innerMm` that eases
 * (smoothstep) up to a low shore shelf just above the water, then a bank that
 * eases from the shelf up to the natural terrain at `outerMm`. Each piece
 * starts at the height the previous one ends on, so the profile is continuous.
 */
function shapeWaterBody(dMm: number, innerMm: number, outerMm: number, bedDm: number, naturalDm: number): number {
  const rampStart = innerMm - SHELF_RAMP_HALF_MM;
  const rampEnd = innerMm + SHELF_RAMP_HALF_MM;
  if (dMm <= rampStart) return bedDm;
  if (dMm < rampEnd) {
    return bedDm + divFloor((SHORE_DM - bedDm) * smooth(divFloor((dMm - rampStart) * ONE, SHELF_RAMP_MM)), ONE);
  }
  const s = smooth(divFloor((dMm - rampEnd) * ONE, outerMm - rampEnd));
  return SHORE_DM + divFloor((naturalDm - SHORE_DM) * s, ONE);
}

/**
 * Picks the lake centre with the seeded PRNG: candidates inside the edge
 * margin, taking the first whose banks clear the river's. If none does
 * within LAKE_ATTEMPTS, or the map is too small for the margin, there is no
 * lake: a lake that touched the river would merge into it, and "one river,
 * one separate lake" is the invariant callers rely on. The PRNG seed is
 * salted so a later scenario generator seeded with the same string does not
 * replay these draws.
 */
function placeLake(seed: string, river: River, widthMm: number, heightMm: number): { xMm: number; yMm: number } | undefined {
  const spanX = widthMm - 2 * LAKE_EDGE_MARGIN_MM;
  const spanY = heightMm - 2 * LAKE_EDGE_MARGIN_MM;
  if (spanX < 0 || spanY < 0) return undefined;
  const prng = createPrng(`terrain-lake:${seed}`);
  const clearanceSq = LAKE_RIVER_CLEARANCE_MM * LAKE_RIVER_CLEARANCE_MM;
  const reach = divFloor(LAKE_RIVER_CLEARANCE_MM, HALF_STEP_MM);
  for (let attempt = 0; attempt < LAKE_ATTEMPTS; attempt++) {
    // x on a half-step so it indexes a centreline sample; y in whole metres.
    const sample = divFloor(LAKE_EDGE_MARGIN_MM, HALF_STEP_MM) + prng.nextInt(divFloor(spanX, HALF_STEP_MM) + 1);
    const xMm = sample * HALF_STEP_MM;
    const yMm = LAKE_EDGE_MARGIN_MM + 1000 * prng.nextInt(divFloor(spanY, 1000) + 1);
    const centre = sample + RIVER_PAD_SAMPLES;
    let dSq = Number.MAX_SAFE_INTEGER;
    for (let k = Math.max(0, centre - reach); k <= Math.min(river.yMm.length - 1, centre + reach); k++) {
      const dx = (k - centre) * HALF_STEP_MM;
      const dy = yMm - (river.yMm[k] ?? 0);
      dSq = Math.min(dSq, dx * dx + dy * dy);
    }
    if (dSq >= clearanceSq) return { xMm, yMm };
  }
  return undefined;
}
