import { SQRT3, type Terrain } from "../../core/sim/api";
import { CREST_ROUND_M, EARTHWORK_WEIGHT_FROM_X, FORMATION_HALF_WIDTH_M, SIDE_SLOPE_RUN, lodLattice, lodNodeIndex, naturalHeightM } from "../terrain/earthworks";
import type { TerrainShading } from "../terrain/terrainShading";
import { portalSkylineV } from "./assets";
import { BORE_DEPTH_M, PORTAL_HALF_WIDTH_M, PORTAL_MAX_WING_M, PORTAL_TOP_V, PORTAL_WALL_M, PORTAL_WING_RUN } from "./dimensions";
import { smoothstep } from "../math";

/**
 * The hill plug behind a tunnel portal (art direction "Structures": "a hill
 * plug, so the hill reads as closed over the bore"), drawn with the terrain's
 * own material and shading so it reads as the hillside itself.
 *
 * The approach's earthworks (`earthworks.ts`) cut a cutting whose end rounds
 * off around the portal node, so without a plug the hill would show a bowl
 * behind the portal face; and where the tunnel runs shallow the bore would
 * stand in the open. The plug is a patch of ground behind the face (s ≥
 * PLUG_START_M, just behind the parapet) whose height is
 *
 *   H = max(min(N, T), M) + PLUG_LIFT_M, with
 *   P(u) = z + skyline(u) + PLUG_UNDER_COPING_M      (the face top, then the wings' 1 : 1.5 fall),
 *   T = P(u) + max(0, s − wall) / 1.5                 (the hillside rising behind the face),
 *   M = P₀ − max(0, |u| − face) / run(s) − max(0, s − MOUND_FLAT_M) / MOUND_END_RUN
 *                                                      (a mound over the bore where the hill is low),
 *
 * with N the natural ground, s metres into the tunnel, u across it, P₀ the
 * face-top level and `face` the face's half width. Where the hill is high the
 * plug fills the bowl up to a 1 : 1.5 slope rising from the face top, and it
 * meets the natural hill where that slope does; where the hill is low it raises
 * a mound over the bore, flat over its drawn depth (so the dark bore never
 * shows through), whose sides fall at 1 : 1.5 at the face, like the wings that
 * retain its front, easing to 1 : 3 behind it (`run`), and whose far end falls
 * at 1 : 3, so it reads as a hillock rather than a berm. It lies on the terrain's own
 * 1.25 m sub-lattice (as refined earthworks do), clipped at s = PLUG_START_M,
 * so where it follows the natural ground its triangles lie exactly in the
 * lattice triangles' planes, PLUG_LIFT_M above. Its normals are the terrain's
 * smooth normals tilted by the departure's gradient and its colours the
 * terrain's baked ones, so the shader (splat, relief, grain) treats it as
 * natural ground. Presentation only: the sim's terrain never changes.
 */

export const PLUG_START_M = 0.6;
export const PLUG_UNDER_COPING_M = 0.25;
export const PLUG_LIFT_M = 0.04;
/** The mound stays flat over the drawn bore (BORE_DEPTH_M) and a metre more, then falls at MOUND_END_RUN. */
export const MOUND_FLAT_M = BORE_DEPTH_M + 1;
export const MOUND_END_RUN = 3;
/**
 * The mound's sides ease from the wings' 1 : 1.5 at the face to 1 : MOUND_SIDE_RUN over MOUND_EASE_M behind it,
 * and its flat crown narrows from the face's width to MOUND_CROWN_HALF_M, so it rises as a ridge over the bore.
 */
export const MOUND_SIDE_RUN = 2;
export const MOUND_EASE_M: readonly [number, number] = [1.5, 5];
export const MOUND_CROWN_HALF_M = 2.5;
/** The plug's sub-lattice step: the refined earthworks' 1.25 m. */
const SUB = 4;

/** A portal's frame: its node on the sim plan, the track height there and the unit direction into the tunnel. */
export interface PortalFrame {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly tx: number;
  readonly ty: number;
}

/** What the portal's face and wings see in front of them. */
export type PortalApproach = "ground" | "bridge" | "buffer";

/** The earthworks' side-slope rise at plan distance d from a ground track's centreline (see `earthworks.ts`). */
function cutRise(d: number): number {
  const x = d - FORMATION_HALF_WIDTH_M;
  const b = CREST_ROUND_M;
  const ease = x <= 0 ? 0 : x < b ? (x * x) / (2 * b) : x - b / 2;
  return ease / SIDE_SLOPE_RUN;
}

/**
 * Each wing's length: it runs out from the face until the skyline meets the ground in front of it (a ground
 * approach's cutting, or the natural ground), capped at PORTAL_MAX_WING_M.
 */
export function portalWings(terrain: Terrain, f: PortalFrame, approach: PortalApproach): { left: number; right: number } {
  const lat = lodLattice(terrain, 0);
  const out = { left: 0, right: 0 };
  for (const side of [1, -1] as const) {
    let length = PORTAL_MAX_WING_M;
    for (let u = PORTAL_HALF_WIDTH_M; u <= PORTAL_HALF_WIDTH_M + PORTAL_MAX_WING_M; u += 0.25) {
      // Right of the direction into the tunnel is (ty, −tx); the wing on side +1 stands there.
      const x = f.x + f.ty * side * u;
      const y = f.y - f.tx * side * u;
      const n = naturalHeightM(terrain, lat, x, y);
      const ground = Number.isNaN(n) ? f.z : approach === "ground" ? Math.min(n, f.z + cutRise(u)) : n;
      if (f.z + portalSkylineV(u) <= ground + 0.05) {
        length = u - PORTAL_HALF_WIDTH_M;
        break;
      }
    }
    if (side === 1) out.right = length;
    else out.left = length;
  }
  return out;
}

/** Plug geometry in the terrain chunks' layout: world positions, smooth normals, linear colours, zero earthwork attribute. */
export interface PlugData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly earthwork: Float32Array;
  readonly triangleCount: number;
}

export class HillPlug {
  readonly data: PlugData;
  /** Plan box of the plug (sim metres). */
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /** Highest point, for shadow bounds. */
  readonly maxZ: number;
  private readonly lat;
  private readonly skyAt0: number;

  constructor(
    private readonly terrain: Terrain,
    shading: TerrainShading,
    readonly frame: PortalFrame,
    readonly wings: { readonly left: number; readonly right: number },
    /** How far the plug reaches behind the face and to each side. */
    readonly depthM: number,
    readonly halfWidthM: number,
  ) {
    this.lat = lodLattice(terrain, 0);
    this.skyAt0 = frame.z + PORTAL_TOP_V + PLUG_UNDER_COPING_M;
    const f = frame;
    // The region's plan box: s ∈ [PLUG_START_M, depth], u ∈ [−halfWidth, halfWidth].
    const corners = [
      [PLUG_START_M, -halfWidthM],
      [PLUG_START_M, halfWidthM],
      [depthM, -halfWidthM],
      [depthM, halfWidthM],
    ].map(([s, u]) => [f.x + f.tx * (s ?? 0) + f.ty * (u ?? 0), f.y + f.ty * (s ?? 0) - f.tx * (u ?? 0)] as const);
    this.minX = Math.min(...corners.map((c) => c[0]));
    this.maxX = Math.max(...corners.map((c) => c[0]));
    this.minY = Math.min(...corners.map((c) => c[1]));
    this.maxY = Math.max(...corners.map((c) => c[1]));
    const { data, maxZ } = this.build(shading);
    this.data = data;
    this.maxZ = maxZ;
  }

  /** Local (s into the tunnel, u to the right) of sim plan (x, y). */
  private local(x: number, y: number): { s: number; u: number } {
    const dx = x - this.frame.x;
    const dy = y - this.frame.y;
    return { s: dx * this.frame.tx + dy * this.frame.ty, u: dx * this.frame.ty - dy * this.frame.tx };
  }

  /** The plug's surface height (m) at sim plan (x, y), or NaN outside it. */
  heightAt(x: number, y: number): number {
    const { s, u } = this.local(x, y);
    if (s < PLUG_START_M || s > this.depthM || Math.abs(u) > this.halfWidthM) return Number.NaN;
    return this.surface(x, y, s, u);
  }

  private surface(x: number, y: number, s: number, u: number): number {
    const n = naturalHeightM(this.terrain, this.lat, x, y);
    const p = this.frame.z + portalSkylineV(u) + PLUG_UNDER_COPING_M;
    const t = p + Math.max(0, s - PORTAL_WALL_M) / PORTAL_WING_RUN;
    const ease = smoothstep(MOUND_EASE_M[0], MOUND_EASE_M[1], s);
    const run = PORTAL_WING_RUN + (MOUND_SIDE_RUN - PORTAL_WING_RUN) * ease;
    const crown = PORTAL_HALF_WIDTH_M + (MOUND_CROWN_HALF_M - PORTAL_HALF_WIDTH_M) * ease;
    const m = this.skyAt0 - Math.max(0, Math.abs(u) - crown) / run - Math.max(0, s - MOUND_FLAT_M) / MOUND_END_RUN;
    const natural = Number.isNaN(n) ? this.frame.z : n;
    return Math.max(Math.min(natural, t), m) + PLUG_LIFT_M;
  }

  private build(shading: TerrainShading): { data: PlugData; maxZ: number } {
    const a = this.lat.spacingM / SUB;
    const h = a * (SQRT3 / 2);
    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const ew: number[] = [];
    let maxZ = -Infinity;
    const r0 = Math.floor(this.minY / h) - 1;
    const r1 = Math.ceil(this.maxY / h) + 1;
    const normal = new Float64Array(3);
    const colour = new Float64Array(3);
    const push = (x: number, y: number): void => {
      const { s, u } = this.local(x, y);
      const z = this.surface(x, y, Math.max(s, PLUG_START_M), u);
      this.shade(shading, x, y, z, normal, colour);
      pos.push(x, z, -y);
      nor.push(normal[0] ?? 0, normal[1] ?? 1, normal[2] ?? 0);
      col.push(colour[0] ?? 0, colour[1] ?? 0, colour[2] ?? 0);
      // The earthwork attribute: the lip weight in full where the plug is made ground (the relief's lattice facets
      // and the slope soil fade out there, as on earthworks), with no earthwork colour (it stays grassed).
      const natural = naturalHeightM(this.terrain, this.lat, x, y);
      const made = Number.isNaN(natural) ? 0 : smoothstep(0.05, 0.3, z - PLUG_LIFT_M - natural);
      ew.push(EARTHWORK_WEIGHT_FROM_X * made, 0, 99);
      maxZ = Math.max(maxZ, z);
    };
    const inRegion = (x: number, y: number): boolean => {
      const { s, u } = this.local(x, y);
      return s <= this.depthM && Math.abs(u) <= this.halfWidthM && s >= PLUG_START_M - a;
    };
    for (let rs = r0; rs <= r1; rs++) {
      const y0 = rs * h;
      const qs0 = Math.floor(this.minX / a - rs / 2) - 1;
      const qs1 = Math.ceil(this.maxX / a - rs / 2) + 1;
      for (let qs = qs0; qs <= qs1; qs++) {
        const x00 = a * (qs + rs / 2);
        // Down triangle (qs, rs), (qs + 1, rs), (qs, rs + 1) and up triangle (qs + 1, rs), (qs + 1, rs + 1), (qs, rs + 1),
        // both counter-clockwise on the sim plan, so they face up.
        const tris: [number, number][][] = [
          [
            [x00, y0],
            [x00 + a, y0],
            [x00 + a / 2, y0 + h],
          ],
          [
            [x00 + a, y0],
            [x00 + 1.5 * a, y0 + h],
            [x00 + a / 2, y0 + h],
          ],
        ];
        for (const tri of tris) {
          const cx = ((tri[0]?.[0] ?? 0) + (tri[1]?.[0] ?? 0) + (tri[2]?.[0] ?? 0)) / 3;
          const cy = ((tri[0]?.[1] ?? 0) + (tri[1]?.[1] ?? 0) + (tri[2]?.[1] ?? 0)) / 3;
          if (!inRegion(cx, cy)) continue;
          for (const poly of clipFront(tri, (x, y) => this.local(x, y).s - PLUG_START_M)) {
            for (const [x, y] of poly) push(x, y);
          }
        }
      }
    }
    const triangleCount = pos.length / 9;
    return {
      data: {
        positions: new Float32Array(pos),
        normals: new Float32Array(nor),
        colors: new Float32Array(col),
        earthwork: new Float32Array(ew),
        triangleCount,
      },
      maxZ,
    };
  }

  /** The terrain's smooth normal at (x, y), tilted by the gradient of the plug's departure from it, and its baked colour. */
  private shade(shading: TerrainShading, x: number, y: number, z: number, normal: Float64Array, colour: Float64Array): void {
    const t = this.terrain;
    const lat = this.lat;
    const aa = lat.spacingM;
    const rf = y / (aa * (SQRT3 / 2));
    const qf = x / aa - rf / 2;
    const Q = Math.floor(qf);
    const R = Math.floor(rf);
    const fq = qf - Q;
    const fr = rf - R;
    const corners: [number, number][] =
      fq + fr <= 1
        ? [
            [lodNodeIndex(t, lat, Q, R), 1 - fq - fr],
            [lodNodeIndex(t, lat, Q + 1, R), fq],
            [lodNodeIndex(t, lat, Q, R + 1), fr],
          ]
        : [
            [lodNodeIndex(t, lat, Q + 1, R), 1 - fr],
            [lodNodeIndex(t, lat, Q, R + 1), 1 - fq],
            [lodNodeIndex(t, lat, Q + 1, R + 1), fq + fr - 1],
          ];
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    let wsum = 0;
    const n0 = naturalHeightM(t, lat, x, y);
    const departure = Number.isNaN(n0) ? 0 : z - PLUG_LIFT_M - n0;
    const dry = Math.min(1, Math.max(0, (Math.abs(departure) - 0.05) / 0.55));
    for (const [node, w] of corners) {
      if (node < 0 || w === 0) continue;
      nx += w * (shading.normals[3 * node] ?? 0);
      ny += w * (shading.normals[3 * node + 1] ?? 1);
      nz += w * (shading.normals[3 * node + 2] ?? 0);
      r += w * ((shading.colors[3 * node] ?? 0) * (1 - dry) + (shading.dryColors[3 * node] ?? 0) * dry);
      g += w * ((shading.colors[3 * node + 1] ?? 0) * (1 - dry) + (shading.dryColors[3 * node + 1] ?? 0) * dry);
      b += w * ((shading.colors[3 * node + 2] ?? 0) * (1 - dry) + (shading.dryColors[3 * node + 2] ?? 0) * dry);
      wsum += w;
    }
    if (wsum > 0) {
      r /= wsum;
      g /= wsum;
      b /= wsum;
    }
    // World normal (x, up, −north) → sim (east, north, up), as a heightfield slope, then tilted by ∇(departure).
    const up = ny > 1e-6 ? ny : 1e-6;
    let sx = nx / up;
    let sy = -nz / up;
    const e = 0.3;
    const d = (px: number, py: number): number => {
      const l = this.local(px, py);
      const natural = naturalHeightM(t, lat, px, py);
      return this.surface(px, py, Math.max(l.s, PLUG_START_M), l.u) - (Number.isNaN(natural) ? 0 : natural);
    };
    sx -= (d(x + e, y) - d(x - e, y)) / (2 * e);
    sy -= (d(x, y + e) - d(x, y - e)) / (2 * e);
    const len = Math.hypot(sx, sy, 1);
    normal[0] = sx / len;
    normal[1] = 1 / len;
    normal[2] = -sy / len;
    colour[0] = r;
    colour[1] = g;
    colour[2] = b;
  }
}

/** Clips a plan triangle to the half plane f(x, y) ≥ 0: nothing, the triangle, or a fan of one or two triangles. */
function clipFront(tri: readonly (readonly [number, number])[], f: (x: number, y: number) => number): [number, number][][] {
  const d = tri.map(([x, y]) => f(x, y));
  if (d.every((v) => v >= 0)) return [tri.map(([x, y]) => [x, y] as [number, number])];
  if (d.every((v) => v < 0)) return [];
  const poly: [number, number][] = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const a = tri[i] as readonly [number, number];
    const b = tri[j] as readonly [number, number];
    const da = d[i] ?? 0;
    const db = d[j] ?? 0;
    if (da >= 0) poly.push([a[0], a[1]]);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      poly.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  const out: [number, number][][] = [];
  for (let i = 1; i + 1 < poly.length; i++) {
    const p0 = poly[0] as [number, number];
    const p1 = poly[i] as [number, number];
    const p2 = poly[i + 1] as [number, number];
    // Keep only triangles with real area (a vertex on the line can leave a sliver of zero area).
    if (Math.abs((p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0])) > 1e-9) out.push([p0, p1, p2]);
  }
  return out;
}
