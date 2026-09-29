import { SQRT3, type Terrain } from "../../core/sim/api";
import { smoothstep } from "../math";
import { CREST_ROUND_M, EARTHWORK_MIN_M, FORMATION_HALF_WIDTH_M, SIDE_SLOPE_RUN, encodeEarthworkPotential, lodLattice, lodNodeIndex, naturalAtSub, naturalHeightM } from "../terrain/earthworks";
import { DRY_FULL_M } from "../terrain/earthworkMesh";
import type { TerrainShading } from "../terrain/terrainShading";
import { PORTAL_HALF_WIDTH_M, PORTAL_MAX_WING_M, PORTAL_RETAIN_ABOVE_TOP_M, PORTAL_WING_SPLAY_COS, PORTAL_WING_SPLAY_SIN, WING_T } from "./dimensions";
import {
  OPEN_FRONT_RISE,
  PLUG_START_M,
  type PortalWings,
  WING_MIN_RETAIN_M,
  backfillV,
  behindFront,
  masonryCapV,
  openFrontDistance,
  openFrontOrigin,
  retainV,
  underMasonry,
  wingAcross,
  wingBack,
  wingCopingV,
  wingPoint,
} from "./portalOutline";

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
 *   V = max(D, min(max(E, min(B, C)), G + o)),
 *
 * with D the drawn ground (the underlay mesh), E the core's effective ground, B the compact backfill of each portal
 * whose hill side the point is on (`portalOutline.ts`, owner decision 2026-09-28 "Compact backfill"), C the lowest cut
 * envelope of every other track (cuts win: the fill never covers a neighbour's formation or side slopes), o the plan
 * distance to the open front beyond the wings' end piers (an octagonal norm round a pier's end, so the bank is planar)
 * and G the drawn ground at its nearest point there: where no masonry holds it, the plug meets the ground as a 45° bank
 * (the backfill, and the hill the core retains behind a wing that another track's formation stopped short). Behind a
 * portal whose hill stands over the face V is the natural hill (E), so the plug is the hillside exactly; over a low
 * portal the backfill closes the face top and the bore. It is drawn only where it rises
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
 * were the owner's dark smudge. Behind the masonry the plug's gradient is one-sided (`acrossMasonry`): a vertex's
 * neighbours inside or in front of a wall lie on its cap or on the cutting metres below, which tilted the first two
 * rows' normals up to 67° toward the face, and the edge of that band followed the lattice's zigzag (the "ew75 east teeth", D4 portal wedges,
 * 2026-09-29). Presentation only.
 *
 * **What the core does not see** (the diagnosis judge's risk, checked 2026-09-29). The backfill (behind a low face)
 * and the fill behind a splayed wing (in front of the face plane, where the core keeps the approach cutting's batter)
 * are render-only, as the owner's answers have them ("Compact backfill"; "Render only; the ground behind each wing is
 * filled"). So a drag started on one of those lattice nodes begins at the core's ground (`sim.groundMm`), under the
 * drawn fill. Measured on the committed population (1,000 free drags and 150 chains per tool, automated): 43 nodes
 * behind faces (22 of 70 portals, Track) and 19 in front of them (18 portals) lie under more than 0.5 m of drawn fill,
 * 4.07 m at most (Straight: 43 and 18, 4.05 m). The core's ground stays authoritative: removing the gap needs a core
 * rule (a tunnel end's clip plane that follows the wings, or the core retaining the backfill), not render.
 */

/**
 * The plug stands this far over the surface it covers (no depth fight over it), faded out as it comes down to the
 * drawn ground at its outline, where it ends on it.
 */
export const PLUG_LIFT_M = 0.04;
/** The hill behind the face is retained this far over the face top (the core's `PORTAL_RETAIN_ABOVE_TOP_M`). */
export const PLUG_UNDER_COPING_M = PORTAL_RETAIN_ABOVE_TOP_M;
/** A plug triangle is drawn only where the plug stands this far over the drawn ground at one of its corners. */
export const PLUG_MIN_RISE_M = 0.01;
/**
 * A plug vertex takes the terrain's own look where it lies on it (PLUG_MIN_RISE_M), its own from this far over the
 * drawn ground, smoothly between (`HillPlug`).
 */
export const PLUG_BLEND_RISE_M = 0.3;
/**
 * The backfill reaches this far in front of the plug's front line (still inside the walls: the line lies 0.6 m behind
 * their fronts, in 0.8 m of masonry), so every vertex a clip puts on it carries it: rounding, and the linear clip across
 * the corner where the face's line meets a wing's, put some a hair to a few centimetres outside it.
 */
const FRONT_SLACK_M = 0.3;
/** The effective ground is read only where the underlay lies this far under the natural ground (its notch). */
const NOTCH_MIN_M = 1e-4;
/** A clip vertex this close behind the plug's front line lies on its outline (`HillPlug`'s `exact`), m. */
const ON_OUTLINE_M = 1e-3;
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
 * natural N, the backfill as capped (−Infinity where none; f − D is negative past its toe, where `HillPlug` clips) and
 * the surface before it is kept over D (V = max(D, t)), m.
 */
export interface PlugSample {
  v: number;
  d: number;
  e: number;
  n: number;
  f: number;
  t: number;
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
  private readonly origin = { s: 0, u: 0 };

  constructor(
    private readonly terrain: Terrain,
    readonly portals: readonly PlugPortal[],
    private readonly ground: PlugGround = {},
    /**
     * The regions its plugs draw in (`PlugRegion`; the split is ignored): the surface comes down to the drawn ground
     * at 45° toward their edges (the largest allowance of any), so a plug ends on the ground inside its region rather
     * than being cut off at the box. None: no taper.
     */
    private readonly regions: readonly PlugRegion[] = [],
  ) {
    this.lat = lodLattice(terrain, 0);
  }

  /**
   * How far plan (x, y) lies inside the regions (the largest over them, ≥ 0 inside one; +Infinity with none): the
   * distance to the nearest side of each region's box, in its portal's frame.
   */
  private insideRegions(x: number, y: number): number {
    if (this.regions.length === 0) return Number.POSITIVE_INFINITY;
    let best = Number.NEGATIVE_INFINITY;
    for (const r of this.regions) {
      const p = this.portals[r.portal];
      if (!p) continue;
      const l = frameLocal(p.frame, x, y, this.local);
      const au = l.u < 0 ? -l.u : l.u;
      let inside = l.s - r.sMin;
      if (r.sMax - l.s < inside) inside = r.sMax - l.s;
      if (r.uMax - au < inside) inside = r.uMax - au;
      if (inside > best) best = inside;
    }
    return best;
  }

  /**
   * The surface at sim plan (x, y), with natural height `natural` (NaN off the map), written to `out`. `effectiveM`,
   * when given, is the core's effective ground there (instead of reading it): a clip vertex inside the plug takes it
   * interpolated on the lattice, as the terrain mesh draws the ground (`HillPlug`).
   */
  sample(x: number, y: number, natural: number, out: PlugSample, effectiveM?: number): PlugSample {
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
    let openSide: 1 | -1 = 1;
    let openWing = 0;
    let masonry = Number.POSITIVE_INFINITY;
    for (const p of this.portals) {
      const l = frameLocal(p.frame, x, y, this.local);
      if (l.s > 0) behindAny = true;
      const m = p.frame.z + masonryCapV(l.s, l.u, p.wings) - PLUG_LIFT_M;
      if (m < masonry) masonry = m;
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
        openSide = oR < oL ? 1 : -1;
        openWing = oR < oL ? p.wings.right : p.wings.left;
      }
    }
    // The effective ground differs from the underlay only in its notch behind a portal plane.
    let e = d;
    if (effectiveM !== undefined) e = effectiveM > d ? effectiveM : d;
    else if (behindAny && g.effectiveM && d < out.n - NOTCH_MIN_M) {
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
      const ground = Number.isNaN(base) ? d : base;
      const cap = ground + OPEN_FRONT_RISE * open;
      // Past a wing's end pier the backfill falls 1 : 1.5 from the wing's coping; where the ground along the open front
      // falls away as fast (a low portal's downhill side, down its approach's embankment) it ran on as a 0.4 m ridge
      // metres long, a lit sliver from the end pier (verification of the D4 portal wedges, 2026-09-29: ew75 west and
      // the dead end, yaws 4 and 5). So it falls as far again as that ground falls under the ground at the pier: it
      // ends within a metre or two of it. Where the ground rises (a cutting's slope toward the hill) nothing changes,
      // so the bank still ramps up to the hill a portal retains beyond a short wing.
      let fall = 0;
      if (out.f > Number.NEGATIVE_INFINITY) {
        const o = openFrontOrigin(openSide, openWing, this.origin);
        const ox = openFrame.x + openFrame.tx * o.s + openFrame.ty * o.u;
        const oy = openFrame.y + openFrame.ty * o.s - openFrame.tx * o.u;
        const od = g.drawnM ? g.drawnM(ox, oy) : Number.NaN;
        const atPier = Number.isNaN(od) ? this.naturalAt(ox, oy) : od;
        if (!Number.isNaN(atPier) && ground < atPier) fall = atPier - ground;
      }
      top = e < cap ? e : cap;
      let f = out.f - fall;
      if (cap < f) f = cap;
      if (f > top) top = f;
      out.f = f;
    }
    // Never over the masonry it abuts (`masonryCapV`), so its front edge never floats over a coping.
    if (masonry < top) top = masonry;
    if (masonry < out.f) out.f = masonry;
    // Down to the drawn ground at 45° toward the regions' edges: the backfill's bank past a wing's end pier ran on over
    // falling ground past the box, which cut it off 0.2–0.7 m over the terrain (verification of the D4 portal wedges,
    // 2026-09-29). It binds only there: the regions reach well past the fill and the notch.
    const inside = this.insideRegions(x, y);
    if (inside !== Number.POSITIVE_INFINITY) {
      const cap = d + OPEN_FRONT_RISE * inside;
      if (cap < top) top = cap;
      if (cap < out.f) out.f = cap;
    }
    out.t = top;
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
  /**
   * The drawn ground there, how far the plug stands over it (V − D, which sets the look's blend), and the contour
   * clip's value (`contourRise`: negative past a fill's toe, where the plug is clipped).
   */
  d: number;
  over: number;
  rise: number;
  /** The surface's effective ground (PlugSample.e: the drawn ground, or the core's over its notch), linear between lattice vertices. */
  effective: number;
  /** The terrain's own look there (`t…`: normal, linear colour, earthwork attribute) and the plug's (`p…`). */
  tnx: number;
  tny: number;
  tnz: number;
  pnx: number;
  pny: number;
  pnz: number;
  tr: number;
  tg: number;
  tb: number;
  pr: number;
  pg: number;
  pb: number;
  /** The earthwork attribute (encoded potential, departure, distance), the terrain's layout. */
  tex: number;
  tey: number;
  tez: number;
  pex: number;
  pey: number;
  pez: number;
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
  private readonly scratch: PlugSample = { v: 0, d: 0, e: 0, n: 0, f: 0, t: 0 };
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

  /**
   * Whether sub-lattice vertex (qs, rs) lies in front of the plug's front line where masonry stands over it: inside a
   * wall or in front of it, where the surface is the wall's cap or the cutting, not the plug.
   */
  private acrossMasonry(qs: number, rs: number, sub: number): boolean {
    const l = frameLocal(this.frame, sub * (qs + rs / 2), sub * rs * HALF_SQRT3, this.local);
    return behindFront(l.s, l.u) < -1e-9 && underMasonry(l.s, l.u, this.wings);
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
    return p.v - p.d > PLUG_MIN_RISE_M ? p.v + PLUG_LIFT_M * smoothstep(0, PLUG_LIFT_M, p.v - p.d) : Number.NaN;
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
    // Whether the plug covers the underlay's notch at the sub-vertex or a neighbour (E over D).
    const notchNear = (qs: number, rs: number): boolean => {
      for (let i = -4; i < 24; i += 4) {
        const g = evalAt(qs + (i < 0 ? 0 : (NEIGHBOURS[i] ?? 0)), rs + (i < 0 ? 0 : (NEIGHBOURS[i + 1] ?? 0)));
        const e = g >= 0 ? (eAt[g] ?? 0) : sample.e;
        const d = g >= 0 ? (dAt[g] ?? 0) : sample.d;
        if (e > d + NOTCH_MIN_M) return true;
      }
      return false;
    };
    const attr = new Float64Array(3);
    const terrainNormal = { x: 0, y: 0, z: 0 };
    const plugNormal = { x: 0, y: 0, z: 0 };

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
      // Each vertex carries two looks, blended where the triangle is pushed (`push`): the terrain's own (the normal the
      // terrain mesh gives it, tilted by the shown ground's departure, its colour and its earthwork attribute), and
      // the plug's (tilted by the plug's departure, with the backfill's potential). The look moves from the first to
      // the second as the plug rises over the drawn ground (PLUG_BLEND_RISE_M), and the plug ends at the drawn ground
      // itself (clipped along the contour where it meets it), so shading, colours and facets run on across the
      // outline. Kept whole where a corner rose, with the plug's look at that corner, every sub-triangle along the
      // outline stood out in light and in the relief's facets, a 1.25 m staircase (verification finding 2026-09-29;
      // the old plug's outline showed the lattice's sawtooth the same way).
      const x = sub * (qs + rs / 2);
      const y = sub * rs * HALF_SQRT3;
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
        for (const [node, weight] of frame) if (weight !== 0 && node >= 0) s += weight * (source[3 * node + axis] ?? 0);
        return s;
      };
      const n0x = blend(shading.normals, 0);
      const n0y = blend(shading.normals, 1);
      const n0z = blend(shading.normals, 2);
      const n0 = Math.hypot(n0x, n0y, n0z) || 1;
      // The natural normal tilted by a departure's least-squares gradient over the six neighbours, exactly as the
      // terrain mesh tilts a moved vertex (zero where the departure is flat, so the terrain's own normal there).
      // Behind the masonry the six neighbours of a vertex can lie across it, inside or in front of a wall (its cap, or
      // the cutting metres lower): there the plug's gradient is one-sided, the opposite neighbour's difference mirrored
      // (0 when both lie across). Which neighbour fell across varied along the face and the wings with the lattice, so
      // the first rows' normals alternated: the "ew75 east teeth" (D4 portal wedges, 2026-09-29).
      const tilted = (depart: (qs: number, rs: number) => number, out: { x: number; y: number; z: number }, oneSided = false): void => {
        let nx = n0x / n0;
        let ny = n0y / n0;
        let nz = n0z / n0;
        const d0 = depart(qs, rs);
        let gx = 0;
        let gy = 0;
        for (let i = 0; i < 24; i += 4) {
          const nq = qs + (NEIGHBOURS[i] ?? 0);
          const nr = rs + (NEIGHBOURS[i + 1] ?? 0);
          let dd: number;
          if (oneSided && this.acrossMasonry(nq, nr, sub)) {
            const j = (i + 12) % 24;
            const oq = qs + (NEIGHBOURS[j] ?? 0);
            const or = rs + (NEIGHBOURS[j + 1] ?? 0);
            dd = this.acrossMasonry(oq, or, sub) ? 0 : d0 - depart(oq, or);
          } else dd = depart(nq, nr) - d0;
          gx += (NEIGHBOURS[i + 2] ?? 0) * dd;
          gy += (NEIGHBOURS[i + 3] ?? 0) * dd;
        }
        if (gx !== 0 || gy !== 0) {
          const s0 = 1 / Math.max(ny, 1e-3);
          nx = nx * s0 - gx / (3 * sub);
          nz = nz * s0 + gy / (3 * sub);
          ny = 1;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len;
          ny /= len;
          nz /= len;
        }
        out.x = nx;
        out.y = ny;
        out.z = nz;
      };
      tilted(shownDeparture, terrainNormal);
      tilted(departure, plugNormal, true);
      // Made ground blends toward the dry recipe as it moves: the terrain by its drawn departure, the plug by its own.
      const dryT = smoothstep(EARTHWORK_MIN_M, DRY_FULL_M, Math.abs(dv - nv));
      const dryP = smoothstep(EARTHWORK_MIN_M, DRY_FULL_M, Math.abs(v - nv));
      const colour = (axis: number, dry: number): number => {
        const natural = blend(shading.colors, axis);
        return dry > 0 ? natural + (blend(shading.dryColors, axis) - natural) * dry : natural;
      };
      // The earthwork attribute: the terrain's own; over the plug, that of the ground it shows (the core's shown
      // ground over the notch) raised by the backfill's potential (how far the fill stands over that ground), as on
      // an embankment, so the relief's facets fade out from a metre outside the fill's toe and where the plug is the
      // natural hill it is faceted as the terrain. Off the terrain the distance is "far": the shader's lower-batter
      // test (bare earth in cuts deeper than 1.2 m near a centreline) would take the 45° trim above a portal's
      // parapet, directly over the bore, for a cutting's floor.
      // The potential carries the fill's own on the terrain's side too (measured from the drawn ground), so the relief's
      // facets fade out from a metre outside the fill's toe: its edge of facets then follows the toe (the contour the
      // plug is clipped along) instead of the sub-triangles' edges.
      let tex = 0;
      let tey = 0;
      let tez = 99;
      if (this.surface.attributeM) {
        this.surface.attributeM(x, y, nv, dv, attr);
        tex = attr[0] ?? 0;
        tey = attr[1] ?? 0;
        tez = attr[2] ?? 0;
        // (The shown ground is the drawn one outside the notch: the same attribute.)
        if (ev !== dv) this.surface.attributeM(x, y, nv, ev, attr);
      } else attr.fill(0);
      if (fv > Number.NEGATIVE_INFINITY) tex = Math.max(tex, encodeEarthworkPotential(fv - dv));
      const fillX = fv > Number.NEGATIVE_INFINITY ? encodeEarthworkPotential(fv - ev) : 0;
      const vertex: BuildVertex = {
        x,
        y,
        z: v,
        d: dv,
        over: v - dv,
        rise: contourRise(fv, dv, notchNear(qs, rs)),
        effective: ev,
        tnx: terrainNormal.x,
        tny: terrainNormal.y,
        tnz: terrainNormal.z,
        pnx: plugNormal.x,
        pny: plugNormal.y,
        pnz: plugNormal.z,
        tr: colour(0, dryT),
        tg: colour(1, dryT),
        tb: colour(2, dryT),
        pr: colour(0, dryP),
        pg: colour(1, dryP),
        pb: colour(2, dryP),
        tex,
        tey,
        tez,
        pex: Math.max(attr[0] ?? 0, fillX),
        pey: Math.abs(v - nv) > 1e-6 ? v - nv : 0,
        pez: 99,
      };
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
      // Lifted over the surface it covers, but not along its toe, where it ends on the drawn ground: a 4 cm step there
      // drew a dark line (its shadow and the gap under it) along the contour.
      const z = p.z + PLUG_LIFT_M * smoothstep(0, PLUG_LIFT_M, p.over);
      pos.push(p.x, z, -p.y);
      const w = smoothstep(PLUG_MIN_RISE_M, PLUG_BLEND_RISE_M, p.over);
      const m = (a: number, b: number) => a + (b - a) * w;
      const n = unit(m(p.tnx, p.pnx), m(p.tny, p.pny), m(p.tnz, p.pnz));
      nor.push(n.x, n.y, n.z);
      col.push(m(p.tr, p.pr), m(p.tg, p.pg), m(p.tb, p.pb));
      ew.push(m(p.tex, p.pex), m(p.tey, p.pey), m(p.tez, p.pez));
      if (z > maxZ) maxZ = z;
    };
    const tri: [number, number][] = [
      [0, 0],
      [0, 0],
      [0, 0],
    ];
    // A vertex where a triangle is clipped takes the surface itself: interpolated from a corner that rises, it would
    // float over the drawn ground along the open front (the drawn ground is linear along the edge, the plug is not).
    // (The drawn ground and the contour value stay interpolated: every clip vertex lies in its lattice triangle, where
    // the terrain mesh is linear, so it is the mesh's own height there; and the contour clip then splits every edge
    // where its neighbour does.) Off the outline (a seam inside the region: a line's extension behind the face, the
    // box, a split) the core's effective ground is taken as the mesh would draw it, interpolated from the lattice
    // vertices (`effective`): read exactly, it stood over the drawn ground by the mesh's own linear error where the ground
    // is curved (up to 0.18 m on the rounded cutting's end beyond the wing ends), and where such a seam vertex lay on
    // an edge shared with the terrain the outline showed a see-through crack (verification of the D4 portal wedges,
    // 2026-09-29). On the outline (under the masonry, the open front) it stays exact, so the plug meets the copings.
    const exact = (p: BuildVertex): void => {
      const l = frameLocal(this.frame, p.x, p.y, this.local);
      const seam = behindFront(l.s, l.u) > ON_OUTLINE_M;
      const e = this.surface.sample(p.x, p.y, this.surface.naturalAt(p.x, p.y), sample, seam ? p.effective : undefined);
      p.z = e.t > p.d ? e.t : p.d;
      p.over = p.z - p.d;
    };
    // Where the plug meets the drawn ground (its rise, linear along an edge, crosses 0) it lies on the terrain mesh
    // there, which is linear along the same edge: the drawn ground, interpolated.
    const onGround = (p: BuildVertex): void => {
      p.z = p.d;
      p.over = 0;
      p.rise = 0;
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
            // And along the toe where a fill meets the drawn ground (`contourRise`; the same values on both sides of
            // every edge, so no crack opens between neighbours).
            if (poly.length > 2) poly = clipPolygon(poly, (p) => p.rise, onGround);
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

/**
 * The plug's clip function at a lattice vertex: the fill's height `f` over the drawn ground `d`, negative past its toe,
 * no lower than −1 m (no fill: −Infinity), so a clip between a vertex just inside and one with no fill lands next to
 * the inside one, and one between two of the fill's vertices lands on its toe. At or beside the underlay's notch
 * (`notch`) it is never negative: there the plug is the hill the core retains, which meets the drawn ground where the
 * notch ends, at the lattice's vertices, and a whole sub-triangle covers the notch's last dip.
 */
function contourRise(f: number, d: number, notch: boolean): number {
  const r = f - d;
  if (notch) return r > 0 ? r : 0;
  return r > -1 ? r : -1;
}

/** Linear interpolation of two build vertices (plan position, height, drawn ground, rise, both looks). */
function lerpVertex(a: BuildVertex, b: BuildVertex, t: number): BuildVertex {
  const m = (p: number, q: number) => p + (q - p) * t;
  const tn = unit(m(a.tnx, b.tnx), m(a.tny, b.tny), m(a.tnz, b.tnz));
  const tnx = tn.x;
  const tny = tn.y;
  const tnz = tn.z;
  const pn = unit(m(a.pnx, b.pnx), m(a.pny, b.pny), m(a.pnz, b.pnz));
  return {
    x: m(a.x, b.x),
    y: m(a.y, b.y),
    z: m(a.z, b.z),
    d: m(a.d, b.d),
    over: m(a.over, b.over),
    rise: m(a.rise, b.rise),
    effective: m(a.effective, b.effective),
    tnx,
    tny,
    tnz,
    pnx: pn.x,
    pny: pn.y,
    pnz: pn.z,
    tr: m(a.tr, b.tr),
    tg: m(a.tg, b.tg),
    tb: m(a.tb, b.tb),
    pr: m(a.pr, b.pr),
    pg: m(a.pg, b.pg),
    pb: m(a.pb, b.pb),
    tex: m(a.tex, b.tex),
    tey: m(a.tey, b.tey),
    tez: m(a.tez, b.tez),
    pex: m(a.pex, b.pex),
    pey: m(a.pey, b.pey),
    pez: m(a.pez, b.pez),
  };
}

const unitScratch = { x: 0, y: 1, z: 0 };

/** (x, y, z) normalized, into a shared scratch (read it before the next call). */
function unit(x: number, y: number, z: number): { x: number; y: number; z: number } {
  const len = Math.hypot(x, y, z) || 1;
  unitScratch.x = x / len;
  unitScratch.y = y / len;
  unitScratch.z = z / len;
  return unitScratch;
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
