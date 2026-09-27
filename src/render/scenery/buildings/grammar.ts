import type { LotKind } from "../../../core/sim/api";
import {
  type AnchorName,
  type AnchorPoint,
  type AssetData,
  type AssetLod,
  type AssetRegistry,
  type MaterialSlot,
  buildingVariant,
  unpackBuildingVariant,
} from "../../art/AssetRegistry";
import { palette } from "../../art/palette";
import { type AoRamp, MeshBuilder } from "../meshBuilder";

/**
 * The building grammar (art direction "Buildings"):
 *
 *   footprint × floors (1–3) × roof (gable / hip / mansard / tower)
 *     × wall and roof material × details (inset windows, doors, cornice,
 *       chimneys that anchor smoke, dormers)
 *
 * Every kind binds the grammar differently (stucco townhouse, Baltic wooden
 * house, brick warehouse, twin-tower church, station with canopy and clock,
 * engine shed, water tower, post windmill, farmstead). Model space follows the
 * asset contract: +Y up, origin at ground contact, the front faces +X, length
 * along X and width along Z. Walls reach 1.6 m below ground so a building
 * seated on a gentle slope never floats. LOD1 keeps the silhouette (bodies,
 * roofs, chimneys) and drops the small details.
 *
 * All colour comes from the palette; the seed picks among a kind's palette
 * options, so the same seed always builds the same house.
 */

export const BUILDING_BUDGET = 600;
export const HERO_BUDGET = 1500;
export const BUILDING_KINDS: readonly LotKind[] = [
  "townhouse",
  "wooden-house",
  "warehouse",
  "church",
  "station",
  "engine-shed",
  "water-tower",
  "windmill",
  "farmstead",
];
export type RoofShape = "gable" | "hip" | "mansard" | "tower";

export interface BuildingSpec {
  readonly kind: LotKind;
  readonly lengthM: number;
  readonly widthM: number;
  readonly seed: number;
}

/** Per-slot builders and anchors: what an asset is made of before it becomes geometry. */
export interface BuildingParts {
  readonly slots: Partial<Record<MaterialSlot, MeshBuilder>>;
  readonly anchors: Partial<Record<AnchorName, AnchorPoint[]>>;
  readonly budget: number;
  /** Chosen grammar values, for tests and the lookdev record. */
  readonly floors: number;
  readonly roof: RoofShape;
}

const FLOOR_M = 3.2;
const PLINTH_M = 0.6;
/** Walls start this far below the ground origin. */
const BURY_M = 1.6;
const OVERHANG_M = 0.35;
const WALL_AO: AoRamp = { floor: 0.7, heightM: 3.5 };

/** Mulberry32: a tiny seeded generator for presentation choices only. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, options: readonly T[]): T {
  return options[Math.min(options.length - 1, Math.floor(r() * options.length))] as T;
}

interface V {
  x: number;
  y: number;
  z: number;
}

const v = (x: number, y: number, z: number): V => ({ x, y, z });

/** A wall face: centre line at (cx, cz), `u` along the face, `n` outward, `half` its half-width. */
interface Face {
  readonly cx: number;
  readonly cz: number;
  readonly ux: number;
  readonly uz: number;
  readonly nx: number;
  readonly nz: number;
  readonly half: number;
}

interface Body {
  readonly x: number;
  readonly z: number;
  readonly sx: number;
  readonly sz: number;
}

function faceOf(b: Body, side: "+x" | "-x" | "+z" | "-z"): Face {
  switch (side) {
    case "+x":
      return { cx: b.x + b.sx / 2, cz: b.z, ux: 0, uz: -1, nx: 1, nz: 0, half: b.sz / 2 };
    case "-x":
      return { cx: b.x - b.sx / 2, cz: b.z, ux: 0, uz: 1, nx: -1, nz: 0, half: b.sz / 2 };
    case "+z":
      return { cx: b.x, cz: b.z + b.sz / 2, ux: 1, uz: 0, nx: 0, nz: 1, half: b.sx / 2 };
    case "-z":
      return { cx: b.x, cz: b.z - b.sz / 2, ux: -1, uz: 0, nx: 0, nz: -1, half: b.sx / 2 };
  }
}

/** A point on a face: `s` along it, height `y`, `d` out from the wall. */
function at(f: Face, s: number, y: number, d: number): V {
  return v(f.cx + f.ux * s + f.nx * d, y, f.cz + f.uz * s + f.nz * d);
}

/** Collects the builders for one building. */
class Shell {
  readonly walls = new MeshBuilder().ao(WALL_AO);
  readonly roof = new MeshBuilder().ao({ floor: 0.85, heightM: 6 });
  readonly trim = new MeshBuilder().ao(WALL_AO);
  readonly glass = new MeshBuilder();
  readonly metal = new MeshBuilder();
  readonly sails = new MeshBuilder();
  readonly anchors: Partial<Record<AnchorName, AnchorPoint[]>> = {};

  anchor(name: AnchorName, p: AnchorPoint): void {
    (this.anchors[name] ??= []).push(p);
  }

  parts(budget: number, floors: number, roof: RoofShape): BuildingParts {
    const slots: Partial<Record<MaterialSlot, MeshBuilder>> = {};
    const all: [MaterialSlot, MeshBuilder][] = [
      ["walls", this.walls],
      ["roof", this.roof],
      ["trim", this.trim],
      ["glass", this.glass],
      ["metal", this.metal],
      ["sails", this.sails],
    ];
    for (const [slot, builder] of all) if (builder.triangleCount > 0) slots[slot] = builder;
    return { slots, anchors: this.anchors, budget, floors, roof };
  }
}

/** A wall body (box) from below ground to `top`. */
function body(sh: Shell, b: Body, top: number, color: number): void {
  sh.walls.color(color).box({ x: b.x, z: b.z, y0: -BURY_M, y1: top, sx: b.sx, sz: b.sz });
}

/** A stone plinth band slightly proud of the walls. */
function plinth(sh: Shell, b: Body): void {
  sh.trim.color(palette.rock).box({ x: b.x, z: b.z, y0: -BURY_M, y1: PLINTH_M, sx: b.sx + 0.12, sz: b.sz + 0.12, top: false });
}

/** A cornice band at the eaves. */
function cornice(sh: Shell, b: Body, y: number, color: number): void {
  sh.trim.color(color).box({ x: b.x, z: b.z, y0: y - 0.35, y1: y, sx: b.sx + 0.3, sz: b.sz + 0.3 });
}

/**
 * A gable roof over body `b` from the eaves at `eave`, ridge along `axis`,
 * with gable walls in `gableColor`. Returns the ridge height.
 */
function gableRoof(sh: Shell, b: Body, eave: number, pitch: number, axis: "x" | "z", color: number, gableColor: number): number {
  const o = OVERHANG_M;
  const run = (axis === "z" ? b.sx : b.sz) / 2;
  const ridge = eave + run * pitch;
  const inside = v(b.x, eave + (ridge - eave) / 3, b.z);
  sh.roof.color(color);
  if (axis === "z") {
    const z0 = b.z - b.sz / 2 - o;
    const z1 = b.z + b.sz / 2 + o;
    const drop = o * pitch;
    for (const side of [1, -1]) {
      const xe = b.x + side * (run + o);
      sh.roof.quad(v(xe, eave - drop, z0), v(xe, eave - drop, z1), v(b.x, ridge, z1), v(b.x, ridge, z0), inside);
    }
    sh.walls.color(gableColor);
    for (const side of [1, -1]) {
      const z = b.z + side * (b.sz / 2);
      sh.walls.triangle(v(b.x - run, eave, z), v(b.x + run, eave, z), v(b.x, ridge, z), v(b.x, eave, b.z));
    }
  } else {
    const x0 = b.x - b.sx / 2 - o;
    const x1 = b.x + b.sx / 2 + o;
    const drop = o * pitch;
    for (const side of [1, -1]) {
      const ze = b.z + side * (run + o);
      sh.roof.quad(v(x0, eave - drop, ze), v(x1, eave - drop, ze), v(x1, ridge, b.z), v(x0, ridge, b.z), inside);
    }
    sh.walls.color(gableColor);
    for (const side of [1, -1]) {
      const x = b.x + side * (b.sx / 2);
      sh.walls.triangle(v(x, eave, b.z - run), v(x, eave, b.z + run), v(x, ridge, b.z), v(b.x, eave, b.z));
    }
  }
  return ridge;
}

/** A hip roof: four planes, the ridge along the longer side (a pyramid on a square). */
function hipRoof(sh: Shell, b: Body, eave: number, pitch: number, color: number): number {
  const o = OVERHANG_M;
  const hx = b.sx / 2 + o;
  const hz = b.sz / 2 + o;
  const run = Math.min(hx, hz);
  const ridge = eave + run * pitch;
  const rx = hx - run;
  const rz = hz - run;
  const e = eave - o * pitch * 0.5;
  const inside = v(b.x, eave + (ridge - eave) / 3, b.z);
  const c = (dx: number, dz: number, y: number) => v(b.x + dx, y, b.z + dz);
  sh.roof.color(color);
  sh.roof.quad(c(hx, -hz, e), c(hx, hz, e), c(rx, rz, ridge), c(rx, -rz, ridge), inside);
  sh.roof.quad(c(-hx, hz, e), c(-hx, -hz, e), c(-rx, -rz, ridge), c(-rx, rz, ridge), inside);
  sh.roof.quad(c(hx, hz, e), c(-hx, hz, e), c(-rx, rz, ridge), c(rx, rz, ridge), inside);
  sh.roof.quad(c(-hx, -hz, e), c(hx, -hz, e), c(rx, -rz, ridge), c(-rx, -rz, ridge), inside);
  return ridge;
}

/** A mansard: a steep lower storey inset from the eaves, then a shallow hip on top. */
function mansardRoof(sh: Shell, b: Body, eave: number, color: number): number {
  const o = OVERHANG_M;
  const inset = 0.9;
  const lowTop = eave + 2.2;
  const hx = b.sx / 2 + o;
  const hz = b.sz / 2 + o;
  const ix = b.sx / 2 - inset;
  const iz = b.sz / 2 - inset;
  const inside = v(b.x, eave + 1, b.z);
  const c = (dx: number, dz: number, y: number) => v(b.x + dx, y, b.z + dz);
  sh.roof.color(color);
  sh.roof.quad(c(hx, -hz, eave), c(hx, hz, eave), c(ix, iz, lowTop), c(ix, -iz, lowTop), inside);
  sh.roof.quad(c(-hx, hz, eave), c(-hx, -hz, eave), c(-ix, -iz, lowTop), c(-ix, iz, lowTop), inside);
  sh.roof.quad(c(hx, hz, eave), c(-hx, hz, eave), c(-ix, iz, lowTop), c(ix, iz, lowTop), inside);
  sh.roof.quad(c(-hx, -hz, eave), c(hx, -hz, eave), c(ix, -iz, lowTop), c(-ix, -iz, lowTop), inside);
  return hipRoof(sh, { x: b.x, z: b.z, sx: 2 * ix - 2 * o, sz: 2 * iz - 2 * o }, lowTop, 0.35, color);
}

/** A tower roof: a pyramid spire on a square, optionally with a needle on top. */
function towerRoof(sh: Shell, b: Body, eave: number, height: number, color: number, needle = 0): number {
  const o = 0.25;
  const hx = b.sx / 2 + o;
  const hz = b.sz / 2 + o;
  const top = eave + height;
  sh.roof.color(color).cone({ x: b.x, z: b.z, y0: eave, y1: top, radius: Math.hypot(hx, hz), sides: 4, phase: Math.PI / 4, bottom: false });
  if (needle > 0) sh.metal.color(palette.brass).cone({ x: b.x, z: b.z, y0: top - 0.2, y1: top + needle, radius: 0.12, sides: 3 });
  return top + needle;
}

/**
 * Inset windows along a face on one floor: dark glass, a stone sill that
 * juts out below and a lintel above, so each window reads as set into the wall.
 */
function windows(sh: Shell, f: Face, y: number, count: number, w: number, h: number, trimColor: number, from = -1, to = 1): void {
  if (count <= 0) return;
  const span = (to - from) * f.half;
  const step = span / count;
  sh.glass.color(palette.slate);
  for (let i = 0; i < count; i++) {
    const s = from * f.half + step * (i + 0.5);
    const inside = at(f, s, y + h / 2, -1);
    sh.glass.quad(at(f, s - w / 2, y, 0.02), at(f, s + w / 2, y, 0.02), at(f, s + w / 2, y + h, 0.02), at(f, s - w / 2, y + h, 0.02), inside);
    sh.trim.color(trimColor);
    const sw = w / 2 + 0.12;
    // Sill: front and top.
    sh.trim.quad(at(f, s - sw, y - 0.14, 0.14), at(f, s + sw, y - 0.14, 0.14), at(f, s + sw, y, 0.14), at(f, s - sw, y, 0.14), inside);
    sh.trim.quad(at(f, s - sw, y, 0.14), at(f, s + sw, y, 0.14), at(f, s + sw, y, 0), at(f, s - sw, y, 0), at(f, s, y - 1, -1));
    // Lintel: front and underside.
    sh.trim.quad(at(f, s - sw, y + h, 0.08), at(f, s + sw, y + h, 0.08), at(f, s + sw, y + h + 0.22, 0.08), at(f, s - sw, y + h + 0.22, 0.08), inside);
    sh.trim.quad(at(f, s - sw, y + h, 0), at(f, s + sw, y + h, 0), at(f, s + sw, y + h, 0.08), at(f, s - sw, y + h, 0.08), at(f, s, y + h + 1, -1));
  }
}

/** A door with a step, at offset `s` along a face; records the door anchor. */
function door(sh: Shell, f: Face, s: number, w: number, h: number, color = palette.timberDark): void {
  const inside = at(f, s, h / 2, -1);
  sh.trim.color(color).quad(at(f, s - w / 2, 0, 0.03), at(f, s + w / 2, 0, 0.03), at(f, s + w / 2, h, 0.03), at(f, s - w / 2, h, 0.03), inside);
  const step = at(f, s, 0, 0.35);
  sh.trim.color(palette.rock).box({ x: step.x, z: step.z, y0: -0.4, y1: 0.18, sx: Math.abs(f.ux) * (w + 0.4) + Math.abs(f.nx) * 0.7, sz: Math.abs(f.uz) * (w + 0.4) + Math.abs(f.nz) * 0.7 });
  const a = at(f, s, 0, 0.8);
  sh.anchor("door", { x: a.x, y: 0, z: a.z });
}

/** A brick chimney from inside the roof to `top`, with a stone cap; its smoke anchor sits on top. */
function chimney(sh: Shell, x: number, z: number, base: number, top: number): void {
  sh.walls.color(palette.brick).box({ x, z, y0: base, y1: top, sx: 0.7, sz: 0.9 });
  sh.trim.color(palette.rock).box({ x, z, y0: top, y1: top + 0.15, sx: 0.85, sz: 1.05, top: true });
  sh.anchor("smoke", { x, y: top + 0.15, z });
}

/** A small gabled dormer on a roof slope facing +X or −X, with a window. */
function dormer(sh: Shell, x: number, z: number, y: number, facing: 1 | -1, wall: number, roofColor: number): void {
  const w = 1.4;
  const d = 1.6;
  const h = 1.3;
  const bx = x - facing * d / 2;
  sh.walls.color(wall).box({ x: bx, z, y0: y - 0.8, y1: y + h, sx: d, sz: w, top: false });
  const b: Body = { x: bx, z, sx: d, sz: w };
  // Its little roof runs back into the main roof (ridge along X).
  const ridge = y + h + (w / 2) * 0.9;
  const inside = v(bx, y + h + 0.2, z);
  sh.roof.color(roofColor);
  for (const side of [1, -1]) {
    sh.roof.quad(v(bx - d / 2, y + h - 0.05, z + side * (w / 2 + 0.12)), v(bx + d / 2 + 0.1, y + h - 0.05, z + side * (w / 2 + 0.12)), v(bx + d / 2 + 0.1, ridge, z), v(bx - d / 2, ridge, z), inside);
  }
  sh.walls.color(wall).triangle(v(bx + facing * d / 2, y + h, z - w / 2), v(bx + facing * d / 2, y + h, z + w / 2), v(bx + facing * d / 2, ridge, z), inside);
  const f = faceOf(b, facing === 1 ? "+x" : "-x");
  sh.glass.color(palette.slate).quad(at(f, -0.4, y - 0.4, 0.02), at(f, 0.4, y - 0.4, 0.02), at(f, 0.4, y + 0.7, 0.02), at(f, -0.4, y + 0.7, 0.02), at(f, 0, y, -1));
}

function windowCount(width: number, spacing: number): number {
  return Math.max(1, Math.floor((width - 0.8) / spacing));
}

// --- Kinds -----------------------------------------------------------------

function townhouse(spec: BuildingSpec, lod: AssetLod): BuildingParts {
  const r = rng(spec.seed);
  const sh = new Shell();
  const floors = spec.seed % 3 === 0 ? 3 : 2;
  const wall = pick(r, [palette.stucco, palette.ochre, palette.blush, palette.sage, palette.limeWhite]);
  const roofColor = r() < 0.15 ? palette.slate : pick(r, [palette.roofTile, palette.roofTileDark, palette.roofTileLight]);
  const trimColor = wall === palette.limeWhite ? palette.stucco : palette.limeWhite;
  const roof: RoofShape = pick(r, ["gable", "gable", "hip", "mansard"] as const);
  const b: Body = { x: 0, z: 0, sx: spec.lengthM, sz: spec.widthM };
  const eave = PLINTH_M + floors * FLOOR_M;
  body(sh, b, eave, wall);
  let ridge: number;
  if (roof === "mansard") ridge = mansardRoof(sh, b, eave, roofColor);
  else if (roof === "hip") ridge = hipRoof(sh, b, eave, 0.75, roofColor);
  else ridge = gableRoof(sh, b, eave, 0.8, "z", roofColor, wall);
  chimney(sh, -b.sx * 0.18, b.sz * 0.28, eave, ridge + 0.6);
  if (b.sz >= 10) chimney(sh, -b.sx * 0.18, -b.sz * 0.28, eave, ridge + 0.6);
  if (lod === 0) {
    plinth(sh, b);
    cornice(sh, b, eave, trimColor);
    const perFloor = windowCount(b.sz, 2.5);
    const front = faceOf(b, "+x");
    for (let f = 0; f < floors; f++) {
      const y = PLINTH_M + f * FLOOR_M + 0.85;
      // The ground floor leaves the middle bay for the door.
      if (f === 0 && perFloor >= 3) {
        const side = Math.floor(perFloor / 2);
        windows(sh, front, y, side, 1.0, 1.5, trimColor, -1, -0.3);
        windows(sh, front, y, side, 1.0, 1.5, trimColor, 0.3, 1);
      } else if (f > 0) {
        windows(sh, front, y, perFloor, 1.0, 1.6, trimColor);
      }
      windows(sh, faceOf(b, "-x"), y, perFloor, 1.0, f === 0 ? 1.4 : 1.6, trimColor);
    }
    door(sh, front, 0, 1.3, 2.4);
    if (roof === "gable" && floors === 2) dormer(sh, b.sx * 0.28, 0, eave + 0.9, 1, wall, roofColor);
  }
  return sh.parts(BUILDING_BUDGET, floors, roof);
}

function woodenHouse(spec: BuildingSpec, lod: AssetLod): BuildingParts {
  const r = rng(spec.seed);
  const sh = new Shell();
  const wall = pick(r, [palette.timber, palette.timberDark]);
  const roofColor = r() < 0.6 ? palette.shingle : pick(r, [palette.roofTile, palette.roofTileDark]);
  const trimColor = palette.limeWhite;
  const b: Body = { x: 0, z: 0, sx: spec.lengthM, sz: spec.widthM };
  const eave = PLINTH_M * 0.6 + FLOOR_M;
  body(sh, b, eave, wall);
  const ridge = gableRoof(sh, b, eave, 1.0, "z", roofColor, wall);
  chimney(sh, -b.sx * 0.1, b.sz * 0.2, eave, ridge + 0.5);
  if (lod === 0) {
    // Corner boards in lime white, the Baltic trim that frames a log house.
    for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      sh.trim.color(trimColor).box({ x: cx * (b.sx / 2 - 0.05), z: cz * (b.sz / 2 - 0.05), y0: 0, y1: eave, sx: 0.22, sz: 0.22 });
    }
    const front = faceOf(b, "+x");
    const n = windowCount(b.sz, 2.6);
    windows(sh, front, 1.1, Math.max(1, Math.floor(n / 2)), 0.9, 1.2, trimColor, -1, -0.25);
    windows(sh, front, 1.1, Math.max(1, Math.floor(n / 2)), 0.9, 1.2, trimColor, 0.25, 1);
    windows(sh, faceOf(b, "-x"), 1.1, n, 0.9, 1.2, trimColor);
    windows(sh, faceOf(b, "+z"), 1.1, 1, 0.9, 1.2, trimColor);
    windows(sh, faceOf(b, "-z"), 1.1, 1, 0.9, 1.2, trimColor);
    door(sh, front, 0, 1.1, 2.1);
    dormer(sh, b.sx * 0.22, 0, eave + 0.9, 1, wall, roofColor);
  }
  return sh.parts(BUILDING_BUDGET, 1, "gable");
}

function warehouse(spec: BuildingSpec, lod: AssetLod): BuildingParts {
  const r = rng(spec.seed);
  const sh = new Shell();
  const floors = r() < 0.5 ? 1 : 2;
  const b: Body = { x: 0, z: 0, sx: spec.lengthM, sz: spec.widthM };
  const eave = PLINTH_M + floors * (FLOOR_M + 0.6);
  body(sh, b, eave, palette.brick);
  gableRoof(sh, b, eave, 0.55, "z", palette.slate, palette.brick);
  if (lod === 0) {
    plinth(sh, b);
    cornice(sh, b, eave, palette.stucco);
    const front = faceOf(b, "+x");
    // Two wide loading doors, then small high windows.
    door(sh, front, -b.sz * 0.22, 2.6, 3.0);
    door(sh, front, b.sz * 0.22, 2.6, 3.0);
    for (let f = 0; f < floors; f++) {
      const y = PLINTH_M + f * (FLOOR_M + 0.6) + (f === 0 ? 2.4 : 1.2);
      if (f > 0) windows(sh, front, y, windowCount(b.sz, 3.2), 0.9, 1.1, palette.stucco);
      windows(sh, faceOf(b, "-x"), y, windowCount(b.sz, 3.2), 0.9, 1.1, palette.stucco);
      windows(sh, faceOf(b, "+z"), y, windowCount(b.sx, 3.6), 0.9, 1.1, palette.stucco);
      windows(sh, faceOf(b, "-z"), y, windowCount(b.sx, 3.6), 0.9, 1.1, palette.stucco);
    }
  }
  return sh.parts(BUILDING_BUDGET, floors, "gable");
}

/** The landmark: a lime-white nave, twin front towers with spires, an apse and tall windows. */
function church(spec: BuildingSpec, lod: AssetLod): BuildingParts {
  const r = rng(spec.seed);
  const sh = new Shell();
  const wall = r() < 0.7 ? palette.limeWhite : palette.stucco;
  const roofColor = r() < 0.6 ? palette.slate : palette.roofTileDark;
  const spireColor = r() < 0.5 ? palette.slate : palette.coachGreen;
  const L = spec.lengthM;
  const W = spec.widthM;
  const towerS = Math.min(5, W * 0.34);
  const naveW = W - 1.2;
  const apseR = naveW / 2 - 0.4;
  // The nave runs from the apse (whose drum reaches the back of the lot) to the towers.
  const nave: Body = { x: (apseR - towerS) / 2, z: 0, sx: L - towerS - apseR, sz: naveW };
  const naveEave = 9.5;
  body(sh, nave, naveEave, wall);
  gableRoof(sh, nave, naveEave, 1.05, "x", roofColor, wall);
  // Front block between the towers, carrying the entrance.
  const front: Body = { x: L / 2 - towerS / 2, z: 0, sx: towerS, sz: W - 2 * towerS };
  body(sh, front, naveEave + 2, wall);
  gableRoof(sh, front, naveEave + 2, 0.9, "x", roofColor, wall);
  // Twin towers.
  const towerTop = 21;
  for (const side of [1, -1]) {
    const t: Body = { x: L / 2 - towerS / 2, z: side * (W / 2 - towerS / 2), sx: towerS, sz: towerS };
    body(sh, t, towerTop, wall);
    towerRoof(sh, t, towerTop, 9, spireColor, lod === 0 ? 1.4 : 0);
    if (lod === 0) {
      cornice(sh, t, towerTop, palette.stucco);
      cornice(sh, t, naveEave + 2, palette.stucco);
      for (const s of ["+x", "-x", "+z", "-z"] as const) {
        // Belfry openings, and a tall window lower down.
        windows(sh, faceOf(t, s), towerTop - 3.2, 1, 1.0, 2.0, palette.stucco);
        if (s !== "-x") windows(sh, faceOf(t, s), 5.5, 1, 0.8, 2.6, palette.stucco);
      }
    }
  }
  // Apse at the back: a half-octagon drum under a cone.
  const apseX = nave.x - nave.sx / 2;
  sh.walls.color(wall).prism({ x: apseX, z: 0, y0: -BURY_M, y1: naveEave - 1.5, radius: apseR, sides: 8, phase: Math.PI / 8, top: false });
  sh.roof.color(roofColor).cone({ x: apseX, z: 0, y0: naveEave - 1.5, y1: naveEave + 2.5, radius: naveW / 2, sides: 8, phase: Math.PI / 8 });
  if (lod === 0) {
    plinth(sh, nave);
    cornice(sh, nave, naveEave, palette.stucco);
    // Tall nave windows and buttresses between them.
    const bays = Math.max(3, Math.floor(nave.sx / 3.6));
    for (const side of ["+z", "-z"] as const) {
      const f = faceOf(nave, side);
      windows(sh, f, 3.2, bays, 1.1, 4.0, palette.stucco);
      for (let i = 0; i <= bays; i++) {
        const s = -f.half + (2 * f.half * i) / bays;
        const p = at(f, s, 0, 0.3);
        sh.trim.color(wall).box({ x: p.x, z: p.z, y0: -BURY_M, y1: 6.5, sx: Math.abs(f.ux) * 0.7 + Math.abs(f.nx) * 0.6, sz: Math.abs(f.uz) * 0.7 + Math.abs(f.nz) * 0.6 });
      }
    }
    const entrance = faceOf(front, "+x");
    door(sh, entrance, 0, 2.2, 4.2);
    // A rose window above the door.
    sh.glass.color(palette.slate);
    const rose = at(entrance, 0, 8.2, 0.04);
    for (let i = 0; i < 8; i++) {
      const a0 = (i * Math.PI) / 4;
      const a1 = ((i + 1) * Math.PI) / 4;
      sh.glass.triangle(rose, at(entrance, Math.cos(a0) * 1.3, 8.2 + Math.sin(a0) * 1.3, 0.04), at(entrance, Math.cos(a1) * 1.3, 8.2 + Math.sin(a1) * 1.3, 0.04), at(entrance, 0, 8.2, -1));
    }
  }
  return sh.parts(HERO_BUDGET, 2, "tower");
}

/** A station: hip-roofed hall, a gabled centre bay with a clock, and a platform canopy behind (−X). */
function station(spec: BuildingSpec, lod: AssetLod): BuildingParts {
  const r = rng(spec.seed);
  const sh = new Shell();
  const wall = r() < 0.5 ? palette.ochre : palette.brick;
  const trimColor = wall === palette.brick ? palette.stucco : palette.limeWhite;
  const canopyDepth = 4.5;
  const hall: Body = { x: canopyDepth / 2, z: 0, sx: spec.lengthM - canopyDepth, sz: spec.widthM - 2 };
  const eave = PLINTH_M + 2 * FLOOR_M;
  body(sh, hall, eave, wall);
  const ridge = hipRoof(sh, hall, eave, 0.6, palette.slate);
  const bay: Body = { x: hall.x + 0.3, z: 0, sx: hall.sx, sz: 6 };
  body(sh, bay, eave + 1.2, wall);
  gableRoof(sh, bay, eave + 1.2, 0.8, "x", palette.slate, wall);
  chimney(sh, hall.x - 1, hall.sz * 0.3, eave, ridge + 0.4);
  chimney(sh, hall.x - 1, -hall.sz * 0.3, eave, ridge + 0.4);
  // The canopy over the platform side: posts and a lean-to roof.
  const cx0 = hall.x - hall.sx / 2;
  const cx1 = cx0 - canopyDepth;
  const cz = spec.widthM / 2;
  const posts = Math.max(3, Math.floor(spec.widthM / 4.5));
  for (let i = 0; i < posts; i++) {
    const z = -cz + 1 + ((2 * cz - 2) * i) / (posts - 1);
    sh.metal.color(palette.loco).box({ x: cx1 + 0.4, z, y0: 0, y1: 3.6, sx: 0.18, sz: 0.18, top: false });
  }
  sh.roof.color(palette.slate).quad(v(cx0 + 0.1, 4.4, -cz), v(cx0 + 0.1, 4.4, cz), v(cx1, 3.6, cz), v(cx1, 3.6, -cz), v(cx0, 3.0, 0));
  sh.metal.color(palette.loco).quad(v(cx1, 3.6, -cz), v(cx1, 3.6, cz), v(cx1, 3.3, cz), v(cx1, 3.3, -cz), v(cx0, 3.4, 0));
  if (lod === 0) {
    plinth(sh, hall);
    cornice(sh, hall, eave, trimColor);
    const front = faceOf(bay, "+x");
    door(sh, front, 0, 1.8, 2.8);
    const hallFront = faceOf(hall, "+x");
    for (let f = 0; f < 2; f++) {
      const y = PLINTH_M + f * FLOOR_M + 0.8;
      windows(sh, hallFront, y, 2, 1.0, 1.6, trimColor, -1, -0.4);
      windows(sh, hallFront, y, 2, 1.0, 1.6, trimColor, 0.4, 1);
      windows(sh, faceOf(hall, "-x"), y, windowCount(hall.sz, 3.2), 1.0, f === 0 ? 2.0 : 1.6, trimColor);
    }
    windows(sh, front, PLINTH_M + FLOOR_M + 0.8, 1, 1.2, 1.7, trimColor);
    // The clock in the gable: a lime-white face and two hands.
    const clockY = eave + 1.9;
    const face = at(front, 0, clockY, 0.05);
    sh.trim.color(palette.limeWhite);
    for (let i = 0; i < 8; i++) {
      const a0 = (i * Math.PI) / 4;
      const a1 = ((i + 1) * Math.PI) / 4;
      sh.trim.triangle(face, at(front, Math.cos(a0) * 0.75, clockY + Math.sin(a0) * 0.75, 0.05), at(front, Math.cos(a1) * 0.75, clockY + Math.sin(a1) * 0.75, 0.05), at(front, 0, clockY, -1));
    }
    sh.metal.color(palette.loco);
    sh.metal.quad(at(front, -0.04, clockY, 0.08), at(front, 0.04, clockY, 0.08), at(front, 0.04, clockY + 0.55, 0.08), at(front, -0.04, clockY + 0.55, 0.08), at(front, 0, clockY, -1));
    sh.metal.quad(at(front, 0, clockY - 0.04, 0.08), at(front, 0.4, clockY - 0.04, 0.08), at(front, 0.4, clockY + 0.04, 0.08), at(front, 0, clockY + 0.04, 0.08), at(front, 0, clockY, -1));
  }
  return sh.parts(BUILDING_BUDGET, 2, "hip");
}

/** An engine shed: long brick hall, gable roof with a smoke lantern, big doors at the +X end. */
function engineShed(spec: BuildingSpec, lod: AssetLod): BuildingParts {
  const sh = new Shell();
  const b: Body = { x: 0, z: 0, sx: spec.lengthM, sz: spec.widthM };
  const eave = 6.4;
  body(sh, b, eave, palette.brick);
  const ridge = gableRoof(sh, b, eave, 0.5, "x", palette.slate, palette.brick);
  // Smoke lantern along the ridge, open to the sky above the engines.
  const lantern: Body = { x: 0, z: 0, sx: b.sx * 0.7, sz: 2.2 };
  sh.walls.color(palette.timberDark).box({ x: 0, z: 0, y0: ridge - 0.6, y1: ridge + 0.9, sx: lantern.sx, sz: lantern.sz, top: false });
  gableRoof(sh, lantern, ridge + 0.9, 0.5, "x", palette.slate, palette.timberDark);
  for (const x of [-lantern.sx / 3, 0, lantern.sx / 3]) sh.anchor("smoke", { x, y: ridge + 1.6, z: 0 });
  if (lod === 0) {
    plinth(sh, b);
    cornice(sh, b, eave, palette.stucco);
    const front = faceOf(b, "+x");
    door(sh, front, -b.sz * 0.24, 4.2, 5.2);
    door(sh, front, b.sz * 0.24, 4.2, 5.2);
    for (const s of ["+z", "-z"] as const) windows(sh, faceOf(b, s), 2.2, windowCount(b.sx, 4), 1.4, 2.6, palette.stucco);
    windows(sh, faceOf(b, "-x"), 3.2, 2, 1.4, 2.0, palette.stucco);
  }
  return sh.parts(BUILDING_BUDGET, 1, "gable");
}

/** A water tower: an octagonal masonry base, a timber tank and a conical roof. */
function waterTower(spec: BuildingSpec, lod: AssetLod): BuildingParts {
  const r = rng(spec.seed);
  const sh = new Shell();
  const radius = Math.min(spec.lengthM, spec.widthM) / 2 - 0.6;
  const baseTop = 7.5;
  const tankTop = baseTop + 4;
  sh.walls.color(r() < 0.5 ? palette.brick : palette.rock).prism({ x: 0, z: 0, y0: -BURY_M, y1: baseTop, radius: radius * 0.9, sides: 8, phase: Math.PI / 8, top: false });
  sh.walls.color(palette.timber).prism({ x: 0, z: 0, y0: baseTop, y1: tankTop, radius: radius + 0.3, sides: 8, phase: Math.PI / 8, top: false, bottom: true });
  sh.roof.color(r() < 0.5 ? palette.shingle : palette.slate).cone({ x: 0, z: 0, y0: tankTop, y1: tankTop + 3, radius: radius + 0.6, sides: 8, phase: Math.PI / 8, bottom: true });
  if (lod === 0) {
    sh.trim.color(palette.stucco).prism({ x: 0, z: 0, y0: baseTop - 0.4, y1: baseTop, radius: radius * 0.9 + 0.15, sides: 8, phase: Math.PI / 8, bottom: true });
    sh.metal.color(palette.loco).cone({ x: 0, z: 0, y0: tankTop + 2.9, y1: tankTop + 3.8, radius: 0.12, sides: 3 });
    const b: Body = { x: 0, z: 0, sx: 2 * radius * 0.9 * Math.cos(Math.PI / 8), sz: 2 * radius * 0.9 * Math.cos(Math.PI / 8) };
    door(sh, faceOf(b, "+x"), 0, 1.1, 2.2);
    for (const s of ["-x", "+z", "-z"] as const) windows(sh, faceOf(b, s), 3.6, 1, 0.6, 1.2, palette.stucco);
  }
  return sh.parts(BUILDING_BUDGET, 1, "tower");
}

/**
 * A post mill: a timber body on a central post over a stone trestle, a gable
 * roof, and four sails on the front (+X) that turn about `sail_hub` (the sails
 * slot is separate so the renderer can spin it).
 */
function windmill(_spec: BuildingSpec, lod: AssetLod): BuildingParts {
  const sh = new Shell();
  sh.trim.color(palette.rock).box({ x: 0, z: 0, y0: -BURY_M, y1: 0.8, sx: 3.4, sz: 3.4 });
  sh.walls.color(palette.timberDark).prism({ x: 0, z: 0, y0: 0.8, y1: 3.6, radius: 0.35, sides: 4, phase: Math.PI / 4, top: false });
  const b: Body = { x: 0, z: 0, sx: 4.4, sz: 3.6 };
  sh.walls.color(palette.timber).box({ x: 0, z: 0, y0: 3.4, y1: 8.4, sx: b.sx, sz: b.sz, bottom: true });
  gableRoof(sh, b, 8.4, 0.9, "x", palette.shingle, palette.timber);
  // Tail pole to turn the mill into the wind.
  sh.trim.color(palette.timberDark).quad(v(-2.2, 3.6, -0.12), v(-2.2, 3.6, 0.12), v(-5.6, 0.2, 0.12), v(-5.6, 0.2, -0.12), v(-3, 1, 0));
  const hub = { x: b.sx / 2 + 0.5, y: 7.2, z: 0 };
  sh.anchor("sail_hub", hub);
  sh.metal.color(palette.timberDark).box({ x: hub.x - 0.3, z: 0, y0: hub.y - 0.25, y1: hub.y + 0.25, sx: 0.8, sz: 0.5 });
  // Four sails: a stock and a lattice-cloth panel, both faces, in the plane x = hub.x.
  const sailLength = 7.6;
  const sailWidth = 1.6;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const dy = Math.sin(a);
    const dz = Math.cos(a);
    const p = (along: number, across: number, dx: number) => v(hub.x + dx, hub.y + dy * along - dz * across, dz * along + dy * across);
    // Each flat part is two back-to-back quads: FrontSide shows whichever faces the camera.
    for (const side of [1, -1]) {
      sh.sails.color(palette.timberDark);
      sh.sails.quad(p(0, -0.1, 0.12), p(sailLength, -0.1, 0.12), p(sailLength, 0.1, 0.12), p(0, 0.1, 0.12), p(sailLength / 2, 0, 0.12 - side));
      sh.sails.color(palette.creamPanel);
      sh.sails.quad(p(1.4, 0.15, 0.08), p(sailLength, 0.15, 0.08), p(sailLength, 0.15 + sailWidth, 0.08), p(1.4, 0.15 + sailWidth, 0.08), p(4, 1, 0.08 - side));
    }
  }
  if (lod === 0) {
    door(sh, faceOf(b, "-x"), 0, 0.9, 1.9);
    windows(sh, faceOf(b, "+z"), 5.6, 1, 0.6, 0.8, palette.limeWhite);
    windows(sh, faceOf(b, "-z"), 5.6, 1, 0.6, 0.8, palette.limeWhite);
  }
  return sh.parts(BUILDING_BUDGET, 1, "gable");
}

/** A farmstead yard: a timber house at the front and a tall barn behind. */
function farmstead(spec: BuildingSpec, lod: AssetLod): BuildingParts {
  const r = rng(spec.seed);
  const sh = new Shell();
  const L = spec.lengthM;
  const W = spec.widthM;
  const houseRoof = r() < 0.5 ? palette.shingle : palette.roofTile;
  const house: Body = { x: L / 2 - 4, z: -W / 2 + 5.5, sx: 7, sz: 10 };
  const houseEave = 0.4 + FLOOR_M;
  body(sh, house, houseEave, palette.timber);
  const houseRidge = gableRoof(sh, house, houseEave, 1.0, "z", houseRoof, palette.timber);
  chimney(sh, house.x - 0.8, house.z + 2, houseEave, houseRidge + 0.5);
  const barn: Body = { x: -L / 2 + 5, z: 0, sx: 9, sz: W - 2 };
  const barnEave = 4.4;
  body(sh, barn, barnEave, palette.timberDark);
  gableRoof(sh, barn, barnEave, 1.15, "z", palette.shingle, palette.timberDark);
  const shed: Body = { x: L / 2 - 3.5, z: W / 2 - 3, sx: 5, sz: 4 };
  body(sh, shed, 2.6, palette.timberDark);
  gableRoof(sh, shed, 2.6, 0.7, "x", palette.shingle, palette.timberDark);
  if (lod === 0) {
    const front = faceOf(house, "+x");
    windows(sh, front, 1.0, 1, 0.9, 1.2, palette.limeWhite, -1, -0.3);
    windows(sh, front, 1.0, 1, 0.9, 1.2, palette.limeWhite, 0.3, 1);
    windows(sh, faceOf(house, "-z"), 1.0, 2, 0.9, 1.2, palette.limeWhite);
    windows(sh, faceOf(house, "+z"), 1.0, 1, 0.9, 1.2, palette.limeWhite);
    door(sh, front, 0, 1.0, 2.0);
    door(sh, faceOf(barn, "+x"), 0, 3.2, 3.4);
    for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      sh.trim.color(palette.limeWhite).box({ x: house.x + cx * (house.sx / 2 - 0.05), z: house.z + cz * (house.sz / 2 - 0.05), y0: 0, y1: houseEave, sx: 0.2, sz: 0.2 });
    }
  }
  return sh.parts(BUILDING_BUDGET, 1, "gable");
}

const KINDS: Readonly<Record<LotKind, (spec: BuildingSpec, lod: AssetLod) => BuildingParts>> = {
  townhouse,
  "wooden-house": woodenHouse,
  warehouse,
  church,
  station,
  "engine-shed": engineShed,
  "water-tower": waterTower,
  windmill,
  farmstead,
};

/** Builds a building's parts (builders per slot, anchors, budget) from its spec. */
export function buildBuilding(spec: BuildingSpec, lod: AssetLod): BuildingParts {
  return KINDS[spec.kind](spec, lod);
}

/** Registers every building kind; variants come from `buildingVariant(length, width, seed)`. */
export function registerBuildingAssets(registry: AssetRegistry): void {
  for (const kind of BUILDING_KINDS) {
    registry.register(
      kind,
      (variant, lod): AssetData => {
        const { lengthM, widthM, seed } = unpackBuildingVariant(variant);
        const parts = buildBuilding({ kind, lengthM, widthM, seed }, lod);
        const slots: AssetData["slots"] = {};
        for (const [slot, builder] of Object.entries(parts.slots) as [MaterialSlot, MeshBuilder][]) slots[slot] = builder.build();
        const hl = lengthM / 2;
        const hw = widthM / 2;
        return {
          slots,
          anchors: parts.anchors,
          footprint: [
            [hl, hw],
            [hl, -hw],
            [-hl, -hw],
            [-hl, hw],
          ],
          triangleBudget: parts.budget,
        };
      },
      { cache: false },
    );
  }
}

export { buildingVariant };
