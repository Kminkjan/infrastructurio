import { HEADWALL_RISE } from "../../core/sim/api";
import {
  BORE_DEPTH_M,
  COPING_M,
  PORTAL_HALF_WIDTH_M,
  PORTAL_PARAPET_M,
  PORTAL_RETAIN_ABOVE_TOP_M,
  PORTAL_TOP_V,
  PORTAL_WALL_M,
  PORTAL_WING_RUN,
  PORTAL_WING_SPLAY_COS,
  PORTAL_WING_SPLAY_SIN,
  WING_T,
  portalSkylineV,
} from "./dimensions";

/**
 * A tunnel portal's outline in plan (D4 second feel-check fixes, 2026-09-28), shared by the portal asset
 * (`assets.ts`), its hill plug (`plug.ts`) and the scenery clearing (`EarthworksView`). Coordinates are the portal
 * frame's: `s` metres into the tunnel from the face plane, `u` metres to the right of travel into it, heights
 * (`…V`) metres above the track height at the portal node. Pure numbers, no three.
 *
 * **Splayed wings** (owner decision 2026-09-28, "Splayed wing walls": "Turn the wing walls ~30° toward the approach,
 * so some masonry shows at 4 of 6 camera angles instead of 2"). Each wing starts at the face's edge (s = 0,
 * |u| = PORTAL_HALF_WIDTH_M) and runs outward and toward the approach at PORTAL_WING_SPLAY (30°) to the face plane:
 * t metres along it lies at s = −sin·t, |u| = 4.2 + cos·t. Its front face (the approach side) is the line itself,
 * its back face WING_T behind it, and its coping follows the portal skyline by |u| (`portalSkylineV`: 1 : 1.5 per
 * metre across the track), so a splayed wing meets a cutting's 1 : 1.5 side slope at the same |u| as a straight one
 * did and is 1/cos longer. Every portal on an east–west line was exactly edge-on at two of the six yaws (the
 * owner's thin-wall screenshot); a splayed wing is seen at 30° there.
 *
 * **The wall foot** is min(−max(1, depth), skyline − WALL_FOOT_UNDER_SKYLINE_M): the face's depth under the track
 * height, but never less than 2.5 m under the coping, so a long wing whose skyline falls below the fixed foot is
 * never drawn inside out (the diagnosis of 2026-09-28: past |u| ≈ 17.6 m a panel stood 6.4 m over its own coping,
 * and the end pier became a 6.4–6.8 m post). The end pier runs from that foot to the skyline + 0.5 m.
 *
 * **The compact backfill** (owner decision 2026-09-28, "Compact backfill": "Fill reaches the face top only across the
 * 8.4 m-wide bore, then slopes 1:1.5 down to the real hill; beyond the bore it never stands above its own wing
 * wall"; "A 1.9–2.6 m bank stays at the downhill corner"). Behind the face and the wings the fill stands at the retained skyline (`portalRetainV`, 0.25 m over the
 * face top and under each coping) for BACKFILL_BERM_M behind the wall, then falls 1 : 1.5 in the plan distance from
 * that berm (a sum of the falls along and across, so beyond the face width it is never above the wing's coping
 * line); a ridge BACKFILL_RIDGE_HALF_M wide keeps the face-top level over the bore to its drawn depth, so the arch
 * ring stays covered; and beyond each wing's end pier, where no masonry holds it, the fill meets the ground at the
 * open front and rises from it at most 45° (OPEN_FRONT_RISE), a bank (`plug.ts`). A wing is at least long enough for
 * the fill at the face's edge to fall so to the ground beyond it (`plug.ts`, `portalWings`), so the face top stays
 * backed.
 */

/** Plan offset of the plug's front edge behind the face and the wings' front faces, inside the walls' thickness. */
export const PLUG_START_M = 0.6;
/** The backfill stands at the retained skyline this far behind the face and the wings before it falls. */
export const BACKFILL_BERM_M = 1;
/** Then it falls at the earthworks' side slope (1 : 1.5). */
export const BACKFILL_RUN = 1.5;
/**
 * A ridge keeps the face-top level across ±BACKFILL_RIDGE_HALF_M over the bore to its drawn depth (BORE_DEPTH_M): the
 * widest it can be while the fill beyond the face width stays under the wing copings' falling line (4.2 − (4.5 − 1)).
 * Its 1 : 1.5 flanks keep the arch ring (extrados 6.82 m at the crown, 3.6 m at the springings) under at least 0.5 m.
 */
export const BACKFILL_RIDGE_HALF_M = PORTAL_HALF_WIDTH_M - (BORE_DEPTH_M - BACKFILL_BERM_M);
/**
 * Beyond the wings' end piers the fill meets the ground at the open front and rises from it at most this per metre:
 * 45°, the rise the core's earthworks take past a structure end (`HEADWALL_RISE`). At 1 : 1.5 a bank at a low
 * portal's downhill corner chased the falling ground and needed a 15 m wing to back the face.
 */
export const OPEN_FRONT_RISE = HEADWALL_RISE;
/** A wing stops where the hill it retains stands less than this over the drawn ground in front. */
export const WING_MIN_RETAIN_M = 0.3;
/** Wall feet reach at least this far under the coping (`wallFootV`). */
export const WALL_FOOT_UNDER_SKYLINE_M = 2.5;
/** The end pier closing each wing: along the wing past its end, its thickness past the wall's, and its top over the coping. */
export const WING_PIER_ALONG_M: readonly [number, number] = [-0.1, 0.6];
export const WING_PIER_PROUD_M = 0.15;
export const WING_PIER_TOP_V = 0.5;

/**
 * The masonry tops the plug abuts (the portal asset's, `assets.ts`): the face's parapet coping (its top over the track
 * height, its back edge behind the face plane and its half width), the cornice beside it (its top is the face top), and
 * each wing's coping (its height over the wall top and its overhang past the wall's faces).
 */
export const FACE_COPING_TOP_V = PORTAL_TOP_V + PORTAL_PARAPET_M + COPING_M;
export const FACE_COPING_BACK_M = 0.71;
export const FACE_COPING_HALF_M = PORTAL_HALF_WIDTH_M + 0.05;
export const CORNICE_BACK_M = PORTAL_WALL_M;
export const CORNICE_HALF_M = PORTAL_HALF_WIDTH_M + 0.14;
export const WING_COPING_H_M = 0.28;
export const WING_COPING_OVER_M = 0.06;
/** The end pier's cap: its height over the pier top. */
export const WING_PIER_CAP_M = 0.16;
/**
 * Behind the masonry's back edge the plug's cap (`masonryCapV`) rises this much per metre (2 : 1) until it meets the
 * ground it draws: steeper than the core's 45° retained headwall behind the face, so it rejoins it within a metre.
 */
export const MASONRY_CAP_RISE = 2;
/** Within the masonry's plan the plug stays this far under its top (the plug's own 4 cm lift included by the caller). */
export const MASONRY_CAP_UNDER_M = 0.02;

/**
 * The highest the hill plug may stand over the track height at (s, u) behind the portal's masonry (verification
 * finding 2026-09-29): no higher than the top of the masonry its front line runs under, less MASONRY_CAP_UNDER_M,
 * rising at MASONRY_CAP_RISE behind that masonry's back edge; +Infinity away from it. Behind the face plane the core's
 * retained hill rises 45° from 0.25 m over the face top, so it stood over the parapet coping's back edge (0.17 m at
 * the plug's front line) and up to 0.8 m over the wing coping at the face's corners: the plug's front edge floated
 * there, and rays passed under it to the dark bore behind (a black sliver along the coping, a black notch at the
 * corner). The lowest over the face (its coping, then the cornice beside it) and each wing (its coping from its root;
 * inside the corner, where the wall has no coping, the face top; the end pier's cap past its end).
 */
export function masonryCapV(s: number, u: number, wings: PortalWings): number {
  const au = u < 0 ? -u : u;
  let cap = Number.POSITIVE_INFINITY;
  if (au <= CORNICE_HALF_M) {
    const coping = au <= FACE_COPING_HALF_M;
    const top = coping ? FACE_COPING_TOP_V : PORTAL_TOP_V;
    const back = coping ? FACE_COPING_BACK_M : CORNICE_BACK_M;
    cap = top - MASONRY_CAP_UNDER_M + (s > back ? MASONRY_CAP_RISE * (s - back) : 0);
  }
  const c = PORTAL_WING_SPLAY_COS;
  const k = PORTAL_WING_SPLAY_SIN;
  for (const side of [1, -1] as const) {
    const length = side === 1 ? wings.right : wings.left;
    if (length <= 0.05) continue;
    const du = side * u - PORTAL_HALF_WIDTH_M;
    const along = -k * s + c * du;
    const end = length + (WING_PIER_ALONG_M[1] ?? 0);
    // From the corner between the face's cornice and the wing's coping (inside the face's width the face governs) to
    // the end pier's far side.
    if (along > end || (along < 0 && (au <= CORNICE_HALF_M || along < -PORTAL_WALL_M))) continue;
    const behind = c * s + k * du;
    const steep = side === 1 ? wings.steepRight === true : wings.steepLeft === true;
    const pier = along > length + (WING_PIER_ALONG_M[0] ?? 0);
    const top = along < 0 ? PORTAL_TOP_V : pier ? wingCopingV(length, steep) + WING_PIER_TOP_V + WING_PIER_CAP_M : wingCopingV(along, steep) + WING_COPING_H_M;
    const back = pier ? WING_T + WING_PIER_PROUD_M + WING_COPING_OVER_M : along < 0 ? WING_T : WING_T + WING_COPING_OVER_M;
    const wing = top - MASONRY_CAP_UNDER_M + (behind > back ? MASONRY_CAP_RISE * (behind - back) : 0);
    if (wing < cap) cap = wing;
  }
  return cap;
}

/** The retained skyline over the track height at |u| (7.65 m over the face, then 1 : 1.5). */
export function retainV(u: number): number {
  return portalSkylineV(u) + PORTAL_RETAIN_ABOVE_TOP_M;
}

/** A point of the outline in the portal frame. */
export interface FramePoint {
  s: number;
  u: number;
}

/** The point t metres along the wing on side `side` (+1 right, −1 left) from the face's edge, written to `out`. */
export function wingPoint(side: 1 | -1, t: number, out: FramePoint = { s: 0, u: 0 }): FramePoint {
  out.s = -PORTAL_WING_SPLAY_SIN * t;
  out.u = side * (PORTAL_HALF_WIDTH_M + PORTAL_WING_SPLAY_COS * t);
  return out;
}

/** |u| t metres along a wing. */
export function wingAcross(t: number): number {
  return PORTAL_HALF_WIDTH_M + PORTAL_WING_SPLAY_COS * t;
}

/** The unit normal of the wing on `side` pointing behind it (into the hill): (cos, side · sin) in (s, u). */
export function wingBack(side: 1 | -1): FramePoint {
  return { s: PORTAL_WING_SPLAY_COS, u: side * PORTAL_WING_SPLAY_SIN };
}

/** The wall's foot under the track height where its coping stands `copingV` over it, for a face `depthM` deep (see the module comment). */
export function wallFootV(copingV: number, depthM: number): number {
  return Math.min(-Math.max(1, depthM), copingV - WALL_FOOT_UNDER_SKYLINE_M);
}

/**
 * A steep wing's coping falls this much per metre along it (45°, the bank beyond the end piers, OPEN_FRONT_RISE):
 * where a wing on the 1 : 1.5 skyline could not back the face (a low portal's downhill side, whose fill runs out
 * as a bank), its coping follows the bank behind it down to the ground in front (`plug.ts`, `portalWings`), so the
 * fill behind stays under the coping all along it and the wall's back never shows above it in a strip.
 */
export const WING_STEEP_FALL = 1;

/** A portal's wings: their lengths along their lines, and whether each is steep (`WING_STEEP_FALL`). */
export interface PortalWings {
  readonly left: number;
  readonly right: number;
  readonly steepLeft?: boolean;
  readonly steepRight?: boolean;
}

/** The coping's height over the track height t metres along a wing: the portal skyline by |u|, or falling 45° when steep. */
export function wingCopingV(t: number, steep = false): number {
  if (t <= 0) return PORTAL_TOP_V;
  return steep ? PORTAL_TOP_V - WING_STEEP_FALL * t : portalSkylineV(wingAcross(t));
}

/**
 * How far (s, u) lies behind the plug's front edge (PLUG_START_M behind the face plane and behind each wing's front
 * face, the wing lines running on past their ends): ≥ 0 on the hill side, where a plug may draw. The largest of three
 * linear functions, so it is exact inside each and continuous at the corners.
 */
export function behindFront(s: number, u: number): number {
  const face = s - PLUG_START_M;
  // n · (P − c) for the wing through c = (0, side · 4.2) with n = (cos, side · sin): cos · s + sin · (side · u − 4.2).
  const right = PORTAL_WING_SPLAY_COS * s + PORTAL_WING_SPLAY_SIN * (u - PORTAL_HALF_WIDTH_M) - PLUG_START_M;
  const left = PORTAL_WING_SPLAY_COS * s + PORTAL_WING_SPLAY_SIN * (-u - PORTAL_HALF_WIDTH_M) - PLUG_START_M;
  return face > right ? (face > left ? face : left) : right > left ? right : left;
}

/**
 * Whether masonry stands over the plug's front line at (s, u): the face across its width, or a wing from its root to
 * the far side of its end pier (the line lies PLUG_START_M behind the walls' fronts).
 */
export function underMasonry(s: number, u: number, wings: PortalWings): boolean {
  const au = u < 0 ? -u : u;
  if (au <= PORTAL_HALF_WIDTH_M) return true;
  const length = u >= 0 ? wings.right : wings.left;
  if (length <= 0.05) return false;
  const along = -PORTAL_WING_SPLAY_SIN * s + PORTAL_WING_SPLAY_COS * (au - PORTAL_HALF_WIDTH_M);
  return along <= length + (WING_PIER_ALONG_M[1] ?? 0) + PLUG_START_M * PORTAL_WING_SPLAY_SIN;
}

/**
 * The plan distance from (s, u) to the open front beyond the wing on `side` of length `wingM`: the ray along the
 * wing line (PLUG_START_M behind it) from the outer end of its end pier on, measured square to the ray past its
 * origin and by an octagonal norm before it. Where no wing stands (0 m), the ray starts at the face's edge.
 * The nearest point of the ray is written to `foot` when given.
 */
export function openFrontDistance(side: 1 | -1, wingM: number, s: number, u: number, foot?: FramePoint): number {
  const t = wingM > 0.05 ? wingM + (WING_PIER_ALONG_M[1] ?? 0) : 0;
  const c = PORTAL_WING_SPLAY_COS;
  const k = PORTAL_WING_SPLAY_SIN;
  // Ray origin: the wing point at t, moved PLUG_START_M behind the wing; direction (−sin, side · cos).
  const os = -k * t + PLUG_START_M * c;
  const ou = side * (PORTAL_HALF_WIDTH_M + c * t + PLUG_START_M * k);
  const ds = s - os;
  const du = u - ou;
  const along = -k * ds + side * c * du;
  const across = c * ds + side * k * du;
  const off = across < 0 ? -across : across;
  if (along <= 0) {
    if (foot) {
      foot.s = os;
      foot.u = ou;
    }
    // Before the ray's origin (round the wing's end pier): an octagonal norm of the offsets along and across, planar
    // on each face and exactly 1 : 1 steep, so the bank the plug draws from it is planar there, which the 1.25 m
    // lattice reproduces exactly (a cone met the wall's back in a sawtooth), and continuous with the ray's side.
    const back = -along;
    const diagonal = (off + back) * Math.SQRT1_2;
    return off > back ? (off > diagonal ? off : diagonal) : back > diagonal ? back : diagonal;
  }
  if (foot) {
    foot.s = os - k * along;
    foot.u = ou + side * c * along;
  }
  return off;
}

/**
 * The origin of the open front's ray beyond the wing on `side` of length `wingM` (`openFrontDistance`): the outer end
 * of its end pier, PLUG_START_M behind the wing line (the face's edge where no wing stands), written to `out`.
 */
export function openFrontOrigin(side: 1 | -1, wingM: number, out: FramePoint): FramePoint {
  const t = wingM > 0.05 ? wingM + (WING_PIER_ALONG_M[1] ?? 0) : 0;
  out.s = -PORTAL_WING_SPLAY_SIN * t + PLUG_START_M * PORTAL_WING_SPLAY_COS;
  out.u = side * (PORTAL_HALF_WIDTH_M + PORTAL_WING_SPLAY_COS * t + PLUG_START_M * PORTAL_WING_SPLAY_SIN);
  return out;
}

/**
 * The compact backfill's height over the track height at (s, u) behind the outline (see the module comment): the
 * berm at the retained skyline falling 1 : 1.5 behind the face, the ridge over the bore, and, given the wings'
 * lengths, a berm behind each wing at the retained skyline of its nearest point (its own coping, less the coping's
 * 3 cm) for BACKFILL_BERM_M behind its front face, falling 1 : 1.5 behind that and past its end. Without wings (the
 * scenery's reckoning) the face's berm runs on beside the face along the wings' coping line.
 */
export function backfillV(s: number, u: number, wings?: PortalWings): number {
  const au = u < 0 ? -u : u;
  const top = PORTAL_TOP_V + PORTAL_RETAIN_ABOVE_TOP_M;
  // In front of the face plane the face holds nothing: the wings do (their berms, below). Beside a steep wing the
  // face's berm falls as its coping does (45° along it), so it never stands over it.
  const ahead = wings && s < 0 ? -s / BACKFILL_RUN : 0;
  const steepHere = u >= 0 ? wings?.steepRight === true : wings?.steepLeft === true;
  const sideRun = steepHere ? PORTAL_WING_SPLAY_COS / WING_STEEP_FALL : PORTAL_WING_RUN;
  const berm = top - (au > PORTAL_HALF_WIDTH_M ? (au - PORTAL_HALF_WIDTH_M) / sideRun : 0) - (s > BACKFILL_BERM_M ? (s - BACKFILL_BERM_M) / BACKFILL_RUN : 0) - ahead;
  const ridge = top - (au > BACKFILL_RIDGE_HALF_M ? (au - BACKFILL_RIDGE_HALF_M) / BACKFILL_RUN : 0) - (s > BORE_DEPTH_M ? (s - BORE_DEPTH_M) / BACKFILL_RUN : 0);
  const best = berm > ridge ? berm : ridge;
  if (!wings) return best;
  const right = wingBerm(s, u, 1, wings.right, wings.steepRight === true);
  const left = wingBerm(s, u, -1, wings.left, wings.steepLeft === true);
  const wing = right > left ? right : left;
  return wing > best ? wing : best;
}

/** The berm behind the wing on `side` (see `backfillV`), −Infinity where the point is not behind it. */
function wingBerm(s: number, u: number, side: 1 | -1, length: number, steep: boolean): number {
  if (length <= 0.05) return Number.NEGATIVE_INFINITY;
  const c = PORTAL_WING_SPLAY_COS;
  const k = PORTAL_WING_SPLAY_SIN;
  // The wing through (0, side · 4.2): along it (−sin, side · cos), behind it (cos, side · sin).
  const du = side * u - PORTAL_HALF_WIDTH_M;
  const behind = c * s + k * du;
  if (behind < 0) return Number.NEGATIVE_INFINITY;
  const along = -k * s + c * du;
  const end = length + (WING_PIER_ALONG_M[1] ?? 0);
  const t = along < 0 ? 0 : along > end ? end : along;
  const past = along > end ? along - end : along < 0 ? -along : 0;
  return wingCopingV(t, steep) + PORTAL_RETAIN_ABOVE_TOP_M - (behind > BACKFILL_BERM_M ? (behind - BACKFILL_BERM_M) / BACKFILL_RUN : 0) - past / BACKFILL_RUN;
}

/** How far the backfill can reach behind the face (s) and across (|u|): where it has fallen the retained skyline's height. */
export const BACKFILL_REACH_S_M = BORE_DEPTH_M + (PORTAL_TOP_V + PORTAL_RETAIN_ABOVE_TOP_M) * BACKFILL_RUN;
export const BACKFILL_REACH_U_M = PORTAL_HALF_WIDTH_M + (PORTAL_TOP_V + PORTAL_RETAIN_ABOVE_TOP_M) * PORTAL_WING_RUN;
