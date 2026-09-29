import {
  ABUTMENT_BACK_M,
  ABUTMENT_HALF_WIDTH_M,
  ARCH_CROWN_V,
  ARCH_GROUND_CLEARANCE_M,
  ARCH_MAX_SPAN_M,
  ARCH_MIN_OPENING_M,
  ARCH_MIN_RISE_M,
  ARCH_TARGET_SPAN_M,
  CUTWATER_M,
  DECK_HALF_M,
  DECK_V,
  FOOT_SINK_M,
  GIRDER_MAX_SPAN_M,
  PARAPET_TOP_V,
  COPING_M,
  PIER_HALF_WIDTH_M,
  PIER_THICKNESS_M,
  PIER_TRACK_CLEARANCE_M,
  STEEL_SEAT_V,
  TRUSS_BOTTOM_V,
  TRUSS_LAND_TARGET_M,
  TRUSS_MAX_SPAN_M,
  TRUSS_SHORT_M,
  VIADUCT_MAX_HEIGHT_M,
  WATER_FOOT_SINK_M,
} from "./dimensions";
import type { PathNearest, PathPoint, RunPath } from "./runPath";
import type { RunEnd } from "./runs";

/**
 * The structure-choice rule for a bridge run (art direction "Structures";
 * issue #68 "Render"). Render decides it from the network, the terrain and
 * the other tracks, never the sim: the core stores only that a piece is a
 * bridge. Pure: the terrain and the other tracks arrive through `LayoutEnv`.
 *
 * **Supports.** Abutments stand at both ends (a portal where the run enters a
 * tunnel). Piers never stand on other tracks, nor in their clearance: no point
 * of a pier's footprint (1.8 m along the deck, 6.5 m across, plus 1.3 m
 * cutwaters in water) comes within PIER_TRACK_CLEARANCE_M (3 m) in plan of the
 * centreline of any track passing under the deck. Piers go first where
 * obstacles end: just outside each stretch where tracks forbid them, and on dry
 * ground at each bank. The gaps between are then filled:
 * - a gap over water takes one truss up to TRUSS_MAX_SPAN_M (80 m), else
 *   evenly spaced river piers;
 * - a gap that tracks cross stays one clear span;
 * - a gap over land is split into spans near ARCH_TARGET_SPAN_M (12 m, at most
 *   16 m), or near TRUSS_LAND_TARGET_M (40 m) where the deck stands more than
 *   VIADUCT_MAX_HEIGHT_M (20 m) above the ground.
 *
 * **Span type,** first match wins:
 * 1. over water → steel Warren truss;
 * 2. a clear span over GIRDER_MAX_SPAN_M (30 m) → steel Warren truss;
 * 3. over another track → plate-girder overpass;
 * 4. over land more than 20 m high → steel Warren truss on masonry piers (the
 *    open point art direction left to D4, settled here);
 * 5. over land → stone arch viaduct. Semicircular where it fits; where the
 *    deck is low the arch flattens to a segmental one whose springings clear
 *    the lower pier foot by 0.4 m, and below a 0.6 m rise (or with ground in
 *    the middle of the opening) the span is a solid masonry wall.
 *
 * Piers also go where the deck crosses 20 m above the ground, so a valley's
 * lower flanks stay arches, and a truss span shorter than TRUSS_SHORT_M (25 m)
 * merges into a neighbouring truss while the merged span stays within 80 m, so
 * a river valley gets one long truss rather than stubs beside it. So a long
 * bridge mixes types, viaduct approaches with a truss over the river. A pier's top is the higher seat of its two spans (an arch's springing,
 * or the steel bearing), and its foot lies FOOT_SINK_M under the lowest ground
 * under its footprint (in water, under the bed).
 */

export type SpanType = "arch" | "truss" | "girder";
/** Which rule chose a span's type (see above). */
export type SpanRule = "water" | "long-span" | "over-track" | "tall" | "land";
export type SupportKind = "abutment" | "pier" | "portal";

export interface SpanLayout {
  /** Arc lengths of its two supports' centres. */
  readonly a: number;
  readonly b: number;
  readonly type: SpanType;
  readonly rule: SpanRule;
  /** Arches: the intrados rise over its springings; 0 draws a solid wall. */
  readonly riseM: number;
  /** Solid walls: how far below the track height the wall reaches (below the ground). */
  readonly solidDepthM: number;
  readonly overWater: boolean;
  readonly overTrack: boolean;
  /** The greatest height of the track above the ground or water under the span. */
  readonly clearanceM: number;
}

export interface SupportLayout {
  readonly s: number;
  readonly kind: SupportKind;
  /** A pier standing in water: cutwaters, founded on the bed. */
  readonly wet: boolean;
  /** Top of the pier or abutment above the track height at s. */
  readonly topV: number;
  /** Foot height (absolute, m): under the lowest ground of the footprint. */
  readonly footZ: number;
  /** The lowest ground under the footprint (absolute, m). */
  readonly groundZ: number;
  /** True when a whole pier lies under the ground (an arch springing below it): nothing to draw. Abutments always draw (their parapets stand on the deck). */
  readonly buried: boolean;
  /** Plan footprint corners (x, y pairs, sim m), for clearance checks and tests. */
  readonly footprint: Float64Array;
}

export interface BridgeLayout {
  readonly lengthM: number;
  readonly spans: readonly SpanLayout[];
  readonly supports: readonly SupportLayout[];
  /** The structure's highest point above the track height, for shadow bounds. */
  readonly topV: number;
}

export interface LayoutEnv {
  /** Ground height (m) at sim plan (x, y); NaN off the map. */
  groundM(x: number, y: number): number;
  /** Whether water is drawn over plan (x, y). */
  wetAt(x: number, y: number): boolean;
  readonly waterLevelM: number;
  /** Centreline samples (x, y, z triples, sim m) of every other track near the run. */
  readonly others: Float64Array;
}

/** Profile sampling step along the run. */
export const LAYOUT_STEP_M = 0.5;
/** Another track this far under the deck counts as passing under it. */
export const UNDER_DECK_M = 2;
/** A track under the deck within this plan distance of the centreline puts the span over it. */
export const OVER_TRACK_HALF_M = DECK_HALF_M + 1.5;
/** A pier keeps at least this from either end of the run. */
export const PIER_MIN_FROM_END_M = PIER_THICKNESS_M + 1.5;
/** How far a bank pier searches outward for a dry, clear spot. */
const BANK_SEARCH_M = 8;
/** Candidate piers closer than this merge. */
const MIN_PIER_GAP_M = 2.5;

/** Warren truss depth (chord centres) for a span: a sixth of it, 6.2–9 m, so the top bracing clears the trains. */
export function trussDepthM(spanM: number): number {
  return Math.min(9, Math.max(6.2, spanM / 6));
}

/** Plate girder depth for a span: 1.9–2.6 m, so the top flange stands above the rails as a parapet would. */
export function girderDepthM(spanM: number): number {
  return Math.min(2.6, Math.max(1.9, 1.3 + spanM / 15));
}

interface Interval {
  a: number;
  b: number;
}

function merge(list: Interval[]): Interval[] {
  list.sort((x, y) => x.a - y.a);
  const out: Interval[] = [];
  for (const i of list) {
    const last = out[out.length - 1];
    if (last && i.a <= last.b) last.b = Math.max(last.b, i.b);
    else out.push({ a: i.a, b: i.b });
  }
  return out;
}

function inside(list: readonly Interval[], s: number): boolean {
  for (const i of list) if (s >= i.a && s <= i.b) return true;
  return false;
}

function overlaps(list: readonly Interval[], a: number, b: number): boolean {
  for (const i of list) if (i.b > a && i.a < b) return true;
  return false;
}

const P: PathPoint = { x: 0, y: 0, z: 0, tx: 1, ty: 0 };
const NEAR: PathNearest = { s: 0, d: 0 };
const XYZ = { x: 0, y: 0, z: 0 };

/** Lays out the spans and supports of a bridge run along `path`, whose ends lead to `ends`. */
export function layoutBridge(path: RunPath, ends: readonly [RunEnd | null, RunEnd | null], env: LayoutEnv): BridgeLayout {
  const L = path.lengthM;
  const n = Math.max(1, Math.ceil(L / LAYOUT_STEP_M));
  const step = L / n;
  const z = new Float64Array(n + 1);
  const ground = new Float64Array(n + 1);
  const wet = new Uint8Array(n + 1);
  const overTrack = new Uint8Array(n + 1);
  for (let i = 0; i <= n; i++) {
    path.at(i * step, P);
    z[i] = P.z;
    const g = env.groundM(P.x, P.y);
    ground[i] = Number.isFinite(g) ? g : P.z;
    wet[i] = env.wetAt(P.x, P.y) && (ground[i] ?? 0) < env.waterLevelM ? 1 : 0;
  }
  const surface = (i: number): number => (wet[i] ? Math.max(ground[i] ?? 0, env.waterLevelM) : (ground[i] ?? 0));
  const index = (s: number): number => Math.min(n, Math.max(0, Math.round(s / step)));

  // Other tracks under the deck: where they forbid piers (land and water footprints), and where the deck is over them.
  const blockedLand: Interval[] = [];
  const blockedWater: Interval[] = [];
  const others = env.others;
  const halfT = PIER_THICKNESS_M / 2;
  for (let k = 0; k + 2 < others.length; k += 3) {
    const x = others[k] ?? 0;
    const y = others[k + 1] ?? 0;
    const zo = others[k + 2] ?? 0;
    path.nearest(x, y, NEAR);
    path.at(NEAR.s, P);
    // Points beyond the run's ends (an approach continuing the path) project onto an end: skip them.
    if (Math.abs((x - P.x) * P.tx + (y - P.y) * P.ty) > 0.5) continue;
    if (zo > P.z - UNDER_DECK_M) continue;
    const d = Math.abs(NEAR.d);
    const c = PIER_TRACK_CLEARANCE_M;
    if (d <= PIER_HALF_WIDTH_M + c) blockedLand.push({ a: NEAR.s - halfT - c, b: NEAR.s + halfT + c });
    if (d <= PIER_HALF_WIDTH_M + CUTWATER_M + c) blockedWater.push({ a: NEAR.s - halfT - c, b: NEAR.s + halfT + c });
    if (d <= OVER_TRACK_HALF_M) {
      for (let i = index(NEAR.s - 1); i <= index(NEAR.s + 1); i++) overTrack[i] = 1;
    }
  }
  const blocked = merge(blockedLand);
  const blockedWet = merge(blockedWater);
  const wetIntervals: Interval[] = [];
  for (let i = 0; i <= n; i++) {
    if (!wet[i]) continue;
    const last = wetIntervals[wetIntervals.length - 1];
    if (last && Math.abs(last.b - (i - 1) * step) < 1e-9) last.b = i * step;
    else wetIntervals.push({ a: i * step, b: i * step });
  }

  const footWet = (s: number): boolean => {
    for (const ds of [-halfT, 0, halfT]) if (wet[index(s + ds)]) return true;
    return false;
  };
  const pierOk = (s: number): boolean => {
    if (s < PIER_MIN_FROM_END_M || s > L - PIER_MIN_FROM_END_M) return false;
    return !inside(footWet(s) ? blockedWet : blocked, s);
  };

  // Piers where obstacles end: outside each forbidden stretch, and on dry ground at each bank.
  const candidates: number[] = [];
  for (const i of blocked) {
    for (const s of [i.a - 0.05, i.b + 0.05]) if (pierOk(s)) candidates.push(s);
  }
  for (const w of wetIntervals) {
    for (const [from, dir] of [
      [w.a - halfT - 0.6, -1],
      [w.b + halfT + 0.6, 1],
    ] as const) {
      for (let t = 0; t <= BANK_SEARCH_M; t += LAYOUT_STEP_M) {
        const s = from + dir * t;
        if (!footWet(s) && pierOk(s)) {
          candidates.push(s);
          break;
        }
      }
    }
  }
  // Piers where the deck crosses the viaduct's 20 m limit, so a valley's lower flanks stay arches and only its
  // tall middle takes trusses (rule 4 applies per span).
  for (let i = 1; i <= n; i++) {
    const h0 = (z[i - 1] ?? 0) - surface(i - 1);
    const h1 = (z[i] ?? 0) - surface(i);
    if (h0 > VIADUCT_MAX_HEIGHT_M === h1 > VIADUCT_MAX_HEIGHT_M) continue;
    const s = (i - 1 + (VIADUCT_MAX_HEIGHT_M - h0) / (h1 - h0)) * step;
    // On the lower side of the crossing, so the tall span's piers stand where the deck is at most 20 m up.
    const at = h1 > h0 ? s - halfT - 0.5 : s + halfT + 0.5;
    if (!footWet(at) && pierOk(at)) candidates.push(at);
  }
  candidates.sort((x, y) => x - y);
  const supports: number[] = [0];
  for (const s of candidates) {
    const last = supports[supports.length - 1] ?? 0;
    if (s - last >= MIN_PIER_GAP_M && L - s >= MIN_PIER_GAP_M) supports.push(s);
  }
  supports.push(L);

  const maxClearance = (a: number, b: number): number => {
    let h = 0;
    for (let i = index(a); i <= index(b); i++) h = Math.max(h, (z[i] ?? 0) - surface(i));
    return h;
  };
  const anyIn = (flags: Uint8Array, a: number, b: number): boolean => {
    for (let i = index(a); i <= index(b); i++) if (flags[i]) return true;
    return false;
  };

  // Fill each gap with evenly spaced piers where its content allows.
  const all: number[] = [];
  for (let k = 0; k + 1 < supports.length; k++) {
    const a = supports[k] ?? 0;
    const b = supports[k + 1] ?? L;
    all.push(a);
    const gap = b - a;
    const inner = { a: a + halfT, b: b - halfT };
    if (overlaps(blocked, inner.a, inner.b)) continue;
    let target: number;
    let most: number;
    if (anyIn(wet, inner.a, inner.b)) {
      target = TRUSS_MAX_SPAN_M;
      most = TRUSS_MAX_SPAN_M;
    } else if (maxClearance(a, b) > VIADUCT_MAX_HEIGHT_M) {
      target = TRUSS_LAND_TARGET_M;
      most = TRUSS_MAX_SPAN_M;
    } else {
      target = ARCH_TARGET_SPAN_M;
      most = ARCH_MAX_SPAN_M;
    }
    let parts = Math.max(1, Math.round(gap / target));
    while (gap / parts > most) parts++;
    for (let p = 1; p < parts; p++) {
      const want = a + (gap * p) / parts;
      // Nearest acceptable spot within a quarter of a span (piers may stand in water here).
      const reach = gap / parts / 4;
      for (let t = 0; t <= reach; t += LAYOUT_STEP_M) {
        const s = pierOk(want + t) ? want + t : pierOk(want - t) ? want - t : Number.NaN;
        if (Number.isFinite(s)) {
          all.push(s);
          break;
        }
      }
    }
  }
  all.push(L);

  let spans: SpanLayout[] = [];
  const typeAll = (): SpanLayout[] => {
    const out: SpanLayout[] = [];
    for (let k = 0; k + 1 < all.length; k++) out.push(spanOf(all[k] ?? 0, all[k + 1] ?? L));
    return out;
  };
  spans = typeAll();
  // Short trusses merge into a neighbouring truss (dropping the pier between), shortest first.
  for (;;) {
    let best = -1;
    let bestLen = Infinity;
    for (let k = 0; k + 1 < spans.length; k++) {
      const x = spans[k] as SpanLayout;
      const y = spans[k + 1] as SpanLayout;
      if (x.type !== "truss" || y.type !== "truss") continue;
      const shortest = Math.min(x.b - x.a, y.b - y.a);
      if (shortest >= TRUSS_SHORT_M || y.b - x.a > TRUSS_MAX_SPAN_M || shortest >= bestLen) continue;
      best = k;
      bestLen = shortest;
    }
    if (best < 0) break;
    all.splice(best + 1, 1);
    spans = typeAll();
  }

  function groundV(s: number): number {
    const i = index(s);
    return (ground[i] ?? 0) - (z[i] ?? 0);
  }

  function spanOf(a: number, b: number): SpanLayout {
    const len = b - a;
    const overWater = anyIn(wet, a + halfT, b - halfT);
    const overT = anyIn(overTrack, a, b);
    const clearanceM = maxClearance(a, b);
    let minGroundV = Infinity;
    for (let i = index(a); i <= index(b); i++) minGroundV = Math.min(minGroundV, (ground[i] ?? 0) - (z[i] ?? 0));
    const base = { a, b, riseM: 0, solidDepthM: 0, overWater, overTrack: overT, clearanceM };
    if (overWater) return { ...base, type: "truss", rule: "water" };
    if (len > GIRDER_MAX_SPAN_M) return { ...base, type: "truss", rule: "long-span" };
    if (overT) return { ...base, type: "girder", rule: "over-track" };
    if (clearanceM > VIADUCT_MAX_HEIGHT_M) return { ...base, type: "truss", rule: "tall" };
    const opening = len - PIER_THICKNESS_M;
    const faceA = a + halfT;
    const faceB = b - halfT;
    const low = Math.min(groundV(faceA), groundV(faceB));
    // Whole decimetres, as the arch asset's variant stores it, so a pier's top meets the springing exactly.
    let rise = Math.floor(10 * Math.min(opening / 2, Math.max(0, ARCH_CROWN_V - (low + ARCH_GROUND_CLEARANCE_M)))) / 10;
    let midMax = -Infinity;
    for (let i = index(faceA + 0.2 * opening); i <= index(faceB - 0.2 * opening); i++) midMax = Math.max(midMax, (ground[i] ?? 0) - (z[i] ?? 0));
    if (opening < ARCH_MIN_OPENING_M || rise < ARCH_MIN_RISE_M || midMax > ARCH_CROWN_V - 0.5) rise = 0;
    return { ...base, type: "arch", rule: "land", riseM: rise, solidDepthM: rise > 0 ? 0 : Math.max(0.5, -minGroundV + FOOT_SINK_M) };
  }

  const seatV = (span: SpanLayout | undefined): number => {
    if (!span) return DECK_V;
    if (span.type !== "arch") return STEEL_SEAT_V;
    return span.riseM > 0 ? ARCH_CROWN_V - span.riseM : DECK_V;
  };

  const supportsOut: SupportLayout[] = all.map((s, k) => {
    const isEnd = k === 0 || k === all.length - 1;
    const end = k === 0 ? ends[0] : ends[1];
    const kind: SupportKind = isEnd ? (end === "tunnel" ? "portal" : "abutment") : "pier";
    const wetHere = kind === "pier" && footWet(s);
    const halfW = PIER_HALF_WIDTH_M + (wetHere ? CUTWATER_M : 0);
    // The footprint: a pier's T × 2·halfW rectangle; an abutment's reaches back behind the run's end.
    const along0 = kind === "pier" ? -halfT : k === 0 ? -ABUTMENT_BACK_M : -halfT;
    const along1 = kind === "pier" ? halfT : k === 0 ? halfT : ABUTMENT_BACK_M;
    const across = kind === "pier" ? halfW : ABUTMENT_HALF_WIDTH_M;
    const footprint = new Float64Array(8);
    let lowest = Infinity;
    let c = 0;
    for (const [da, dr] of [
      [along0, -across],
      [along1, -across],
      [along1, across],
      [along0, across],
    ] as const) {
      path.toSim(s + da, dr, 0, XYZ);
      footprint[c++] = XYZ.x;
      footprint[c++] = XYZ.y;
    }
    for (let fa = 0; fa <= 4; fa++) {
      for (let fr = 0; fr <= 4; fr++) {
        path.toSim(s + along0 + ((along1 - along0) * fa) / 4, -across + (2 * across * fr) / 4, 0, XYZ);
        const g = env.groundM(XYZ.x, XYZ.y);
        if (Number.isFinite(g)) lowest = Math.min(lowest, g);
      }
    }
    path.at(s, P);
    if (!Number.isFinite(lowest)) lowest = P.z - 1;
    const topV = kind === "pier" ? Math.max(seatV(spans[k - 1]), seatV(spans[k])) : DECK_V;
    const footZ = lowest - (wetHere ? WATER_FOOT_SINK_M : FOOT_SINK_M);
    return { s, kind, wet: wetHere, topV, footZ, groundZ: lowest, buried: kind === "pier" && P.z + topV <= lowest + 0.1, footprint };
  });

  let topV = PARAPET_TOP_V + COPING_M;
  for (const span of spans) {
    if (span.type === "truss") topV = Math.max(topV, TRUSS_BOTTOM_V + trussDepthM(span.b - span.a) + 0.25);
    if (span.type === "girder") topV = Math.max(topV, STEEL_SEAT_V + 0.25 + girderDepthM(span.b - span.a));
  }
  return { lengthM: L, spans, supports: supportsOut, topV };
}
