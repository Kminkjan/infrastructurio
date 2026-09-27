import { Vector3, type Vector3Like } from "three";
import { type Axial, type Terrain, heightDmAt, nearestNode, terrainBoundsM } from "../../core/sim/api";
import { type SimPoint, simToWorld, worldToSim } from "../coords";
import { type LodLattice, lodLattice, naturalHeightM } from "./earthworks";
import { terrainHeightRangeM } from "./terrainGeometry";

/**
 * Analytic terrain picking (architecture "Picking", step 4): march a view ray
 * against the sim's own heights, never the rendered mesh, so picks match what
 * validation sees and need no GPU or raycast of visual meshes.
 *
 * Heights between nodes are the planar interpolation within the lattice
 * triangle, which is exactly the LOD0 mesh surface (`earthworks.ts`
 * `naturalHeightM`, the one copy of it). The march runs in sim
 * space (x east, y north, z up) after converting the ray once through
 * coords.ts, then converts the hit back.
 */

/** March step along the ray. */
export const RAY_STEP_M = 2.5;
/** Bisections after the first step that crosses the surface (2.5 m → 3.9 cm). */
export const RAY_BISECTIONS = 6;

export interface TerrainHit {
  /** World-space hit on the terrain surface. */
  readonly point: Vector3;
  /** The lattice node nearest the hit; always on the map. */
  readonly node: Axial;
  /** That node's sim height. */
  readonly nodeHeightDm: number;
}

/**
 * Terrain height (m) at sim plan position (x, y): barycentric interpolation
 * within the lattice triangle that contains it, or undefined off the map.
 * In axial coordinates each (q, r) cell splits along q + r = 1 into two
 * equilateral lattice triangles, so the weights are the fractional parts.
 */
export function sampleTerrainHeightM(t: Terrain, x: number, y: number): number | undefined {
  const h = naturalHeightM(t, lod0Of(t), x, y);
  return Number.isNaN(h) ? undefined : h;
}

const lod0s = new WeakMap<Terrain, LodLattice>();

/** The terrain's LOD0 lattice (the sim's own 5 m lattice), cached per terrain. */
function lod0Of(t: Terrain): LodLattice {
  let lat = lod0s.get(t);
  if (!lat) {
    lat = lodLattice(t, 0);
    lod0s.set(t, lat);
  }
  return lat;
}

interface MarchBox {
  readonly maxX: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const boxes = new WeakMap<Terrain, MarchBox>();

/**
 * A drawn surface to march instead of the sim's own heights: the earthworks'
 * conformed heightfield (`earthworks.ts` `DrawnHeightfield`), so the cursor
 * lands on the ground the player sees. `minZ`/`maxZ` bound its heights where
 * they leave the natural range (cuts below it, fills above it).
 */
export interface HeightSampler {
  /** Height (m) at sim plan (x, y), NaN off the map. */
  heightAtM(x: number, y: number): number;
  readonly minZ: number;
  readonly maxZ: number;
}

/**
 * The ground the player sees at sim plan (x, y), metres: the drawn surface (`surface`, the
 * earthworks' conformed heightfield, natural wherever nothing is refined), or the water
 * plane over a lower bed; undefined off the map. The ghost's drop lines and end-height
 * tags measure against it (PR #83 review), so they meet a cutting's floor or an
 * embankment's crest where it is drawn; sim-facing heights keep the tool's `groundMmAt`.
 */
export function visibleGroundM(surface: Pick<HeightSampler, "heightAtM">, waterLevelM: number, x: number, y: number): number | undefined {
  const h = surface.heightAtM(x, y);
  return Number.isNaN(h) ? undefined : Math.max(h, waterLevelM);
}

/** The ray being marched, in sim space with a unit direction; module scratch so marching never allocates. */
const ray = {
  o: { x: 0, y: 0, z: 0 } as SimPoint,
  d: { x: 0, y: 0, z: 0 } as SimPoint,
  terrain: undefined as Terrain | undefined,
  lat: undefined as LodLattice | undefined,
  surface: undefined as HeightSampler | undefined,
};

/**
 * Casts a world-space ray at the terrain and writes the first surface hit into
 * `out`, without allocating. Returns false on a miss. With `surface`, it marches
 * that drawn surface (earthworks) instead of the sim heights.
 *
 * It clips the ray to the map's box, samples every RAY_STEP_M, and on the
 * first step from above the surface to on or below it bisects RAY_BISECTIONS
 * times, then takes one secant step: the surface is planar within a triangle,
 * so that lands on it almost exactly. Off-map samples count as "above", so a
 * low ray that passes under the map's open edge stops at the edge.
 * The march can skip a ridge thinner than one step, which cannot happen at
 * the iso pitch on slopes under 35°.
 */
export function raycastTerrain(t: Terrain, originWorld: Vector3Like, dirWorld: Vector3Like, out: Vector3, surface?: HeightSampler): boolean {
  const o = worldToSim(originWorld, ray.o);
  const d = worldToSim(dirWorld, ray.d);
  const len = Math.hypot(d.x, d.y, d.z);
  if (!(len > 0)) return false;
  d.x /= len;
  d.y /= len;
  d.z /= len;
  ray.terrain = t;
  ray.lat = lod0Of(t);
  ray.surface = surface;

  const box = marchBox(t);
  const minZ = surface && surface.minZ - 0.01 < box.minZ ? surface.minZ - 0.01 : box.minZ;
  const maxZ = surface && surface.maxZ + 0.01 > box.maxZ ? surface.maxZ + 0.01 : box.maxZ;
  let tEnter = 0;
  let tExit = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const start = axis === 0 ? o.x : axis === 1 ? o.y : o.z;
    const dir = axis === 0 ? d.x : axis === 1 ? d.y : d.z;
    const min = axis === 2 ? minZ : 0;
    const max = axis === 0 ? box.maxX : axis === 1 ? box.maxY : maxZ;
    if (Math.abs(dir) < 1e-12) {
      if (start < min || start > max) return false;
      continue;
    }
    const a = (min - start) / dir;
    const b = (max - start) / dir;
    tEnter = Math.max(tEnter, Math.min(a, b));
    tExit = Math.min(tExit, Math.max(a, b));
  }
  if (!(tEnter <= tExit)) return false;

  let lo = tEnter;
  let fLo = gapAt(lo);
  while (lo < tExit) {
    const next = Math.min(lo + RAY_STEP_M, tExit);
    const fNext = gapAt(next);
    if (fLo > 0 && fNext <= 0) {
      let hi = next;
      let fHi = fNext;
      for (let i = 0; i < RAY_BISECTIONS; i++) {
        const mid = (lo + hi) / 2;
        const fMid = gapAt(mid);
        if (fMid > 0) {
          lo = mid;
          fLo = fMid;
        } else {
          hi = mid;
          fHi = fMid;
        }
      }
      const s = Number.isFinite(fLo) ? lo + ((hi - lo) * fLo) / (fLo - fHi) : hi;
      simToWorld(o.x + d.x * s, o.y + d.y * s, o.z + d.z * s, out);
      return true;
    }
    lo = next;
    fLo = fNext;
  }
  return false;
}

/** Picks the terrain under a world-space ray: the surface point and its nearest node. */
export function intersectTerrain(t: Terrain, originWorld: Vector3Like, dirWorld: Vector3Like): TerrainHit | undefined {
  const point = new Vector3();
  if (!raycastTerrain(t, originWorld, dirWorld, point)) return undefined;
  const sim = worldToSim(point);
  let node = nearestNode({ x: sim.x, y: sim.y });
  let nodeHeightDm = heightDmAt(t, node);
  if (nodeHeightDm === undefined) {
    // An edge hit can round to a node just off the map; step back onto it.
    const box = marchBox(t);
    node = nearestNode({ x: Math.min(Math.max(sim.x, 0), box.maxX), y: Math.min(Math.max(sim.y, 0), box.maxY) });
    nodeHeightDm = heightDmAt(t, node);
    if (nodeHeightDm === undefined) return undefined;
  }
  return { point, node, nodeHeightDm };
}

/** Height of the current ray above the terrain (or the drawn surface) at ray parameter s; +∞ off the map. */
function gapAt(s: number): number {
  const { o, d, terrain, lat, surface } = ray;
  if (!terrain || !lat) return Infinity;
  const h = surface ? surface.heightAtM(o.x + d.x * s, o.y + d.y * s) : naturalHeightM(terrain, lat, o.x + d.x * s, o.y + d.y * s);
  return Number.isNaN(h) ? Infinity : o.z + d.z * s - h;
}

function marchBox(t: Terrain): MarchBox {
  let box = boxes.get(t);
  if (!box) {
    const b = terrainBoundsM(t);
    const range = terrainHeightRangeM(t);
    // A centimetre of vertical slack keeps a perfectly flat map's slab from having zero thickness.
    box = { maxX: b.maxX, maxY: b.maxY, minZ: range.minM - 0.01, maxZ: range.maxM + 0.01 };
    boxes.set(t, box);
  }
  return box;
}
