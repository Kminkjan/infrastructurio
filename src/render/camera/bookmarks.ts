import type { DioramaScenery } from "../../core/scenarios/baltic-diorama";
import { type Terrain, nodeOfOffset, terrainBoundsM } from "../../core/terrain";
import { toWorld } from "../../core/lattice";
import { simToWorld } from "../coords";
import { sampleTerrainHeightM } from "../terrain/heightfieldRay";
import { type GroundPoint, ISO_PITCH_RAD, NAMED_ZOOMS } from "./isoMath";

/**
 * Look Gate A preparation (art direction "Look gates A and B"): four camera
 * bookmarks over the static diorama and the pitch A/B, chosen by URL:
 *
 * - `?bookmark=1` a town close-up at Close zoom (12 ppm);
 * - `?bookmark=2` forest and river in the mid band (4 ppm);
 * - `?bookmark=3` the lake and the windmill at Region (2.5 ppm);
 * - `?bookmark=4` the whole diorama at Far (0.9 ppm);
 * - `?pitch=30` switches the one pitch constant to 30° for the A/B. This is
 *   the only place a pitch other than true isometric may come from.
 * - `?tweak=1` shows the lookdev tweak panel, in any build. Without it the
 *   panel stays hidden, so the gate views are clean by default.
 *
 * The bookmarks are computed from the scenario, so they follow the layout;
 * docs/art-direction.md records the exact states for the golden seed.
 */

/** The A/B alternative to true isometric (35.264°). */
export const LOOK_AB_PITCH_RAD = Math.PI / 6;
/** The mid band spans 2–5 ppm; 4 sits between Region and Default. */
export const MID_BAND_PPM = 4;
/** Bookmark 1 looks this far north of the square–church midpoint, so the church towers fit. */
const CLOSE_NORTH_NUDGE_M = 12;

export type BookmarkId = 1 | 2 | 3 | 4;

export interface LookdevParams {
  readonly bookmark: BookmarkId | undefined;
  readonly pitch: number;
  /** `?tweak=1` true, `?tweak=0` false, otherwise undefined (hidden). */
  readonly tweak: boolean | undefined;
}

export function parseLookdevParams(search: string): LookdevParams {
  const params = new URLSearchParams(search);
  const b = Number(params.get("bookmark"));
  const bookmark = b === 1 || b === 2 || b === 3 || b === 4 ? b : undefined;
  return {
    bookmark,
    pitch: params.get("pitch") === "30" ? LOOK_AB_PITCH_RAD : ISO_PITCH_RAD,
    tweak: tweakParam(params.get("tweak")),
  };
}

function tweakParam(value: string | null): boolean | undefined {
  if (value === "1") return true;
  if (value === "0") return false;
  return undefined;
}

/** Whether the tweak panel shows: only with `?tweak=1`, in any build (owner-facing views stay clean). */
export function showTweakPanel(params: LookdevParams): boolean {
  return params.tweak === true;
}

export interface CameraBookmark {
  readonly id: BookmarkId;
  readonly label: string;
  /** Look-at point on the Y = 0 datum (world X, Z). */
  readonly target: GroundPoint;
  readonly ppm: number;
  readonly yawStep: number;
}

/** Water nodes connected to the west edge (the river), by flood fill over the six-neighbour lattice. */
function riverMask(t: Terrain): Uint8Array {
  const mask = new Uint8Array(t.water.length);
  const stack: number[] = [];
  for (let row = 0; row < t.rows; row++) {
    const i = row * t.columns;
    if (t.water[i] === 1 && mask[i] === 0) {
      mask[i] = 1;
      stack.push(i);
    }
  }
  const even = [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]] as const;
  const odd = [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]] as const;
  while (stack.length > 0) {
    const i = stack.pop() as number;
    const row = Math.floor(i / t.columns);
    const col = i - row * t.columns;
    for (const [dc, dr] of row % 2 === 0 ? even : odd) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || r < 0 || c >= t.columns || r >= t.rows) continue;
      const j = r * t.columns + c;
      if (t.water[j] === 1 && mask[j] === 0) {
        mask[j] = 1;
        stack.push(j);
      }
    }
  }
  return mask;
}

function planOf(t: Terrain, index: number): { x: number; y: number } {
  const row = Math.floor(index / t.columns);
  return toWorld(nodeOfOffset(index - row * t.columns, row));
}

/** Sim plan points (m) of the lake's water nodes: water not connected to the west edge's river. */
export function lakePoints(t: Terrain): { x: number; y: number }[] {
  const river = riverMask(t);
  const out: { x: number; y: number }[] = [];
  for (let k = 0; k < t.water.length; k++) if (t.water[k] === 1 && river[k] === 0) out.push(planOf(t, k));
  return out;
}

/**
 * The datum target (Y = 0) that puts the ground at sim plan (x, y) in the
 * middle of the view. The camera looks at the datum, so ground
 * h metres up would otherwise sit h·cos(pitch)·ppm px above centre. The view
 * ray through that ground carries on down to the datum h/tan(pitch) farther
 * from the camera (north at yaw 0), and that datum point is the target.
 */
export function focusTarget(t: Terrain, x: number, y: number, pitch: number, yaw = 0): GroundPoint {
  const h = sampleTerrainHeightM(t, x, y) ?? t.waterLevelDm / 10;
  const away = h / Math.tan(pitch);
  const w = simToWorld(x, y, 0);
  // The camera sits along (sin yaw, cos yaw) from its target (isoMath.cameraOffset).
  return { x: w.x - away * Math.sin(yaw), z: w.z - away * Math.cos(yaw) };
}

/**
 * The four Look Gate A bookmarks for a layout, all at yaw step 0 (the camera
 * looking north, the rest view every other slice uses). `pitch` is the view's
 * pitch, so the 30° A/B frames the same ground.
 */
export function dioramaBookmarks(s: DioramaScenery, t: Terrain, pitch: number = ISO_PITCH_RAD): CameraBookmark[] {
  const ground = (x: number, y: number): GroundPoint => focusTarget(t, x, y, pitch);
  const bounds = terrainBoundsM(t);
  const river = riverMask(t);

  // 1: the largest town, framed between its square and its church, nudged north so
  // the church's 30 m towers stay inside the top of the view.
  const town = s.towns[0];
  const church = s.lots.find((l) => l.kind === "church");
  const townX = town ? town.centre.xMm / 1000 : bounds.maxX / 2;
  const townY = town ? town.centre.yMm / 1000 : bounds.maxY / 2;
  const closeX = church ? (townX + church.xMm / 1000) / 2 : townX;
  const closeY = (church ? (townY + church.yMm / 1000) / 2 : townY) + CLOSE_NORTH_NUDGE_M;

  // 2: the densest forest cell 50–200 m from the river, framed halfway to the water.
  const riverPoints: { x: number; y: number }[] = [];
  for (let k = 0; k < river.length; k++) if (river[k] === 1) riverPoints.push(planOf(t, k));
  let best = { score: -1, x: bounds.maxX / 2, y: bounds.maxY / 2 };
  const f = s.forest;
  const cell = f.cellMm / 1000;
  for (let j = 0; j < f.rows; j++) {
    for (let i = 0; i < f.columns; i++) {
      const d = f.density[j * f.columns + i] ?? 0;
      if (d < 200) continue;
      const cx = (i + 0.5) * cell;
      const cy = (j + 0.5) * cell;
      let nearest = Infinity;
      let wx = 0;
      let wy = 0;
      for (const p of riverPoints) {
        if (Math.abs(p.x - cx) > 200 || Math.abs(p.y - cy) > 200) continue;
        const dist = Math.hypot(p.x - cx, p.y - cy);
        if (dist < nearest) {
          nearest = dist;
          wx = p.x;
          wy = p.y;
        }
      }
      if (nearest < 50 || nearest > 200) continue;
      const score = d * 1000 - nearest;
      if (score > best.score) best = { score, x: (cx + wx) / 2, y: (cy + wy) / 2 };
    }
  }

  // 3: halfway between the lake's centre and the windmill.
  const lake = lakePoints(t);
  let lakeX = 0;
  let lakeY = 0;
  for (const p of lake) {
    lakeX += p.x;
    lakeY += p.y;
  }
  const mill = s.lots.find((l) => l.kind === "windmill");
  const lx = lake.length > 0 ? lakeX / lake.length : bounds.maxX / 2;
  const ly = lake.length > 0 ? lakeY / lake.length : bounds.maxY / 2;
  const regionX = mill ? (lx + mill.xMm / 1000) / 2 : lx;
  const regionY = mill ? (ly + mill.yMm / 1000) / 2 : ly;

  return [
    { id: 1, label: "Town close-up", target: ground(closeX, closeY), ppm: NAMED_ZOOMS.close, yawStep: 0 },
    { id: 2, label: "Forest and river", target: ground(best.x, best.y), ppm: MID_BAND_PPM, yawStep: 0 },
    { id: 3, label: "Lake and windmill", target: ground(regionX, regionY), ppm: NAMED_ZOOMS.region, yawStep: 0 },
    { id: 4, label: "Whole diorama", target: ground(bounds.maxX / 2, bounds.maxY / 2), ppm: NAMED_ZOOMS.far, yawStep: 0 },
  ];
}
