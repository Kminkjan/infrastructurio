import { Color, type Vector3Like } from "three";
import type { AssetData, AssetRegistry } from "../art/AssetRegistry";
import { palette } from "../art/palette";
import {
  ABUTMENT_BACK_M,
  ABUTMENT_HALF_WIDTH_M,
  ARCH_CROWN_V,
  ARCH_MIN_OPENING_M,
  ARCH_RING_M,
  BORE_DEPTH_M,
  BORE_HALF_M,
  BORE_SPRING_V,
  COPING_M,
  CUTWATER_M,
  DECK_HALF_M,
  DECK_V,
  GIRDER_WEB_M,
  PARAPET_INNER_M,
  PARAPET_TOP_V,
  PIER_BATTER,
  PIER_HALF_WIDTH_M,
  PIER_THICKNESS_M,
  PORTAL_HALF_WIDTH_M,
  PORTAL_PARAPET_M,
  PORTAL_TOP_V,
  PORTAL_WALL_M,
  STEEL_END_M,
  STEEL_SEAT_V,
  TRUSS_BOTTOM_V,
  PORTAL_WING_SPLAY_SIN,
  TRUSS_PLANE_M,
  WING_T,
  portalSkylineV,
} from "./dimensions";
import { girderDepthM, trussDepthM } from "./layout";
import {
  CORNICE_BACK_M,
  CORNICE_HALF_M,
  FACE_COPING_BACK_M,
  FACE_COPING_HALF_M,
  FACE_COPING_TOP_V,
  WALL_FOOT_UNDER_SKYLINE_M,
  WING_COPING_H_M,
  WING_COPING_OVER_M,
  WING_PIER_ALONG_M,
  WING_PIER_CAP_M,
  WING_PIER_PROUD_M,
  WING_PIER_TOP_V,
  wallFootV,
  wingAcross,
  wingBack,
  wingCopingV,
  wingPoint,
} from "./portalOutline";
import { BEND_SEGMENT_M, type StructureBuilder as SB, StructureBuilder } from "./structureBuilder";

/**
 * Period structures as procedural assets (art direction "Structures", ADR
 * 0013 decision 1): each kind registers with `AssetRegistry` and returns its
 * geometry per material slot (walls, trim, metal), a plan footprint and a
 * triangle budget, in model space (metres, +Y up, forward +X, +Z right of
 * travel). The variant packs the few dimensions a part needs, in decimetres,
 * so equal parts share one cached template (a viaduct's arches mostly repeat).
 *
 * Forms are generic 1900 Russian-Empire Baltic railway types, simplified to
 * read at Default zoom: a stone arch viaduct with voussoir rings, keystones,
 * a string course and coped parapets; a through Warren truss with inclined end
 * posts and top bracing; a through plate girder with stiffeners; masonry piers
 * with a plinth and an impost cap (pointed cutwaters in water); an abutment with
 * newel posts; a tunnel portal with an arched opening, pilasters, a cornice,
 * wing walls falling at 1 : 1.5 and a dark bore behind it. Nothing is taken
 * from another game's models.
 *
 * Spans run x ∈ [0, L] between their supports' centres and hang from the track
 * height (y = 0); piers stand on their foot (y = 0); abutments and portals sit
 * at the run's end node at the track height, +X toward the span or into the
 * tunnel. `place.ts` bends spans along a run and places the rest rigidly.
 */

export const ARCH_KIND = "bridge-arch";
export const TRUSS_KIND = "bridge-truss";
export const GIRDER_KIND = "bridge-girder";
export const PIER_KIND = "bridge-pier";
export const ABUTMENT_KIND = "bridge-abutment";
export const PORTAL_KIND = "tunnel-portal";

/** Triangle budgets (ADR 0013: every asset carries one; a test fails any asset over it). */
export const STRUCTURE_BUDGETS = {
  [ARCH_KIND]: 700,
  [TRUSS_KIND]: 2600,
  [GIRDER_KIND]: 1400,
  [PIER_KIND]: 260,
  [ABUTMENT_KIND]: 320,
  [PORTAL_KIND]: 1700,
} as const;

type P = Vector3Like;
const v = (x: number, y: number, z: number): P => ({ x, y, z });
const dm = (m: number): number => Math.max(0, Math.round(m * 10));

// ---- Variants: dimensions in decimetres packed into one integer ------------------------------------------------

/** Arch span: length (10 bits), rise (7 bits; 0 is a solid wall) and a solid wall's depth below the track (9 bits). */
export function archVariant(lengthM: number, riseM: number, solidDepthM: number): number {
  return Math.min(1023, dm(lengthM)) | (Math.min(127, dm(riseM)) << 10) | (Math.min(511, dm(solidDepthM)) << 17);
}
export function unpackArch(variant: number): { lengthM: number; riseM: number; solidDepthM: number } {
  return { lengthM: (variant & 1023) / 10, riseM: ((variant >> 10) & 127) / 10, solidDepthM: ((variant >> 17) & 511) / 10 };
}
/** Truss and girder spans: the length (12 bits). */
export function spanVariant(lengthM: number): number {
  return Math.min(4095, dm(lengthM));
}
/** Pier: height foot to top (11 bits) and whether it stands in water (bit 11). */
export function pierVariant(heightM: number, wet: boolean): number {
  return Math.min(2047, dm(heightM)) | (wet ? 2048 : 0);
}
export function unpackPier(variant: number): { heightM: number; wet: boolean } {
  return { heightM: (variant & 2047) / 10, wet: (variant & 2048) !== 0 };
}
/** Abutment: its foot's depth under the track height (11 bits). */
export function abutmentVariant(depthM: number): number {
  return Math.min(2047, dm(depthM));
}
/** Portal: left and right wing lengths (8 bits each), the face's depth under the track height (7 bits) and whether each wing is steep (bits 23, 24). */
export function portalVariant(wingLeftM: number, wingRightM: number, depthM: number, steepLeft = false, steepRight = false): number {
  return Math.min(255, dm(wingLeftM)) | (Math.min(255, dm(wingRightM)) << 8) | (Math.min(127, dm(depthM)) << 16) | (steepLeft ? 1 << 23 : 0) | (steepRight ? 1 << 24 : 0);
}
export function unpackPortal(variant: number): { wingLeftM: number; wingRightM: number; depthM: number; steepLeft: boolean; steepRight: boolean } {
  return { wingLeftM: (variant & 255) / 10, wingRightM: ((variant >> 8) & 255) / 10, depthM: ((variant >> 16) & 127) / 10, steepLeft: (variant & (1 << 23)) !== 0, steepRight: (variant & (1 << 24)) !== 0 };
}

/** Splits [a, b] into pieces no longer than BEND_SEGMENT_M: the break points, both ends included. */
function breaks(a: number, b: number, most = BEND_SEGMENT_M): number[] {
  const n = Math.max(1, Math.ceil((b - a) / most - 1e-9));
  return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
}

const scaled = new Color();

/** A palette colour darkened by `k` (shading, like baked AO; never a new colour). */
function shade(sb: SB, slot: "walls" | "trim" | "metal", hex: number, k: number): void {
  sb.use(slot, hex);
  scaled.setHex(hex).multiplyScalar(k);
  sb.current.colorLinear(scaled);
}

// ---- Stone arch span -------------------------------------------------------------------------------------------

/** Intrados and extrados points of an arch over [T/2, L − T/2] with its crown at ARCH_CROWN_V and the given rise. */
export function archCurve(lengthM: number, riseM: number, ringM = ARCH_RING_M): { inner: { x: number; y: number }[]; outer: { x: number; y: number }[]; springV: number } {
  const opening = lengthM - PIER_THICKNESS_M;
  const r = Math.min(riseM, opening / 2);
  const radius = (opening * opening) / 4 / (2 * r) + r / 2;
  const cx = lengthM / 2;
  const cy = ARCH_CROWN_V - radius;
  const phi = Math.asin(Math.min(1, opening / 2 / radius));
  const n = 2 * Math.max(2, Math.round(phi / (Math.PI / 12))) + 1;
  const inner: { x: number; y: number }[] = [];
  const outer: { x: number; y: number }[] = [];
  for (let k = 0; k <= n; k++) {
    const t = Math.PI / 2 + phi - (2 * phi * k) / n;
    inner.push({ x: cx + radius * Math.cos(t), y: cy + radius * Math.sin(t) });
    outer.push({ x: cx + (radius + ringM) * Math.cos(t), y: cy + (radius + ringM) * Math.sin(t) });
  }
  return { inner, outer, springV: ARCH_CROWN_V - r };
}

/** Parapets (inner faces and coping), the deck top between them, and the string course along both faces. */
function deckAndParapets(sb: SB, x0: number, x1: number): void {
  const xs = breaks(x0, x1);
  shade(sb, "walls", palette.masonryDark, 1);
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i] ?? 0;
    const e = xs[i + 1] ?? 0;
    sb.quad(v(a, DECK_V, -PARAPET_INNER_M), v(e, DECK_V, -PARAPET_INNER_M), v(e, DECK_V, PARAPET_INNER_M), v(a, DECK_V, PARAPET_INNER_M), v((a + e) / 2, DECK_V - 0.5, 0));
  }
  for (const side of [1, -1]) {
    const zi = side * PARAPET_INNER_M;
    sb.use("walls", palette.masonry);
    for (let i = 0; i + 1 < xs.length; i++) {
      const a = xs[i] ?? 0;
      const e = xs[i + 1] ?? 0;
      sb.quad(v(a, DECK_V, zi), v(e, DECK_V, zi), v(e, PARAPET_TOP_V, zi), v(a, PARAPET_TOP_V, zi), v((a + e) / 2, 0.4, zi + side * 0.2));
    }
    const zin = side * (PARAPET_INNER_M - 0.06);
    const zout = side * (DECK_HALF_M + 0.06);
    sb.use("trim", palette.masonryLight).bar(x0, x1, PARAPET_TOP_V, PARAPET_TOP_V + COPING_M, Math.min(zin, zout), Math.max(zin, zout), { x0: false, x1: false });
    const zc0 = side * DECK_HALF_M;
    const zc1 = side * (DECK_HALF_M + 0.1);
    sb.bar(x0, x1, DECK_V - 0.3, DECK_V - 0.1, Math.min(zc0, zc1), Math.max(zc0, zc1), {
      x0: false,
      x1: false,
      y0: true,
      z0: side < 0,
      z1: side > 0,
    });
  }
}

/** A stone arch span of `lengthM` between pier centres; `riseM` 0 (or an opening too short) draws a solid wall `solidDepthM` deep. */
export function buildArchSpan(lengthM: number, riseM: number, solidDepthM: number): StructureBuilder {
  const sb = new StructureBuilder();
  const top = PARAPET_TOP_V;
  const opening = lengthM - PIER_THICKNESS_M;
  const solid = riseM <= 0 || opening < ARCH_MIN_OPENING_M;
  const arch = solid ? undefined : archCurve(lengthM, riseM);
  for (const side of [1, -1]) {
    const z = side * DECK_HALF_M;
    const inside = (x: number, y: number): P => v(x, y, z - side * 0.5);
    const face = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }): void => {
      sb.quad(v(a.x, a.y, z), v(b.x, b.y, z), v(c.x, c.y, z), v(d.x, d.y, z), inside((a.x + c.x) / 2, (a.y + c.y) / 2));
    };
    const strip = (x0: number, x1: number, bottom: number): void => {
      if (x1 - x0 < 1e-6) return;
      const xs = breaks(x0, x1);
      for (let i = 0; i + 1 < xs.length; i++) {
        const a = xs[i] ?? 0;
        const e = xs[i + 1] ?? 0;
        face({ x: a, y: bottom }, { x: e, y: bottom }, { x: e, y: top }, { x: a, y: top });
      }
    };
    sb.use("walls", palette.masonry);
    if (!arch) {
      strip(0, lengthM, -solidDepthM);
      continue;
    }
    const { inner, outer, springV } = arch;
    const n = inner.length - 1;
    const first = outer[0] as { x: number; y: number };
    const last = outer[n] as { x: number; y: number };
    strip(0, first.x, springV);
    strip(last.x, lengthM, springV);
    // Skewbacks: the wedge under an inclined ring's first and last stone (none on a semicircle).
    const i0 = inner[0] as { x: number; y: number };
    const iN = inner[n] as { x: number; y: number };
    if (first.y > springV + 1e-6) sb.triangle(v(first.x, springV, z), v(i0.x, i0.y, z), v(first.x, first.y, z), inside(first.x, springV + 0.1));
    if (last.y > springV + 1e-6) sb.triangle(v(iN.x, iN.y, z), v(last.x, springV, z), v(last.x, last.y, z), inside(last.x, springV + 0.1));
    const middle = (n - 1) / 2;
    for (let k = 0; k < n; k++) {
      const a = inner[k] as { x: number; y: number };
      const b = inner[k + 1] as { x: number; y: number };
      const c = outer[k + 1] as { x: number; y: number };
      const d = outer[k] as { x: number; y: number };
      // Voussoirs alternate dressed and plain stone, the keystone dressed.
      if ((k - middle) % 2 === 0) sb.use("trim", palette.masonryLight);
      else shade(sb, "trim", palette.masonryLight, 0.86);
      face(a, b, c, d);
      sb.use("walls", palette.masonry);
      face(d, c, { x: c.x, y: top }, { x: d.x, y: top });
    }
  }
  if (arch) {
    // The barrel's underside, facing into the opening.
    shade(sb, "walls", palette.masonryDark, 0.92);
    const { inner } = arch;
    for (let k = 0; k + 1 < inner.length; k++) {
      const a = inner[k] as { x: number; y: number };
      const b = inner[k + 1] as { x: number; y: number };
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const w = DECK_HALF_M;
      sb.quad(v(a.x, a.y, w), v(b.x, b.y, w), v(b.x, b.y, -w), v(a.x, a.y, -w), v(mx, my + 0.4, 0));
    }
  }
  deckAndParapets(sb, 0, lengthM);
  return sb;
}

// ---- Steel spans -----------------------------------------------------------------------------------------------

const ALONG = v(1, 0, 0);
const ACROSS = v(0, 0, 1);
const UP = v(0, 1, 0);

/** The steel deck plate between supports, and the stone bed blocks the span bears on. */
function steelDeck(sb: SB, lengthM: number, halfWidth: number, bearingsAt: readonly number[], bearingTopV: number): void {
  shade(sb, "metal", palette.steel, 0.85);
  sb.bar(0, lengthM, -0.55, DECK_V, -halfWidth, halfWidth, { x0: false, x1: false });
  sb.use("trim", palette.masonryLight);
  for (const x of [STEEL_END_M, lengthM - STEEL_END_M]) {
    for (const z of bearingsAt) sb.bar(x - 0.35, x + 0.35, STEEL_SEAT_V, bearingTopV, z - 0.4, z + 0.4, { x0: true, x1: true, z0: true, z1: true });
  }
}

/** A through Warren truss span: two trusses with inclined end posts, top bracing and portal struts, floor beams and a deck plate. */
export function buildTrussSpan(lengthM: number): StructureBuilder {
  const sb = new StructureBuilder();
  const x0 = STEEL_END_M;
  const x1 = lengthM - STEEL_END_M;
  const depth = trussDepthM(lengthM);
  const panels = Math.max(2, Math.round((x1 - x0) / (1.15 * depth)));
  const p = (x1 - x0) / panels;
  const yb = TRUSS_BOTTOM_V;
  const yt = yb + depth;
  const bottomX = (i: number): number => x0 + i * p;
  const topX = (i: number): number => x0 + (i + 0.5) * p;
  sb.use("metal", palette.steel);
  for (const side of [1, -1]) {
    const zc = side * TRUSS_PLANE_M;
    for (let i = 0; i < panels; i++) sb.beam(v(bottomX(i), yb, zc), v(bottomX(i + 1), yb, zc), 0.36, 0.42, ACROSS);
    for (let i = 0; i + 1 < panels; i++) sb.beam(v(topX(i), yt, zc), v(topX(i + 1), yt, zc), 0.4, 0.44, ACROSS);
    for (let i = 0; i < panels; i++) {
      const endPost = (k: number): boolean => (k === 0 && i === 0) || (k === 1 && i === panels - 1);
      const up = [v(bottomX(i), yb, zc), v(topX(i), yt, zc)] as const;
      const down = [v(topX(i), yt, zc), v(bottomX(i + 1), yb, zc)] as const;
      sb.beam(up[0], up[1], endPost(0) ? 0.4 : 0.26, endPost(0) ? 0.44 : 0.3, ACROSS);
      sb.beam(down[0], down[1], endPost(1) ? 0.4 : 0.26, endPost(1) ? 0.44 : 0.3, ACROSS);
    }
  }
  for (let i = 0; i < panels; i++) {
    const portalStrut = i === 0 || i === panels - 1;
    sb.beam(v(topX(i), yt, -TRUSS_PLANE_M), v(topX(i), yt, TRUSS_PLANE_M), 0.24, portalStrut ? 0.95 : 0.3, ALONG);
    if (i + 1 < panels) {
      sb.beam(v(topX(i), yt + 0.05, -TRUSS_PLANE_M), v(topX(i + 1), yt + 0.05, TRUSS_PLANE_M), 0.12, 0.12, UP);
      sb.beam(v(topX(i), yt + 0.05, TRUSS_PLANE_M), v(topX(i + 1), yt + 0.05, -TRUSS_PLANE_M), 0.12, 0.12, UP);
    }
  }
  for (let i = 0; i <= panels; i++) sb.beam(v(bottomX(i), yb - 0.05, -TRUSS_PLANE_M), v(bottomX(i), yb - 0.05, TRUSS_PLANE_M), 0.3, 0.5, ALONG);
  steelDeck(sb, lengthM, TRUSS_PLANE_M - 0.25, [-TRUSS_PLANE_M, TRUSS_PLANE_M], yb - 0.21);
  return sb;
}

/** A through plate-girder span: two deep girders with flanges and stiffeners beside the track, and a deck plate between. */
export function buildGirderSpan(lengthM: number): StructureBuilder {
  const sb = new StructureBuilder();
  const x0 = STEEL_END_M;
  const x1 = lengthM - STEEL_END_M;
  const yb = STEEL_SEAT_V + 0.22;
  const yt = yb + girderDepthM(lengthM);
  const stiffeners = Math.max(2, Math.round((x1 - x0) / 1.6));
  for (const side of [1, -1]) {
    const zc = side * GIRDER_WEB_M;
    const lo = (a: number, b: number) => Math.min(a, b);
    const hi = (a: number, b: number) => Math.max(a, b);
    sb.use("metal", palette.steel);
    sb.bar(x0, x1, yb + 0.08, yt - 0.08, zc - 0.06, zc + 0.06, { y1: false });
    sb.bar(x0, x1, yt - 0.09, yt, zc - 0.26, zc + 0.26, { y0: true });
    sb.bar(x0, x1, yb, yb + 0.09, zc - 0.26, zc + 0.26, {});
    // Stiffeners on the outer face, heavier over the bearings.
    shade(sb, "metal", palette.steel, 1.12);
    const zo0 = zc + side * 0.06;
    const zo1 = zc + side * 0.2;
    for (let i = 0; i <= stiffeners; i++) {
      const x = x0 + 0.12 + ((x1 - x0 - 0.24) * i) / stiffeners;
      const w = i === 0 || i === stiffeners ? 0.12 : 0.06;
      sb.bar(x - w, x + w, yb + 0.09, yt - 0.09, lo(zo0, zo1), hi(zo0, zo1), { y1: false, z0: side < 0, z1: side > 0 });
    }
  }
  steelDeck(sb, lengthM, GIRDER_WEB_M - 0.07, [-GIRDER_WEB_M, GIRDER_WEB_M], yb);
  return sb;
}

// ---- Piers and abutments ---------------------------------------------------------------------------------------

/** A plan ring for a pier at half thickness `t` (along) and half width `w` (across), with cutwater points when wet. */
function pierRing(t: number, w: number, wet: boolean): [number, number][] {
  if (!wet) return [[-t, -w], [t, -w], [t, w], [-t, w]];
  return [[-t, -w], [0, -w - CUTWATER_M], [t, -w], [t, w], [0, w + CUTWATER_M], [-t, w]];
}

/** Pier bands as rings grown by `grow` at height `y` above the foot of a pier `height` tall (the batter widens it downwards). */
function ringAt(height: number, y: number, grow: number, wet: boolean): [number, number][] {
  const b = PIER_BATTER * (height - y);
  return pierRing(PIER_THICKNESS_M / 2 + b + grow, PIER_HALF_WIDTH_M + b + grow, wet);
}

/** A masonry pier `heightM` from foot to top: plinth, battered shaft, string courses on tall piers, impost cap. */
export function buildPier(heightM: number, wet: boolean): StructureBuilder {
  const sb = new StructureBuilder();
  const h = Math.max(0.6, heightM);
  const cap = Math.min(0.4, h * 0.2);
  const plinth = Math.min(1.6, 0.5 + 0.08 * h, h - cap - 0.1);
  sb.ao({ floor: 0.8, heightM: 2.6 });
  shade(sb, "walls", palette.masonryDark, 1);
  sb.frustum(ringAt(h, 0, 0.25, wet), ringAt(h, plinth, 0.25, wet), 0, plinth);
  sb.use("walls", palette.masonry);
  sb.frustum(ringAt(h, plinth, 0, wet), ringAt(h, h - cap, 0, wet), plinth, h - cap, false);
  sb.use("trim", palette.masonryLight);
  for (let y = plinth + 6; y < h - cap - 2.5; y += 6.5) sb.frustum(ringAt(h, y, 0.08, wet), ringAt(h, y + 0.24, 0.08, wet), y, y + 0.24);
  sb.frustum(ringAt(h, h - cap, 0.12, wet), ringAt(h, h, 0.12, wet), h - cap, h);
  sb.ao(undefined);
  return sb;
}

/** An abutment at a run's end: a block reaching `depthM` under the track height, parapets with newel posts. */
export function buildAbutment(depthM: number): StructureBuilder {
  const sb = new StructureBuilder();
  const back = -ABUTMENT_BACK_M;
  const front = PIER_THICKNESS_M / 2;
  const w = ABUTMENT_HALF_WIDTH_M;
  sb.use("walls", palette.masonry).bar(back, front, -Math.max(0.5, depthM), DECK_V, -w, w, {});
  for (const side of [1, -1]) {
    const lo = (a: number, b: number) => Math.min(a, b);
    const hi = (a: number, b: number) => Math.max(a, b);
    const zi = side * PARAPET_INNER_M;
    const zo = side * w;
    sb.use("walls", palette.masonry).bar(back + 0.8, front, DECK_V, PARAPET_TOP_V, lo(zi, zo), hi(zi, zo), { y1: false, x0: false });
    sb.use("trim", palette.masonryLight).bar(back + 0.8, front, PARAPET_TOP_V, PARAPET_TOP_V + COPING_M, lo(zi - side * 0.06, zo + side * 0.06), hi(zi - side * 0.06, zo + side * 0.06), { x0: false });
    // Newel post closing the parapet at the approach.
    const n0 = side * (PARAPET_INNER_M - 0.1);
    const n1 = side * (w + 0.1);
    sb.use("walls", palette.masonry).bar(back - 0.05, back + 0.8, DECK_V, PARAPET_TOP_V + 0.45, lo(n0, n1), hi(n0, n1), { y1: false });
    sb.use("trim", palette.masonryLight).bar(back - 0.11, back + 0.86, PARAPET_TOP_V + 0.45, PARAPET_TOP_V + 0.62, lo(n0, n1) - 0.06, hi(n0, n1) + 0.06, {});
    // Quoins up the front corners.
    const q0 = side * (w - 0.5);
    const q1 = side * (w + 0.02);
    shade(sb, "trim", palette.masonryLight, 0.94);
    sb.bar(front - 0.5, front + 0.02, -Math.max(0.5, depthM), DECK_V, lo(q0, q1), hi(q0, q1), { x0: false, y1: false, z0: side < 0, z1: side > 0 });
  }
  return sb;
}

// ---- Tunnel portal ---------------------------------------------------------------------------------------------

const RING = 0.62;
const CORNICE_H = 0.35;
/** The wing coping's height and its overhang past the wall's faces (`portalOutline.ts`, which the plug's cap reads). */
const COPING_H = WING_COPING_H_M;
const COPING_OVER_M = WING_COPING_OVER_M;
/** The wing walls start this far along their line inside the face wall, so the corner between them is closed. */
const WING_ROOT_M = -0.5;

/** The portal skyline above the track height at |z| across: the face top, then falling at 1 : 1.5 along the wings (the core's). */
export { portalSkylineV } from "./dimensions";

/** A point in model space from the portal frame (s along +X into the tunnel, u to the right along +Z) and a height. */
const fp = (s: number, u: number, y: number): P => v(s, y, u);

/**
 * A tunnel portal at the track height: arched face with pilasters, cornice and parapet, wing walls splayed 30° toward
 * the approach (`portalOutline.ts`) with their copings and end piers, and a dark bore behind. The face wall, the
 * cornice and the wing walls have back faces, so where the ground behind them lies lower (a low hill, a neighbour's
 * cutting) they read as solid masonry from the hill side too; the wall feet never rise above the copings.
 */
export function buildPortal(wingLeftM: number, wingRightM: number, depthM: number, steepLeft = false, steepRight = false): StructureBuilder {
  const sb = new StructureBuilder();
  const bottom = -Math.max(1, depthM);
  const half = PORTAL_HALF_WIDTH_M;
  const ringOut = BORE_HALF_M + RING;
  const corniceBottom = PORTAL_TOP_V - CORNICE_H;
  const n = 11;
  const inner: { z: number; y: number }[] = [];
  const outer: { z: number; y: number }[] = [];
  for (let k = 0; k <= n; k++) {
    const t = Math.PI - (Math.PI * k) / n;
    inner.push({ z: BORE_HALF_M * Math.cos(t), y: BORE_SPRING_V + BORE_HALF_M * Math.sin(t) });
    outer.push({ z: ringOut * Math.cos(t), y: BORE_SPRING_V + ringOut * Math.sin(t) });
  }
  // Face (x = 0, facing −X, out of the hill), and its back (x = PORTAL_WALL_M, facing +X, into the hill).
  const faceQuad = (a: { z: number; y: number }, b: { z: number; y: number }, c: { z: number; y: number }, d: { z: number; y: number }): void => {
    sb.quad(v(0, a.y, a.z), v(0, b.y, b.z), v(0, c.y, c.z), v(0, d.y, d.z), v(0.5, (a.y + c.y) / 2, (a.z + c.z) / 2));
  };
  const backQuad = (a: { z: number; y: number }, b: { z: number; y: number }, c: { z: number; y: number }, d: { z: number; y: number }): void => {
    const x = PORTAL_WALL_M;
    sb.quad(v(x, a.y, a.z), v(x, b.y, b.z), v(x, c.y, c.z), v(x, d.y, d.z), v(x - 0.5, (a.y + c.y) / 2, (a.z + c.z) / 2));
  };
  sb.use("walls", palette.masonry);
  for (const side of [1, -1]) {
    faceQuad({ z: side * BORE_HALF_M, y: bottom }, { z: side * half, y: bottom }, { z: side * half, y: BORE_SPRING_V }, { z: side * BORE_HALF_M, y: BORE_SPRING_V });
    faceQuad({ z: side * ringOut, y: BORE_SPRING_V }, { z: side * half, y: BORE_SPRING_V }, { z: side * half, y: corniceBottom }, { z: side * ringOut, y: corniceBottom });
  }
  faceQuad({ z: -BORE_HALF_M, y: bottom }, { z: BORE_HALF_M, y: bottom }, { z: BORE_HALF_M, y: DECK_V - 0.05 }, { z: -BORE_HALF_M, y: DECK_V - 0.05 });
  const middle = (n - 1) / 2;
  for (let k = 0; k < n; k++) {
    const a = inner[k] as { z: number; y: number };
    const b = inner[k + 1] as { z: number; y: number };
    const c = outer[k + 1] as { z: number; y: number };
    const d = outer[k] as { z: number; y: number };
    if ((k - middle) % 2 === 0) sb.use("trim", palette.masonryLight);
    else shade(sb, "trim", palette.masonryLight, 0.86);
    faceQuad(a, b, c, d);
    sb.use("walls", palette.masonry);
    faceQuad(d, c, { z: c.z, y: corniceBottom }, { z: d.z, y: corniceBottom });
  }
  // The back of the face wall: plain masonry round the bore's opening.
  shade(sb, "walls", palette.masonry, 0.94);
  for (const side of [1, -1]) backQuad({ z: side * BORE_HALF_M, y: bottom }, { z: side * half, y: bottom }, { z: side * half, y: corniceBottom }, { z: side * BORE_HALF_M, y: corniceBottom });
  backQuad({ z: -BORE_HALF_M, y: bottom }, { z: BORE_HALF_M, y: bottom }, { z: BORE_HALF_M, y: DECK_V - 0.05 }, { z: -BORE_HALF_M, y: DECK_V - 0.05 });
  for (let k = 0; k < n; k++) {
    const a = inner[k] as { z: number; y: number };
    const b = inner[k + 1] as { z: number; y: number };
    backQuad(a, b, { z: b.z, y: corniceBottom }, { z: a.z, y: corniceBottom });
  }
  // Where no wing stands, the face wall's end closes it.
  for (const [side, length] of [
    [1, wingRightM],
    [-1, wingLeftM],
  ] as const) {
    if (length > 0.05) continue;
    const z = side * half;
    sb.quad(v(0, bottom, z), v(PORTAL_WALL_M, bottom, z), v(PORTAL_WALL_M, corniceBottom, z), v(0, corniceBottom, z), v(PORTAL_WALL_M / 2, (bottom + corniceBottom) / 2, z - side * 0.5));
  }
  // Pilasters, cornice (its back too), parapet and its coping.
  for (const side of [1, -1]) {
    const z0 = side * (half - 0.8);
    const z1 = side * half;
    shade(sb, "walls", palette.masonry, 1.05);
    sb.bar(-0.14, 0.02, bottom, corniceBottom, Math.min(z0, z1), Math.max(z0, z1), { x1: false, y1: false });
  }
  sb.use("trim", palette.masonryLight).bar(-0.22, CORNICE_BACK_M, corniceBottom, PORTAL_TOP_V, -CORNICE_HALF_M, CORNICE_HALF_M, { y0: true });
  sb.use("walls", palette.masonry).bar(0.05, 0.65, PORTAL_TOP_V, PORTAL_TOP_V + PORTAL_PARAPET_M, -half, half, { y1: false });
  sb.use("trim", palette.masonryLight).bar(-0.01, FACE_COPING_BACK_M, PORTAL_TOP_V + PORTAL_PARAPET_M, FACE_COPING_TOP_V, -FACE_COPING_HALF_M, FACE_COPING_HALF_M, {});
  // The reveal through the face wall, then the dark bore, darker with depth.
  const boreSection = (xa: number, xb: number): void => {
    for (const side of [1, -1]) {
      const z = side * BORE_HALF_M;
      sb.quad(v(xa, DECK_V, z), v(xb, DECK_V, z), v(xb, BORE_SPRING_V, z), v(xa, BORE_SPRING_V, z), v((xa + xb) / 2, 1.5, z + side * 0.4));
    }
    for (let k = 0; k < n; k++) {
      const a = inner[k] as { z: number; y: number };
      const b = inner[k + 1] as { z: number; y: number };
      const my = (a.y + b.y) / 2 - BORE_SPRING_V;
      const mz = (a.z + b.z) / 2;
      const out = 1 + 0.4 / BORE_HALF_M;
      sb.quad(v(xa, a.y, a.z), v(xa, b.y, b.z), v(xb, b.y, b.z), v(xb, a.y, a.z), v((xa + xb) / 2, BORE_SPRING_V + my * out, mz * out));
    }
    sb.quad(v(xa, 0.15, -BORE_HALF_M), v(xb, 0.15, -BORE_HALF_M), v(xb, 0.15, BORE_HALF_M), v(xa, 0.15, BORE_HALF_M), v((xa + xb) / 2, -0.4, 0));
  };
  shade(sb, "walls", palette.masonryDark, 0.9);
  boreSection(0, PORTAL_WALL_M);
  const depths = [0, 1, 2, 3].map((i) => PORTAL_WALL_M + ((BORE_DEPTH_M - PORTAL_WALL_M) * i) / 3);
  for (let i = 0; i + 1 < depths.length; i++) {
    shade(sb, "walls", palette.tunnelMouth, 1 - 0.28 * i);
    boreSection(depths[i] ?? 0, depths[i + 1] ?? 0);
  }
  shade(sb, "walls", palette.tunnelMouth, 0.2);
  const back = BORE_DEPTH_M;
  for (let k = 0; k < n; k++) {
    const a = inner[k] as { z: number; y: number };
    const b = inner[k + 1] as { z: number; y: number };
    sb.triangle(v(back, BORE_SPRING_V, 0), v(back, a.y, a.z), v(back, b.y, b.z), v(back + 0.5, BORE_SPRING_V, 0));
  }
  sb.quad(v(back, 0.15, -BORE_HALF_M), v(back, 0.15, BORE_HALF_M), v(back, BORE_SPRING_V, BORE_HALF_M), v(back, BORE_SPRING_V, -BORE_HALF_M), v(back + 0.5, 1.5, 0));
  // The rails running into the dark.
  shade(sb, "metal", palette.railSide, 0.55);
  for (const z of [-0.817, 0.817]) sb.bar(0, BORE_DEPTH_M * 0.75, 0.29, 0.45, z - 0.055, z + 0.055, { x0: false, x1: false });
  for (const [side, length, steep] of [
    [1, wingRightM, steepRight],
    [-1, wingLeftM, steepLeft],
  ] as const) {
    if (length > 0.05) buildWing(sb, side, length, depthM, steep);
  }
  return sb;
}

/**
 * One splayed wing wall on `side` (+1 right, −1 left) of `lengthM` from the face's edge: front and back faces from the
 * foot (`wallFootV`) to its coping (the skyline, or falling 45° when `steep`: `wingCopingV`), the coping, and the end
 * pier with its cap.
 */
function buildWing(sb: SB, side: 1 | -1, lengthM: number, depthM: number, steep: boolean): void {
  const n = wingBack(side);
  const at = (t: number, behind: number, y: number): P => {
    const w = wingPoint(side, t);
    return fp(w.s + n.s * behind, w.u + n.u * behind, y);
  };
  const ts = breaks(WING_ROOT_M, lengthM, 1.25);
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i] ?? 0;
    const t1 = ts[i + 1] ?? 0;
    const y0 = wingCopingV(t0, steep);
    const y1 = wingCopingV(t1, steep);
    const f0 = wallFootV(y0, depthM);
    const f1 = wallFootV(y1, depthM);
    const tm = (t0 + t1) / 2;
    const ym = (y0 + y1 + f0 + f1) / 4;
    sb.use("walls", palette.masonry);
    sb.quad(at(t0, 0, f0), at(t1, 0, f1), at(t1, 0, y1), at(t0, 0, y0), at(tm, 0.4, ym));
    shade(sb, "walls", palette.masonry, 0.94);
    sb.quad(at(t0, WING_T, f0), at(t1, WING_T, f1), at(t1, WING_T, y1), at(t0, WING_T, y0), at(tm, WING_T - 0.4, ym));
  }
  // The coping along the wall from the face's edge (inside the face wall it would stand in the cornice).
  sb.use("trim", palette.masonryLight);
  const cs = breaks(0, lengthM, 1.25);
  const a = -COPING_OVER_M;
  const b = WING_T + COPING_OVER_M;
  for (let i = 0; i + 1 < cs.length; i++) {
    const t0 = cs[i] ?? 0;
    const t1 = cs[i + 1] ?? 0;
    const y0 = wingCopingV(t0, steep);
    const y1 = wingCopingV(t1, steep);
    sb.hexa([at(t0, a, y0), at(t0, b, y0), at(t1, b, y1), at(t1, a, y1), at(t0, a, y0 + COPING_H), at(t0, b, y0 + COPING_H), at(t1, b, y1 + COPING_H), at(t1, a, y1 + COPING_H)], {
      sides: [i === 0, true, i === cs.length - 2, true],
    });
  }
  // The end pier and its cap, square to the wall.
  const yEnd = wingCopingV(lengthM, steep);
  const foot = Math.min(wallFootV(yEnd, depthM), yEnd - WALL_FOOT_UNDER_SKYLINE_M);
  const [p0, p1] = WING_PIER_ALONG_M;
  const box = (ta: number, tb: number, ca: number, cb: number, ya: number, yb: number, top: boolean): void => {
    sb.hexa([at(ta, ca, ya), at(tb, ca, ya), at(tb, cb, ya), at(ta, cb, ya), at(ta, ca, yb), at(tb, ca, yb), at(tb, cb, yb), at(ta, cb, yb)], { top });
  };
  sb.use("walls", palette.masonry);
  box(lengthM + p0, lengthM + p1, -WING_PIER_PROUD_M, WING_T + WING_PIER_PROUD_M, foot, yEnd + WING_PIER_TOP_V, false);
  sb.use("trim", palette.masonryLight);
  box(lengthM + p0 - COPING_OVER_M, lengthM + p1 + COPING_OVER_M, -WING_PIER_PROUD_M - COPING_OVER_M, WING_T + WING_PIER_PROUD_M + COPING_OVER_M, yEnd + WING_PIER_TOP_V, yEnd + WING_PIER_TOP_V + WING_PIER_CAP_M, true);
}

// ---- Registry --------------------------------------------------------------------------------------------------

function asset(sb: StructureBuilder, footprint: readonly (readonly [number, number])[], budget: number): AssetData {
  return { slots: sb.build(), anchors: {}, footprint, triangleBudget: budget };
}

function rect(x0: number, x1: number, z0: number, z1: number): (readonly [number, number])[] {
  return [
    [x0, z1],
    [x1, z1],
    [x1, z0],
    [x0, z0],
  ];
}

/**
 * Registers the structure kinds. They are cached (one template per variant, disposed with the registry);
 * `StructureView` bends or places copies, so a template is never drawn itself. LOD1 returns LOD0's
 * geometry: structures are few, and their far-band cost was not measured to need a lighter form.
 */
export function registerStructureAssets(registry: AssetRegistry): void {
  registry.register(ARCH_KIND, (variant) => {
    const { lengthM, riseM, solidDepthM } = unpackArch(variant);
    return asset(buildArchSpan(lengthM, riseM, solidDepthM), rect(0, lengthM, -DECK_HALF_M, DECK_HALF_M), STRUCTURE_BUDGETS[ARCH_KIND]);
  });
  registry.register(TRUSS_KIND, (variant) => {
    const lengthM = variant / 10;
    return asset(buildTrussSpan(lengthM), rect(0, lengthM, -DECK_HALF_M, DECK_HALF_M), STRUCTURE_BUDGETS[TRUSS_KIND]);
  });
  registry.register(GIRDER_KIND, (variant) => {
    const lengthM = variant / 10;
    return asset(buildGirderSpan(lengthM), rect(0, lengthM, -DECK_HALF_M, DECK_HALF_M), STRUCTURE_BUDGETS[GIRDER_KIND]);
  });
  registry.register(PIER_KIND, (variant) => {
    const { heightM, wet } = unpackPier(variant);
    const b = PIER_BATTER * heightM + 0.25;
    const t = PIER_THICKNESS_M / 2 + b;
    const w = PIER_HALF_WIDTH_M + b + (wet ? CUTWATER_M : 0);
    return asset(buildPier(heightM, wet), rect(-t, t, -w, w), STRUCTURE_BUDGETS[PIER_KIND]);
  });
  registry.register(ABUTMENT_KIND, (variant) => {
    const depthM = variant / 10;
    return asset(buildAbutment(depthM), rect(-ABUTMENT_BACK_M, PIER_THICKNESS_M / 2, -ABUTMENT_HALF_WIDTH_M, ABUTMENT_HALF_WIDTH_M), STRUCTURE_BUDGETS[ABUTMENT_KIND]);
  });
  registry.register(PORTAL_KIND, (variant) => {
    const { wingLeftM, wingRightM, depthM, steepLeft, steepRight } = unpackPortal(variant);
    // The splayed wings reach forward of the face and out to their end piers (`portalOutline.ts`).
    const reach = (m: number) => (m > 0.05 ? m + (WING_PIER_ALONG_M[1] ?? 0) + COPING_OVER_M : 0);
    const front = Math.max(0.3, PORTAL_WING_SPLAY_SIN * Math.max(reach(wingLeftM), reach(wingRightM)) + WING_PIER_PROUD_M + COPING_OVER_M);
    const across = (m: number) => wingAcross(reach(m)) + PORTAL_WING_SPLAY_SIN * (WING_T + WING_PIER_PROUD_M + COPING_OVER_M);
    return asset(buildPortal(wingLeftM, wingRightM, depthM, steepLeft, steepRight), rect(-front, BORE_DEPTH_M, -across(wingLeftM), across(wingRightM)), STRUCTURE_BUDGETS[PORTAL_KIND]);
  });
}
