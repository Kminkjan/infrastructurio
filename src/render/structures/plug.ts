import { SQRT3, type Terrain } from "../../core/sim/api";
import { smoothstep } from "../math";
import { CREST_ROUND_M, EARTHWORK_MIN_M, FORMATION_HALF_WIDTH_M, SIDE_SLOPE_RUN, encodeEarthworkPotential, lodLattice, lodNodeIndex, naturalAtSub, naturalHeightM } from "../terrain/earthworks";
import { DRY_FULL_M } from "../terrain/earthworkMesh";
import type { TerrainShading } from "../terrain/terrainShading";
import { PORTAL_HALF_WIDTH_M, PORTAL_MAX_WING_M, PORTAL_RETAIN_ABOVE_TOP_M, PORTAL_WING_SPLAY_COS, PORTAL_WING_SPLAY_SIN, WING_T } from "./dimensions";
import { OPEN_FRONT_RISE, PLUG_START_M, type PortalWings, WING_MIN_RETAIN_M, backfillV, behindFront, openFrontDistance, retainV, underMasonry, wingAcross, wingBack, wingCopingV, wingPoint } from "./portalOutline";

export { PLUG_START_M } from "./portalOutline";

/**
 * The hill plug behind a tunnel portal (art direction "Structures": "a hill plug, so the hill reads as closed over
 * the bore"), drawn with the terrain's own material on the terrain's 1.25 m sub-lattice, so it reads as the hillside
 * itself. Rebuilt for the D4 second feel-check fixes (2026-09-28), after the owner's "Not yet" with two screenshots
 * (wedges above flat ground in front of two facing portals; a thin wall with a dark smudge and a post). The principle
 * (the diagnosis judge's): behind a portal the ground is the real hill, masonry holds it back, and nothing stands
 * above the hill except what keeps the arch covered.
 *
 * **The surface.** The core's effective ground retains the hill behind a tunnel portal (`core/track/earthworks.ts`,
 * "Portals retain the hill"), while the terrain mesh keeps the earlier 45° headwall from the track bed there as an
 * underlay: a 1.25 m mesh cannot draw a 7.65 m step at the face without grass wedges in front of it. The plug draws
 * the difference, one surface per tunnel run (`PlugSurface`, shared by its portals, so two plugs meet exactly):
 *
 *   V = max(D, min(max(E, min(B, C)), G + o / 1.5)),
 *
 * with D the drawn ground (the underlay mesh), E the core's effective ground, B the compact backfill of each portal
 * whose hill side the point is on (`portalOutline.ts`, owner decision 2026-09-28 "Compact backfill"), C the lowest cut
 * envelope of every other track (cuts win: the fill never covers a neighbour's formation or side slopes), o the plan
 * distance to the open front beyond the wings' end piers and G the drawn ground at its nearest point there: where no
 * masonry holds it, the plug meets the ground as a 1 : 1.5 bank (the backfill, and the hill the core retains behind a
 * wing that another track's formation stopped short). Behind a portal whose hill stands over the face V is the natural hill (E), so the plug is the
 * hillside exactly; over a low portal the backfill closes the face top and the bore. It is drawn only where it rises
 * over D, with no fade band and no rectangle: each portal's plug covers the hill side of its outline (the face and the
 * wings' fronts, `behindFront`) within the reach of its backfill and of its approach's underlay notch, and a two-portal
 * run splits at its middle (the seam is exact, one surface). The old plug's crown ridge in a rectangle sized from the
 * longest wing stood up to 7.09 m over a 3–5 m pit, with V-troughs, a fade band and bore shards on short tunnels.
 *
 * **Shading.** A plug vertex's departure from the natural ground δ = V − N sets its look as the terrain mesh sets a
 * moved vertex's (`earthworkMesh.ts`): the smooth natural normal tilted by δ's least-squares gradient over its six
 * sub-lattice neighbours, and the colour blended toward the dry recipe as it moves. Its earthwork attribute is the
 * terrain's for the ground it shows (`EarthworksView.attributeIn`: the core's shown ground), raised by the backfill's
 * own potential, as on an embankment. Where the plug lies on the terrain (its outline) it takes the terrain mesh's
 * own normal and attribute, so shading and colours run on across the outline; where it is the natural hill (δ = 0)
 * it has the terrain's normals, colours and facets. The old plug's tilted normals and switched-off facets over a slab
 * were the owner's dark smudge. Presentation only.
 */

/** The plug stands this far over the surface it covers (no depth fight at its outline). */
export const PLUG_LIFT_M = 0.04;
/** The hill behind the face is retained this far over the face top (the core's `PORTAL_RETAIN_ABOVE_TOP_M`). */
export const PLUG_UNDER_COPING_M = PORTAL_RETAIN_ABOVE_TOP_M;
/** A plug triangle is drawn only where the plug stands this far over the drawn ground at one of its corners. */
export const PLUG_MIN_RISE_M = 0.01;
/**
 * The backfill reaches this far in front of the plug's front line (still inside the walls: the line lies 0.6 m behind
 * their fronts, in 0.8 m of masonry), so every vertex a clip puts on it carries it: rounding, and the linear clip across
 * the corner where the face's line meets a wing's, put some a hair to a few centimetres outside it.
 */
const FRONT_SLACK_M = 0.3;
/** The effective ground is read only where the underlay lies this far under the natural ground (its notch). */
const NOTCH_MIN_M = 1e-4;
/** The plug's sub-lattice step: the refined earthworks' 1.25 m. */
const SUB = 4;
const HALF_SQRT3 = SQRT3 / 2;
/** Sub-lattice neighbour steps (dQs, dRs) and their plan unit vectors (as `earthworkMesh.ts`). */
const NEIGHBOURS = [1, 0, 1, 0, 0, 1, 0.5, HALF_SQRT3, -1, 1, -0.5, HALF_SQRT3, -1, 0, -1, 0, 0, -1, -0.5, -HALF_SQRT3, 1, -1, 0.5, -HALF_SQRT3] as const;

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

/** A portal as its plug reads it: its frame and its wings (their lengths, and which are steep). */
export interface PlugPortal {
  readonly frame: PortalFrame;
  readonly wings: PortalWings;
}

/** The ground a plug reads: each NaN (or absent) where unknown. */
export interface PlugGround {
  /** The drawn ground: the terrain mesh (the earthworks' underlay behind portals); the natural terrain when absent. */
  readonly drawnM?: (x: number, y: number) => number;
  /** The core's effective ground (`"ground"` mode): the hill retained behind portals; the drawn ground when absent. */
  readonly effectiveM?: (x: number, y: number) => number;
  /** The other tracks' lowest cut envelope (Infinity where none reaches); none when absent. */
  readonly cutM?: (x: number, y: number) => number;
  /**
   * The terrain mesh's `earthwork` attribute at a point (`EarthworksView.attributeIn`), for the plug's vertices that
   * lie on the terrain (its outline), so the colours and facets match across it; zeros when absent.
   */
  readonly attributeM?: (x: number, y: number, natural: number, drawn: number, out: Float64Array) => void;
}

/** Local (s into the tunnel, u to the right) of sim plan (x, y) in a portal frame, written to `out`. */
export function frameLocal(f: PortalFrame, x: number, y: number, out: { s: number; u: number }): { s: number; u: number } {
  const dx = x - f.x;
  const dy = y - f.y;
  out.s = dx * f.tx + dy * f.ty;
  out.u = dx * f.ty - dy * f.tx;
  return out;
}

/** Sim plan (x, y) of local (s, u) in a portal frame. */
export function frameWorld(f: PortalFrame, s: number, u: number): { x: number; y: number } {
  return { x: f.x + f.tx * s + f.ty * u, y: f.y + f.ty * s - f.tx * u };
}

/** The earthworks' side-slope rise at plan distance d from a ground track's centreline (see `earthworks.ts`). */
function cutRise(d: number): number {
  const x = d - FORMATION_HALF_WIDTH_M;
  const b = CREST_ROUND_M;
  const ease = x <= 0 ? 0 : x < b ? (x * x) / (2 * b) : x - b / 2;
  return ease / SIDE_SLOPE_RUN;
}

/** Wings sample the ground in front of them this far in front of the wall. */
const WING_FRONT_M = 0.3;

/**
 * Each wing's length along its splayed line (`portalOutline.ts`): it runs out from the face's edge while the hill it
 * retains stands at least WING_MIN_RETAIN_M over the ground in front of it (the diagnosis judge's rule, D4 second
 * feel-check fixes): the natural hill as the other tracks' cuttings leave it but not the approach's own (`cutM`), no
 * higher than the retained skyline, against the ground in front: the drawn ground, or the
 * portal's own section there (a ground approach's cutting, else the natural ground), whichever is higher, so a
 * neighbour's cutting that lowers the ground in front never draws a wing out. Both are read at one point just in
 * front of the wall, so where nothing cut the ground in front the wing ends. A wing that so could not back the face
 * is steep instead (`WING_STEEP_FALL`, `portalOutline.ts`), running until its 45° coping meets the ground in front.
 * Capped at PORTAL_MAX_WING_M, and stopped short of another track's formation (`blocked`). On a side slope the old
 * rule (run until the falling coping meets the ground in front) sized the downhill wing 23–24 m over ground it did
 * not retain.
 */
export function portalWings(
  terrain: Terrain,
  f: PortalFrame,
  approach: PortalApproach,
  drawnM?: (x: number, y: number) => number,
  /** Whether a wing may not stand at (x, y): another track's formation is there. The wing stops short of it. */
  blocked?: (x: number, y: number) => boolean,
  /** The other tracks' lowest cut envelope (Infinity where none reaches): the hill as they leave it, and the backfill's cap. */
  cutM?: (x: number, y: number) => number,
): { left: number; right: number; steepLeft: boolean; steepRight: boolean } {
  const lat = lodLattice(terrain, 0);
  const out = { left: 0, right: 0, steepLeft: false, steepRight: false };
  const w = { s: 0, u: 0 };
  // The ground in front of the masonry at frame point (s, u): the portal's own section there (the approach's cutting
  // runs square to the face plane; else the natural ground), or the drawn ground where it stands higher, so another
  // track's cutting that lowers it never draws a wing out.
  const groundInFront = (s: number, u: number): number => {
    const p = frameWorld(f, s, u);
    const nat = naturalHeightM(terrain, lat, p.x, p.y);
    const own = Number.isNaN(nat) ? f.z : approach === "ground" ? Math.min(nat, f.z + cutRise(Math.abs(u))) : nat;
    const drawn = drawnM ? drawnM(p.x, p.y) : Number.NaN;
    return Number.isNaN(drawn) ? own : Math.max(own, drawn);
  };
  for (const side of [1, -1] as const) {
    const n = wingBack(side);
    let length = PORTAL_MAX_WING_M;
    for (let t = 0; t <= PORTAL_MAX_WING_M; t += 0.25) {
      wingPoint(side, t, w);
      const front = frameWorld(f, w.s - n.s * WING_FRONT_M, w.u - n.u * WING_FRONT_M);
      const wall = frameWorld(f, w.s, w.u);
      const backWall = frameWorld(f, w.s + n.s * WING_T, w.u + n.u * WING_T);
      if (blocked?.(wall.x, wall.y) || blocked?.(backWall.x, backWall.y)) {
        length = Math.max(0, t - 0.25);
        break;
      }
      const nf = naturalHeightM(terrain, lat, front.x, front.y);
      const ground = groundInFront(w.s - n.s * WING_FRONT_M, w.u - n.u * WING_FRONT_M);
      // The hill the wall holds back there: the ground in front as it stood before the approach cut it (the natural
      // ground, as the other tracks' cuttings leave it), no higher than the retained skyline. Read at the same point,
      // so a hillside's own slope across the wall is never taken for ground it retains.
      const hill = Math.min(Number.isNaN(nf) ? f.z : nf, cutM ? cutM(front.x, front.y) : Number.POSITIVE_INFINITY);
      const held = Math.min(hill, f.z + retainV(wingAcross(t)));
      if (held - ground < WING_MIN_RETAIN_M) {
        length = t;
        break;
      }
    }
    // Where a wing on the skyline cannot back the face (a low portal's downhill side: the fill at the face's edge, the
    // retained skyline a metre behind it, would fall to the ground beyond the end pier at 45° only past the wing's
    // reach), it is steep instead: its coping falls 45° with the bank behind it, and it runs until that coping meets
    // the ground in front. (The other tracks' cuttings cap that fill as they cap the hill, so a cut-away corner needs
    // none.) The bank rises from the ground at its nearest point of the open front, as the plug draws it.
    const corner = frameWorld(f, 1, side * PORTAL_HALF_WIDTH_M);
    const nc = naturalHeightM(terrain, lat, corner.x, corner.y);
    const cc = cutM ? cutM(corner.x, corner.y) : Number.POSITIVE_INFINITY;
    const fill = Math.min(f.z + retainV(PORTAL_HALF_WIDTH_M), cc);
    const foot = { s: 0, u: 0 };
    const bank = (m: number): number => {
      const o = openFrontDistance(side, m, 1, side * PORTAL_HALF_WIDTH_M, foot);
      return groundInFront(foot.s, foot.u) + OPEN_FRONT_RISE * o;
    };
    const held = Math.min(Number.isNaN(nc) ? f.z : nc, cc);
    let steep = false;
    if (fill > held && bank(length) < fill) {
      steep = true;
      length = PORTAL_MAX_WING_M;
      for (let t = 0.25; t <= PORTAL_MAX_WING_M; t += 0.25) {
        wingPoint(side, t, w);
        const wall = frameWorld(f, w.s, w.u);
        const backWall = frameWorld(f, w.s + n.s * WING_T, w.u + n.u * WING_T);
        if (blocked?.(wall.x, wall.y) || blocked?.(backWall.x, backWall.y)) {
          length = t - 0.25;
          break;
        }
        if (f.z + wingCopingV(t, true) - groundInFront(w.s - n.s * WING_FRONT_M, w.u - n.u * WING_FRONT_M) < WING_MIN_RETAIN_M) {
          length = t;
          break;
        }
      }
    }
    if (side === 1) out.steepRight = steep;
    else out.steepLeft = steep;
    if (side === 1) out.right = length;
    else out.left = length;
  }
  return out;
}

/**
 * One evaluation of the plug surface: the plug V, the drawn ground D, the shown ground (D, or E in its notch), the
 * natural N and the backfill as capped (−Infinity where none), m.
 */
export interface PlugSample {
  v: number;
  d: number;
  e: number;
  n: number;
  f: number;
}

/**
 * A tunnel run's plug surface (see the module comment), shared by the plugs of its portals, so they meet exactly
 * where a two-portal run splits. Pure over its inputs; allocates nothing per evaluation.
 */
export class PlugSurface {
  private readonly lat;
  private readonly local = { s: 0, u: 0 };
  private readonly foot = { s: 0, u: 0 };
  private readonly footRight = { s: 0, u: 0 };
  private readonly footLeft = { s: 0, u: 0 };

  constructor(
    private readonly terrain: Terrain,
    readonly portals: readonly PlugPortal[],
    private readonly ground: PlugGround = {},
  ) {
    this.lat = lodLattice(terrain, 0);
  }

  /** The surface at sim plan (x, y), with natural height `natural` (NaN off the map), written to `out`. */
  sample(x: number, y: number, natural: number, out: PlugSample): PlugSample {
    const g = this.ground;
    const drawn = g.drawnM ? g.drawnM(x, y) : Number.NaN;
    const first = this.portals[0]?.frame.z ?? 0;
    const d = Number.isNaN(drawn) ? (Number.isNaN(natural) ? first : natural) : drawn;
    out.d = d;
    out.n = Number.isNaN(natural) ? d : natural;
    let behindAny = false;
    let fill = Number.NEGATIVE_INFINITY;
    let open = Number.POSITIVE_INFINITY;
    let openFrame: PortalFrame | undefined;
    for (const p of this.portals) {
      const l = frameLocal(p.frame, x, y, this.local);
      if (l.s > 0) behindAny = true;
      // (With slack where masonry stands over the line: the plug's clipped vertices lie on the line itself, where
      // rounding dropped the fill from about every other one, a sawtooth along the walls.)
      const bf = behindFront(l.s, l.u);
      if (bf >= 0 || (bf >= -FRONT_SLACK_M && underMasonry(l.s, l.u, p.wings))) {
        const b = p.frame.z + backfillV(l.s, l.u, p.wings);
        if (b > fill) fill = b;
      }
      const s0 = l.s;
      const u0 = l.u;
      const oR = openFrontDistance(1, p.wings.right, s0, u0, this.footRight);
      const oL = openFrontDistance(-1, p.wings.left, s0, u0, this.footLeft);
      const o = oR < oL ? oR : oL;
      if (o < open) {
        open = o;
        openFrame = p.frame;
        const f = oR < oL ? this.footRight : this.footLeft;
        this.foot.s = f.s;
        this.foot.u = f.u;
      }
    }
    // The effective ground differs from the underlay only in its notch behind a portal plane.
    let e = d;
    if (behindAny && g.effectiveM && d < out.n - NOTCH_MIN_M) {
      const h = g.effectiveM(x, y);
      if (!Number.isNaN(h) && h > e) e = h;
    }
    out.e = e;
    let top = e;
    out.f = Number.NEGATIVE_INFINITY;
    if (fill > Number.NEGATIVE_INFINITY) {
      // Cuts win.
      const cut = g.cutM ? g.cutM(x, y) : Number.POSITIVE_INFINITY;
      const f = cut < fill ? cut : fill;
      out.f = f;
      if (f > top) top = f;
    }
    if (top > d && openFrame) {
      // Where no masonry holds it, the plug meets the ground at the open front beyond the wings' end piers and rises
      // from it as a 1 : 1.5 bank: the backfill, and the hill the core retains behind a wing stopped short of another
      // track, whose step at the face plane would otherwise stand there as a grass wedge.
      const fx = openFrame.x + openFrame.tx * this.foot.s + openFrame.ty * this.foot.u;
      const fy = openFrame.y + openFrame.ty * this.foot.s - openFrame.tx * this.foot.u;
      const fd = g.drawnM ? g.drawnM(fx, fy) : Number.NaN;
      const base = Number.isNaN(fd) ? this.naturalAt(fx, fy) : fd;
      const cap = (Number.isNaN(base) ? d : base) + OPEN_FRONT_RISE * open;
      if (cap < top) top = cap;
      if (cap < out.f) out.f = cap;
    }
    out.v = top > d ? top : d;
    return out;
  }

  /** The terrain's earthwork attribute at a point, when the view gives it (`PlugGround.attributeM`). */
  get attributeM(): PlugGround["attributeM"] {
    return this.ground.attributeM;
  }

  /** The natural height (m) at plan (x, y) on the LOD0 lattice (NaN off the map). */
  naturalAt(x: number, y: number): number {
    return naturalHeightM(this.terrain, this.lat, x, y);
  }
}

/** Where one portal's plug may draw: its portal in the surface, its box in the portal frame, and the split of a two-portal run. */
export interface PlugRegion {
  /** Index of the plug's portal in `PlugSurface.portals`. */
  readonly portal: number;
  readonly sMin: number;
  readonly sMax: number;
  readonly uMax: number;
  /** A two-portal run's middle: the plug keeps the side where (P − (x, y)) · (tx, ty) ≤ 0. */
  readonly split?: { readonly x: number; readonly y: number; readonly tx: number; readonly ty: number };
}

/** Plug geometry in the terrain chunks' layout: world positions, normals, linear colours and the earthwork attribute. */
export interface PlugData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly earthwork: Float32Array;
  readonly triangleCount: number;
}

/** A plug vertex while building: plan position, height, normal, colour and the earthwork attribute. */
interface BuildVertex {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  r: number;
  g: number;
  b: number;
  /** The earthwork attribute (encoded potential, departure, distance), the terrain's layout. */
  ex: number;
  ey: number;
  ez: number;
}

export class HillPlug {
  readonly data: PlugData;
  /** Plan box of the region the plug may cover (sim metres). */
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /** Highest point, for shadow bounds (−Infinity when nothing is drawn). */
  readonly maxZ: number;
  readonly frame: PortalFrame;
  readonly wings: PortalWings;
  private readonly lat;
  private readonly scratch: PlugSample = { v: 0, d: 0, e: 0, n: 0, f: 0 };
  private readonly local = { s: 0, u: 0 };

  constructor(
    private readonly terrain: Terrain,
    shading: TerrainShading,
    readonly surface: PlugSurface,
    readonly region: PlugRegion,
  ) {
    this.lat = lodLattice(terrain, 0);
    const portal = surface.portals[region.portal];
    if (!portal) throw new Error(`HillPlug: no portal ${region.portal}`);
    this.frame = portal.frame;
    this.wings = portal.wings;
    const corners = [
      [region.sMin, -region.uMax],
      [region.sMin, region.uMax],
      [region.sMax, -region.uMax],
      [region.sMax, region.uMax],
    ].map(([s, u]) => frameWorld(this.frame, s ?? 0, u ?? 0));
    this.minX = Math.min(...corners.map((c) => c.x));
    this.maxX = Math.max(...corners.map((c) => c.x));
    this.minY = Math.min(...corners.map((c) => c.y));
    this.maxY = Math.max(...corners.map((c) => c.y));
    const { data, maxZ } = this.build(shading);
    this.data = data;
    this.maxZ = maxZ;
  }

  /**
   * The front line's three pieces as linear functions of plan (x, y), ≥ 0 behind them: the face's (0) and the left (1)
   * and right (2) wings' lines (`behindFront` is their largest).
   */
  private frontPiece(i: number, x: number, y: number): number {
    const l = frameLocal(this.frame, x, y, this.local);
    if (i === 0) return l.s - PLUG_START_M;
    const u = i === 1 ? -l.u : l.u;
    return PORTAL_WING_SPLAY_COS * l.s + PORTAL_WING_SPLAY_SIN * (u - PORTAL_HALF_WIDTH_M) - PLUG_START_M;
  }

  /** How many convex constraints bound the region (the box's four sides, and a split). */
  private get convexCount(): number {
    return this.region.split ? 5 : 4;
  }

  /** Convex constraint c of the region as a linear function of plan (x, y), ≥ 0 inside. */
  private convex(c: number, x: number, y: number): number {
    const r = this.region;
    if (c === 4 && r.split) return -((x - r.split.x) * r.split.tx + (y - r.split.y) * r.split.ty);
    const l = frameLocal(this.frame, x, y, this.local);
    return c === 0 ? l.s - r.sMin : c === 1 ? r.sMax - l.s : c === 2 ? r.uMax - l.u : r.uMax + l.u;
  }

  /** How far (x, y) lies inside the plug's region (≥ 0 inside): behind its outline, on its side of a split, in its box. */
  private inside(x: number, y: number): number {
    const r = this.region;
    const l = frameLocal(this.frame, x, y, this.local);
    let f = behindFront(l.s, l.u);
    const box = Math.min(l.s - r.sMin, r.sMax - l.s, r.uMax - Math.abs(l.u));
    if (box < f) f = box;
    if (r.split) {
      const g = -((x - r.split.x) * r.split.tx + (y - r.split.y) * r.split.ty);
      if (g < f) f = g;
    }
    return f;
  }

  /** The plug's surface height (m, lift included) at sim plan (x, y), or NaN where it draws nothing (the terrain shows). */
  heightAt(x: number, y: number): number {
    if (x < this.minX || x > this.maxX || y < this.minY || y > this.maxY || this.inside(x, y) < 0) return Number.NaN;
    const p = this.surface.sample(x, y, this.surface.naturalAt(x, y), this.scratch);
    return p.v - p.d > PLUG_MIN_RISE_M ? p.v + PLUG_LIFT_M : Number.NaN;
  }

  /** The drawn ground on a grid over the plug's region and along its wings' fronts: the view rebuilds the plug when it changes. */
  groundSignature(): string {
    const drawn = this.surface.portals.length > 0 ? (x: number, y: number) => this.surface.sample(x, y, this.surface.naturalAt(x, y), this.scratch).d : () => Number.NaN;
    const r = this.region;
    const out: string[] = [];
    for (let i = 0; i <= 8; i++) {
      for (let j = 0; j <= 8; j++) {
        const p = frameWorld(this.frame, r.sMin + ((r.sMax - r.sMin) * i) / 8, -r.uMax + (2 * r.uMax * j) / 8);
        const h = drawn(p.x, p.y);
        out.push(Number.isNaN(h) ? "-" : h.toFixed(2));
      }
    }
    const w = { s: 0, u: 0 };
    for (const side of [1, -1] as const) {
      const n = wingBack(side);
      const length = side === 1 ? this.wings.right : this.wings.left;
      for (let t = 0; t <= length + 2; t += 1) {
        wingPoint(side, t, w);
        const p = frameWorld(this.frame, w.s - n.s * WING_FRONT_M, w.u - n.u * WING_FRONT_M);
        const h = drawn(p.x, p.y);
        out.push(Number.isNaN(h) ? "-" : h.toFixed(2));
      }
    }
    return out.join(",");
  }

  private build(shading: TerrainShading): { data: PlugData; maxZ: number } {
    const sub = this.lat.spacingM / SUB;
    const rowM = sub * HALF_SQRT3;
    const rs0 = Math.floor(this.minY / rowM) - 1;
    const rs1 = Math.ceil(this.maxY / rowM) + 1;
    const qsOf = (x: number, rs: number) => x / sub - rs / 2;
    const qs0 = Math.floor(Math.min(qsOf(this.minX, rs0), qsOf(this.minX, rs1))) - 1;
    const qs1 = Math.ceil(Math.max(qsOf(this.maxX, rs0), qsOf(this.maxX, rs1))) + 1;
    // The sub-lattice grid over the region and a one-vertex ring (for the normals' neighbours), evaluated lazily.
    const width = qs1 - qs0 + 3;
    const height = rs1 - rs0 + 3;
    const count = width * height;
    const known = new Uint8Array(count);
    const vAt = new Float64Array(count);
    const dAt = new Float64Array(count);
    const eAt = new Float64Array(count);
    const nAt = new Float64Array(count);
    const fAt = new Float64Array(count);
    const t = this.terrain;
    const lat = this.lat;
    const sample = this.scratch;
    const gridOf = (qs: number, rs: number): number => {
      const i = qs - qs0 + 1;
      const j = rs - rs0 + 1;
      return i < 0 || j < 0 || i >= width || j >= height ? -1 : j * width + i;
    };
    const evalAt = (qs: number, rs: number): number => {
      const g = gridOf(qs, rs);
      if (g >= 0 && known[g] === 1) return g;
      const natural = naturalAtSub(t, lat, qs, rs);
      this.surface.sample(sub * (qs + rs / 2), sub * rs * HALF_SQRT3, natural, sample);
      if (g < 0) return -1;
      known[g] = 1;
      vAt[g] = sample.v;
      dAt[g] = sample.d;
      eAt[g] = sample.e;
      nAt[g] = sample.n;
      fAt[g] = sample.f;
      return g;
    };
    const departure = (qs: number, rs: number): number => {
      const g = evalAt(qs, rs);
      if (g >= 0) return (vAt[g] ?? 0) - (nAt[g] ?? 0);
      return sample.v - sample.n;
    };
    // The terrain mesh's normals tilt by the shown ground's departure (`ChunkPass.shownDepartureAt`): the drawn ground,
    // or the core's effective ground in the notch behind a portal.
    const shownDeparture = (qs: number, rs: number): number => {
      const g = evalAt(qs, rs);
      if (g >= 0) return (eAt[g] ?? 0) - (nAt[g] ?? 0);
      return sample.e - sample.n;
    };
    const attr = new Float64Array(3);

    // Vertices of the drawn triangles, shared by every triangle that meets them.
    const vertexIds = new Map<number, number>();
    const verts: BuildVertex[] = [];
    const vertexAt = (qs: number, rs: number): BuildVertex => {
      const key = (rs - rs0) * width + (qs - qs0);
      const id = vertexIds.get(key);
      if (id !== undefined) return verts[id] as BuildVertex;
      const g = evalAt(qs, rs);
      const v = g >= 0 ? (vAt[g] ?? 0) : sample.v;
      const dv = g >= 0 ? (dAt[g] ?? 0) : sample.d;
      const ev = g >= 0 ? (eAt[g] ?? 0) : sample.e;
      const nv = g >= 0 ? (nAt[g] ?? 0) : sample.n;
      const fv = g >= 0 ? (fAt[g] ?? 0) : sample.f;
      // A vertex where the plug lies on the terrain (its outline) takes the terrain's own look: the normal the terrain
      // mesh gives it (tilted by the drawn ground's departure) and its earthwork attribute, so the shading and the
      // colours are continuous across the outline; the old plug's outline showed the lattice's sawtooth in light.
      const onTerrain = v - dv <= PLUG_MIN_RISE_M;
      const d0 = onTerrain ? shownDeparture(qs, rs) : departure(qs, rs);
      // The smooth natural normal and colour at the sub-vertex, barycentric in its LOD0 triangle.
      const Q = Math.floor(qs / SUB);
      const R = Math.floor(rs / SUB);
      const a = qs - SUB * Q;
      const b = rs - SUB * R;
      const frame: [number, number][] =
        a + b <= SUB
          ? [
              [lodNodeIndex(t, lat, Q, R), 1 - (a + b) / SUB],
              [lodNodeIndex(t, lat, Q + 1, R), a / SUB],
              [lodNodeIndex(t, lat, Q, R + 1), b / SUB],
            ]
          : [
              [lodNodeIndex(t, lat, Q + 1, R + 1), 1 - (2 * SUB - a - b) / SUB],
              [lodNodeIndex(t, lat, Q, R + 1), (SUB - a) / SUB],
              [lodNodeIndex(t, lat, Q + 1, R), (SUB - b) / SUB],
            ];
      const blend = (source: Float32Array, axis: number): number => {
        let s = 0;
        for (const [node, w] of frame) if (w !== 0 && node >= 0) s += w * (source[3 * node + axis] ?? 0);
        return s;
      };
      let nx = blend(shading.normals, 0);
      let ny = blend(shading.normals, 1);
      let nz = blend(shading.normals, 2);
      let len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      // Tilted by the departure's least-squares gradient over the six neighbours, exactly as the terrain mesh tilts a
      // moved vertex: zero where the plug is the natural hill, so the normal is the terrain's own there.
      let gx = 0;
      let gy = 0;
      for (let i = 0; i < 24; i += 4) {
        const dq = qs + (NEIGHBOURS[i] ?? 0);
        const dr = rs + (NEIGHBOURS[i + 1] ?? 0);
        const dd = (onTerrain ? shownDeparture(dq, dr) : departure(dq, dr)) - d0;
        gx += (NEIGHBOURS[i + 2] ?? 0) * dd;
        gy += (NEIGHBOURS[i + 3] ?? 0) * dd;
      }
      if (gx !== 0 || gy !== 0) {
        const s0 = 1 / Math.max(ny, 1e-3);
        nx = nx * s0 - gx / (3 * sub);
        nz = nz * s0 + gy / (3 * sub);
        ny = 1;
        len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
      }
      const dry = smoothstep(EARTHWORK_MIN_M, DRY_FULL_M, Math.abs(onTerrain ? dv - nv : d0));
      const colour = (axis: number): number => {
        const natural = blend(shading.colors, axis);
        return dry > 0 ? natural + (blend(shading.dryColors, axis) - natural) * dry : natural;
      };
      const x = sub * (qs + rs / 2);
      const y = sub * rs * HALF_SQRT3;
      // The earthwork attribute of the ground the vertex shows (the terrain's own on its outline, the shown ground's
      // over the notch), raised by the backfill's potential (how far the fill stands over that ground), as on an
      // embankment: the relief's facets fade out from a metre outside the fill's toe, so the fill's sub-triangles
      // never show as a sawtooth there, and where the plug is the natural hill it is faceted as the terrain.
      if (this.surface.attributeM) this.surface.attributeM(x, y, nv, onTerrain ? dv : ev, attr);
      else attr.fill(0);
      const base = onTerrain ? dv : ev;
      const fillX = fv > Number.NEGATIVE_INFINITY ? encodeEarthworkPotential(fv - base) : 0;
      const ex = Math.max(attr[0] ?? 0, fillX);
      const ey = onTerrain ? (attr[1] ?? 0) : Math.abs(v - nv) > 1e-6 ? v - nv : 0;
      // Off the terrain the distance is "far": the shader's lower-batter test (bare earth in cuts deeper than 1.2 m near
      // a centreline) would take the 45° trim above a portal's parapet, directly over the bore, for a cutting's floor.
      const ez = onTerrain && this.surface.attributeM ? (attr[2] ?? 0) : 99;
      const vertex: BuildVertex = { x, y, z: v, nx, ny, nz, r: colour(0), g: colour(1), b: colour(2), ex, ey, ez };
      vertexIds.set(key, verts.length);
      verts.push(vertex);
      return vertex;
    };

    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const ew: number[] = [];
    let maxZ = Number.NEGATIVE_INFINITY;
    const push = (p: BuildVertex): void => {
      const z = p.z + PLUG_LIFT_M;
      pos.push(p.x, z, -p.y);
      nor.push(p.nx, p.ny, p.nz);
      col.push(p.r, p.g, p.b);
      ew.push(p.ex, p.ey, p.ez);
      if (z > maxZ) maxZ = z;
    };
    const tri: [number, number][] = [
      [0, 0],
      [0, 0],
      [0, 0],
    ];
    // A vertex where a triangle is clipped takes the surface itself: interpolated from a corner that rises, it would
    // float over the drawn ground along the open front (the drawn ground is linear along the edge, the plug is not).
    const exact = (p: BuildVertex): void => {
      p.z = this.surface.sample(p.x, p.y, this.surface.naturalAt(p.x, p.y), sample).v;
    };
    const reach = sub * 1.5;
    for (let rs = rs0; rs < rs1; rs++) {
      for (let qs = qs0; qs < qs1; qs++) {
        for (const up of [0, 1] as const) {
          // Down (qs, rs), (qs + 1, rs), (qs, rs + 1); up (qs + 1, rs), (qs + 1, rs + 1), (qs, rs + 1): both
          // counter-clockwise on the sim plan, so they face up.
          if (up === 0) {
            tri[0] = [qs, rs];
            tri[1] = [qs + 1, rs];
            tri[2] = [qs, rs + 1];
          } else {
            tri[0] = [qs + 1, rs];
            tri[1] = [qs + 1, rs + 1];
            tri[2] = [qs, rs + 1];
          }
          const cq = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
          const cr = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
          const cx = sub * (cq + cr / 2);
          const cy = sub * cr * HALF_SQRT3;
          if (cx < this.minX - reach || cx > this.maxX + reach || cy < this.minY - reach || cy > this.maxY + reach) continue;
          if (this.inside(cx, cy) < -reach) continue;
          // Only where the plug stands over the drawn ground: elsewhere the terrain below is the surface.
          let rises = false;
          for (const [a, b] of tri) {
            const g = evalAt(a, b);
            const rise = g >= 0 ? (vAt[g] ?? 0) - (dAt[g] ?? 0) : sample.v - sample.d;
            if (rise > PLUG_MIN_RISE_M) rises = true;
          }
          if (!rises) continue;
          const corners = tri.map(([a, b]) => vertexAt(a, b));
          // The region is the union of three half-planes behind the face's and the wings' front lines, cut to the box and
          // the split, clipped exactly (a single max-of-lines clip cut a chord across the corner where the face's line
          // meets a wing's, and showed the notch's floor through the gap).
          // Every triangle is split by all three lines (so a line through a lattice edge splits both triangles beside it
          // at the same point: no T-junctions), and the cells behind any of them are kept.
          let cells: { poly: BuildVertex[]; behind: boolean }[] = [{ poly: corners, behind: false }];
          for (let i = 0; i < 3; i++) {
            const next: { poly: BuildVertex[]; behind: boolean }[] = [];
            for (const cell of cells) {
              const plus = clipPolygon(cell.poly, (p) => this.frontPiece(i, p.x, p.y), exact);
              const minus = clipPolygon(cell.poly, (p) => -this.frontPiece(i, p.x, p.y), exact);
              if (plus.length > 2) next.push({ poly: plus, behind: true });
              if (minus.length > 2) next.push({ poly: minus, behind: cell.behind });
            }
            cells = next;
          }
          for (const cell of cells) {
            if (!cell.behind) continue;
            let poly: BuildVertex[] = cell.poly;
            for (let c = 0; c < this.convexCount && poly.length > 2; c++) poly = clipPolygon(poly, (p) => this.convex(c, p.x, p.y), exact);
            for (let k = 1; k + 1 < poly.length; k++) {
              const p0 = poly[0] as BuildVertex;
              const p1 = poly[k] as BuildVertex;
              const p2 = poly[k + 1] as BuildVertex;
              // Keep only triangles with real area (a vertex on a line can leave a sliver of zero area).
              if (Math.abs((p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x)) <= 1e-9) continue;
              push(p0);
              push(p1);
              push(p2);
            }
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
}

/** Linear interpolation of two build vertices (plan position, height, normal, colour and the earthwork attribute). */
function lerpVertex(a: BuildVertex, b: BuildVertex, t: number): BuildVertex {
  const m = (p: number, q: number) => p + (q - p) * t;
  const nx = m(a.nx, b.nx);
  const ny = m(a.ny, b.ny);
  const nz = m(a.nz, b.nz);
  const len = Math.hypot(nx, ny, nz) || 1;
  return { x: m(a.x, b.x), y: m(a.y, b.y), z: m(a.z, b.z), nx: nx / len, ny: ny / len, nz: nz / len, r: m(a.r, b.r), g: m(a.g, b.g), b: m(a.b, b.b), ex: m(a.ex, b.ex), ey: m(a.ey, b.ey), ez: m(a.ez, b.ez) };
}

/**
 * Clips a convex plan polygon to f ≥ 0, f linear (Sutherland–Hodgman): edge crossings interpolate linearly, which is
 * exact for a linear f, and `settle` then sets each crossing's height. Two plugs that clip a lattice triangle along the
 * same line from its two sides (a two-portal run's middle, a seam between the region's pieces) compute the same
 * crossings, so their vertices coincide.
 */
function clipPolygon(poly: readonly BuildVertex[], f: (p: BuildVertex) => number, settle: (p: BuildVertex) => void): BuildVertex[] {
  const d = poly.map(f);
  if (d.every((v) => v >= 0)) return poly.slice();
  if (d.every((v) => v < 0)) return [];
  const out: BuildVertex[] = [];
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const a = poly[i] as BuildVertex;
    const b = poly[j] as BuildVertex;
    const da = d[i] ?? 0;
    const db = d[j] ?? 0;
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const c = lerpVertex(a, b, da / (da - db));
      settle(c);
      out.push(c);
    }
  }
  return out;
}
