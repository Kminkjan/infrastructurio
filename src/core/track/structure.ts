import type { NodeRef, Piece, Structure } from "../geometry/piece";
import { sampleCentrelineEvery } from "../geometry/sample";
import { type Heading, SQRT3, isPrimary, rotateHeading, stepOf } from "../lattice";
import { type Terrain, heightDmAt } from "../terrain";

/**
 * Terrain under a piece, structure inference and the rule-4 checks
 * (simulation model §9, rule 4; D4, issue #68). Validation calls this for the
 * pieces a command adds; the planner calls `pieceGround` to find the pieces
 * of a candidate that cross water.
 *
 * **Samples.** A piece's track height is linear in arc length between its two
 * node heights (as clearance treats it); the terrain is linear over each
 * lattice triangle (the surface the renderer draws). So the height of the
 * track above the terrain, z − h, is piecewise linear along a straight, and
 * its extremes sit where the centreline crosses a triangle edge:
 * - a primary straight runs along a triangle edge, so its two nodes decide
 *   exactly;
 * - a secondary straight crosses one edge, at its midpoint, between the nodes
 *   one primary step to either side of its heading, so its two nodes and that
 *   midpoint decide exactly (all integer mm);
 * - a curve or shift is sampled on the arcs themselves every
 *   `STRUCTURE_SAMPLE_STEP_M` (0.5 m) of arc length (`sampleCentrelineEvery`
 *   in `geometry/sample.ts`), with the exact node heights at its two ends. On
 *   terrain no steeper than the diorama's steepest triangle (33.4°, a slope of
 *   0.66), a kink of the surface between two samples 0.5 m apart can hide at
 *   most about 0.17 m, so these samples may miss a band by that much.
 *
 * Curve samples are floats, decided once when a command runs and stored as the
 * piece's structure (saves never re-validate), as for clearance: only cases at
 * an exact threshold could differ between engines.
 *
 * **Water.** A sample lies over water when the terrain there is below the
 * water level (inside the waterline, where the water surface covers the bed).
 * The terrain under water is the bed, and h means the bed there: tunnel cover
 * counts earth, not water. Track at or above the bed at such a sample is in or
 * over the water; track below the bed runs under it, in the earth.
 *
 * **Inference (structure `auto`).** With A the largest z − h and B the largest
 * h − z over the samples:
 * - in or over water anywhere: bridge;
 * - else under water anywhere (below the bed): tunnel;
 * - A > 4 m and B > 4 m: bridge when A ≥ B, else tunnel (such a piece fails
 *   the chosen structure's own rule);
 * - A > 4 m: bridge; B > 4 m: tunnel;
 * - otherwise ground (−4 m ≤ z − h ≤ 4 m everywhere, and dry).
 *
 * **Rules** (each structure's own; the codes in catalogue order):
 * - ground: `needs-bridge` when A > 4 m or in or over water, `needs-tunnel`
 *   when B > 4 m or under water (a cutting under a river would flood);
 * - bridge: `bridge-below-ground` when the deck is below the terrain at any
 *   sample (B > 0), `bridge-too-low-over-water` when a sample over water has
 *   the deck below the water level + 4.0 m;
 * - tunnel: `tunnel-too-shallow` when the piece never goes deeper than the
 *   ground band (B ≤ 4 m: a cutting, not a tunnel), or when a sample has less
 *   than 6 m of cover (h − z) farther than 10 m along the track from the
 *   nearest portal.
 *
 * **Portals.** A portal is a node of a tunnel piece where the track is within
 * the ground band (cover h − z ≤ 4 m at the node): where a tunnel meets ground
 * track (whose end is in the band), a bridge (whose deck is above the ground),
 * or open air. The distance to the nearest portal is measured along the track,
 * through the neighbouring tunnel pieces (`portalReach`), so the second 5 m
 * piece of a tunnel is still within 10 m of the portal before the first.
 */

/** Track within ±4 m of the terrain, and dry, is ground: cuttings and embankments. */
export const GROUND_BAND_MM = 4000;
/** A bridge deck over water must be at least the water level + 4.0 m. */
export const WATER_CLEARANCE_MM = 4000;
/** A tunnel needs 6 m of cover (h − z) ... */
export const TUNNEL_COVER_MM = 6000;
/** ... except within 10 m of its portals, along the track. */
export const PORTAL_ZONE_MM = 10_000;
/** Arc-length spacing of the samples along curves and shifts. */
export const STRUCTURE_SAMPLE_STEP_M = 0.5;

/** One row's pitch in metres, a·√3/2. */
const ROW_M = 2.5 * SQRT3;

/** The terrain under a piece's centreline: independent of the piece's heights. */
export interface PieceGround {
  /** Each sample's position along the piece from `ends[0]`, as a fraction 0…1 of its arc length. */
  readonly f: readonly number[];
  /** The terrain surface under each sample, mm (the bed under water); NaN where it is not on the map. */
  readonly hMm: readonly number[];
  /** Whether each sample lies over water. */
  readonly wet: readonly boolean[];
  readonly anyWet: boolean;
}

/** The terrain height at a lattice node in mm, or undefined off the map. */
export function nodeTerrainMm(t: Terrain, n: { readonly q: number; readonly r: number }): number | undefined {
  const dm = heightDmAt(t, n);
  return dm === undefined ? undefined : dm * 100;
}

/**
 * The terrain height at node (q, r) in mm, or undefined off the map: `offsetOfNode`'s layout (row = r, col =
 * q + ⌊r/2⌋) inlined for the sampling loops, exact for the integer q and r they pass (r ≥ 0 once in range).
 */
function cornerMm(t: Terrain, q: number, r: number): number | undefined {
  if (r < 0 || r >= t.rows) return undefined;
  const col = q + (r - (r % 2)) / 2;
  if (col < 0 || col >= t.columns) return undefined;
  return (t.heightsDm[r * t.columns + col] ?? 0) * 100;
}

/**
 * The terrain height (mm, float) at a plan point in metres: planar inside its
 * lattice triangle, the same triangulation the renderer draws (down triangle
 * (q, r), (q + 1, r), (q, r + 1); up triangle (q + 1, r), (q, r + 1),
 * (q + 1, r + 1)). A corner off the map drops out and the others are
 * renormalised; NaN when none is on the map.
 */
export function terrainMmAtPoint(t: Terrain, x: number, y: number): number {
  const rf = y / ROW_M;
  const qf = x / 5 - rf / 2;
  const Q = Math.floor(qf);
  const R = Math.floor(rf);
  const fq = qf - Q;
  const fr = rf - R;
  const corners: readonly (readonly [number, number, number])[] =
    fq + fr <= 1
      ? [
          [Q, R, 1 - fq - fr],
          [Q + 1, R, fq],
          [Q, R + 1, fr],
        ]
      : [
          [Q + 1, R, 1 - fr],
          [Q, R + 1, 1 - fq],
          [Q + 1, R + 1, fq + fr - 1],
        ];
  let sum = 0;
  let weight = 0;
  for (const [q, r, w] of corners) {
    if (w === 0) continue;
    const h = cornerMm(t, q, r);
    if (h === undefined) continue;
    sum += w * h;
    weight += w;
  }
  return weight > 0 ? sum / weight : Number.NaN;
}

function add(n: { readonly q: number; readonly r: number }, h: Heading): { q: number; r: number } {
  const s = stepOf(h);
  return { q: n.q + s.q, r: n.r + s.r };
}

/**
 * Whether any sample of a piece lies over water: `pieceGround(t, piece).anyWet`, stopping at the first wet
 * sample (the planner's water floors need nothing more).
 */
export function pieceCrossesWater(t: Terrain, piece: Piece): boolean {
  const waterMm = t.waterLevelDm * 100;
  const [a, b] = piece.ends;
  const wet = (h: number | undefined): boolean => h !== undefined && h < waterMm;
  if (wet(nodeTerrainMm(t, a.node)) || wet(nodeTerrainMm(t, b.node))) return true;
  if (piece.kind === "straight") {
    if (isPrimary(a.outward)) return false;
    const l = add(a.node, rotateHeading(a.outward, 1));
    const r = add(a.node, rotateHeading(a.outward, -1));
    const hl = cornerMm(t, l.q, l.r);
    const hr = cornerMm(t, r.q, r.r);
    return hl !== undefined && hr !== undefined && (hl + hr) / 2 < waterMm;
  }
  for (const p of sampleCentrelineEvery(piece, STRUCTURE_SAMPLE_STEP_M)) if (terrainMmAtPoint(t, p.x, p.y) < waterMm) return true;
  return false;
}

/** The terrain under a piece (see the module comment for where it samples). */
export function pieceGround(t: Terrain, piece: Piece): PieceGround {
  const [a, b] = piece.ends;
  const waterMm = t.waterLevelDm * 100;
  const h0 = nodeTerrainMm(t, a.node) ?? Number.NaN;
  const h1 = nodeTerrainMm(t, b.node) ?? Number.NaN;
  const f: number[] = [];
  const hMm: number[] = [];
  if (piece.kind === "straight") {
    f.push(0);
    hMm.push(h0);
    if (!isPrimary(a.outward)) {
      // The one triangle edge a secondary step crosses joins the nodes one primary step to either side.
      const l = add(a.node, rotateHeading(a.outward, 1));
      const r = add(a.node, rotateHeading(a.outward, -1));
      const left = cornerMm(t, l.q, l.r);
      const right = cornerMm(t, r.q, r.r);
      f.push(0.5);
      hMm.push(left === undefined || right === undefined ? Number.NaN : (left + right) / 2);
    }
    f.push(1);
    hMm.push(h1);
  } else {
    const points = sampleCentrelineEvery(piece, STRUCTURE_SAMPLE_STEP_M);
    const total = points[points.length - 1]?.sM ?? 0;
    points.forEach((p, i) => {
      f.push(i === points.length - 1 || total <= 0 ? (i === 0 ? 0 : 1) : p.sM / total);
      hMm.push(i === 0 ? h0 : i === points.length - 1 ? h1 : terrainMmAtPoint(t, p.x, p.y));
    });
  }
  const wet = hMm.map((h) => h < waterMm);
  return { f, hMm, wet, anyWet: wet.some((w) => w) };
}

/** z − h extremes of a piece with node heights z0 → z1 over its samples. */
export interface Clearances {
  /** The largest z − h (track above terrain), mm; −Infinity with no sample on the map. */
  readonly aboveMm: number;
  /** The largest h − z (track below terrain), mm. */
  readonly belowMm: number;
  /** A sample over water has the track at or above the bed: in or over the water. */
  readonly overWater: boolean;
  /** A sample over water has the track below the bed: under the water, in the earth. */
  readonly underWater: boolean;
}

function zAt(z0Mm: number, z1Mm: number, f: number): number {
  return f === 0 ? z0Mm : f === 1 ? z1Mm : z0Mm + (z1Mm - z0Mm) * f;
}

export function clearances(g: PieceGround, z0Mm: number, z1Mm: number): Clearances {
  let above = Number.NEGATIVE_INFINITY;
  let below = Number.NEGATIVE_INFINITY;
  let overWater = false;
  let underWater = false;
  g.f.forEach((f, i) => {
    const h = g.hMm[i] ?? Number.NaN;
    if (Number.isNaN(h)) return;
    const d = zAt(z0Mm, z1Mm, f) - h;
    if (d > above) above = d;
    if (-d > below) below = -d;
    if (g.wet[i]) {
      if (d >= 0) overWater = true;
      else underWater = true;
    }
  });
  return { aboveMm: above, belowMm: below, overWater, underWater };
}

/** The structure `auto` gives a piece with node heights z0 → z1 (see the module comment). */
export function inferStructure(g: PieceGround, z0Mm: number, z1Mm: number): Structure {
  const { aboveMm, belowMm, overWater, underWater } = clearances(g, z0Mm, z1Mm);
  if (overWater) return "bridge";
  if (underWater) return "tunnel";
  const up = aboveMm > GROUND_BAND_MM;
  const down = belowMm > GROUND_BAND_MM;
  if (up && down) return aboveMm >= belowMm ? "bridge" : "tunnel";
  if (up) return "bridge";
  if (down) return "tunnel";
  return "ground";
}

export type StructureCode = "needs-bridge" | "needs-tunnel" | "bridge-below-ground" | "bridge-too-low-over-water" | "tunnel-too-shallow";

/** The rule-4 codes in catalogue order. */
export const STRUCTURE_CODES: readonly StructureCode[] = Object.freeze([
  "needs-bridge",
  "needs-tunnel",
  "bridge-below-ground",
  "bridge-too-low-over-water",
  "tunnel-too-shallow",
]);

/** One failed structure rule of a piece, with the numbers its message quotes (mm). */
export type StructureFault =
  | { readonly code: "needs-bridge"; readonly aboveMm: number; readonly overWater: boolean }
  | { readonly code: "needs-tunnel"; readonly belowMm: number; readonly underWater: boolean }
  | { readonly code: "bridge-below-ground"; readonly belowMm: number }
  | { readonly code: "bridge-too-low-over-water"; readonly missingMm: number }
  | { readonly code: "tunnel-too-shallow"; readonly coverMm: number; readonly portalMm: number; readonly shallowOnly: boolean };

/**
 * The first failed rule of a piece with structure `structure` (the codes in
 * catalogue order), or null. `portalReachMm(end)` is the distance along the
 * track from the piece's end node 0 or 1 to the nearest portal beyond it (0
 * when that node is a portal, Infinity when none lies within 10 m).
 */
export function structureFault(
  g: PieceGround,
  z0Mm: number,
  z1Mm: number,
  lengthMm: number,
  structure: Structure,
  waterLevelMm: number,
  portalReachMm: (end: 0 | 1) => number,
): StructureFault | null {
  const { aboveMm, belowMm, overWater, underWater } = clearances(g, z0Mm, z1Mm);
  if (structure === "ground") {
    if (overWater || aboveMm > GROUND_BAND_MM) return { code: "needs-bridge", aboveMm, overWater };
    if (underWater || belowMm > GROUND_BAND_MM) return { code: "needs-tunnel", belowMm, underWater };
    return null;
  }
  if (structure === "bridge") {
    if (belowMm > 0) return { code: "bridge-below-ground", belowMm };
    let missing = 0;
    g.f.forEach((f, i) => {
      if (g.wet[i]) missing = Math.max(missing, waterLevelMm + WATER_CLEARANCE_MM - zAt(z0Mm, z1Mm, f));
    });
    if (missing > 0) return { code: "bridge-too-low-over-water", missingMm: missing };
    return null;
  }
  if (belowMm <= GROUND_BAND_MM) return { code: "tunnel-too-shallow", coverMm: belowMm, portalMm: 0, shallowOnly: true };
  let reach0 = Number.NaN;
  let reach1 = Number.NaN;
  let worstCover = Number.POSITIVE_INFINITY;
  let worstPortal = 0;
  for (let i = 0; i < g.f.length; i++) {
    const f = g.f[i] ?? 0;
    const h = g.hMm[i] ?? Number.NaN;
    if (Number.isNaN(h)) continue;
    const cover = h - zAt(z0Mm, z1Mm, f);
    if (cover >= TUNNEL_COVER_MM) continue;
    if (Number.isNaN(reach0)) {
      reach0 = portalReachMm(0);
      reach1 = portalReachMm(1);
    }
    const portal = Math.min(f * lengthMm + reach0, (1 - f) * lengthMm + reach1);
    if (portal <= PORTAL_ZONE_MM) continue;
    if (cover < worstCover) {
      worstCover = cover;
      worstPortal = portal;
    }
  }
  return worstCover === Number.POSITIVE_INFINITY ? null : { code: "tunnel-too-shallow", coverMm: worstCover, portalMm: worstPortal, shallowOnly: false };
}

/** Whether a node of a tunnel is a portal: the track within the ground band there (cover ≤ 4 m). */
export function isPortal(t: Terrain, n: NodeRef): boolean {
  const h = nodeTerrainMm(t, n);
  return h !== undefined && h - n.zMm <= GROUND_BAND_MM;
}
