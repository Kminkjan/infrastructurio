import { describe, expect, it } from "vitest";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { smoothstep } from "../math";
import type { Terrain } from "../../core/sim/api";
import { type TerrainShading, computeTerrainShading } from "../terrain/terrainShading";
import { EARTHWORK_WEIGHT_FROM_X, encodeEarthworkPotential, lodLattice, lodNodeIndex } from "../terrain/earthworks";
import { BORE_DEPTH_M, BORE_HALF_M, BORE_SPRING_V, PORTAL_HALF_WIDTH_M, PORTAL_TOP_V, portalSkylineV } from "./dimensions";
import { HillPlug, PLUG_LIFT_M, PLUG_UNDER_COPING_M, type PlugGround, type PlugRegion, PlugSurface, type PortalFrame, frameWorld, portalWings } from "./plug";
import {
  BACKFILL_REACH_S_M,
  BACKFILL_REACH_U_M,
  FACE_COPING_BACK_M,
  FACE_COPING_TOP_V,
  OPEN_FRONT_RISE,
  PLUG_START_M,
  backfillV,
  behindFront,
  masonryCapV,
  openFrontDistance,
  retainV,
  wingAcross,
  wingCopingV,
  wingPoint,
} from "./portalOutline";

/** Flat ground `groundDm` over a 60 × 50 node map; a portal facing west at plan (100, 90), its tunnel running east (+x). */
function site(groundDm: number | ((q: number, r: number, col: number, row: number) => number)) {
  const terrain = makeTerrain(60, 50, typeof groundDm === "number" ? () => groundDm : groundDm);
  const shading = computeTerrainShading(terrain);
  const frame: PortalFrame = { x: 100, y: 90, z: 16, tx: 1, ty: 0 };
  return { terrain, shading, frame };
}

/** Plan (x, y) of (s, u) for the site's frame: s = x − 100 into the tunnel, u = 90 − y to its right. */
const at = (s: number, u: number) => ({ x: 100 + s, y: 90 - u });

const region = (sMax = BACKFILL_REACH_S_M + 0.5, extra: Partial<PlugRegion> = {}): PlugRegion => ({ portal: 0, sMin: -10, sMax, uMax: BACKFILL_REACH_U_M + 2, ...extra });

function plugOf(s: ReturnType<typeof site>, ground: PlugGround, wings = { left: 5, right: 5 }, r: PlugRegion = region()): HillPlug {
  return new HillPlug(s.terrain, s.shading, new PlugSurface(s.terrain, [{ frame: s.frame, wings }], ground), r);
}

/** World-space face normal y of triangle t (non-indexed positions): > 0 faces up. */
function faceUp(p: Float32Array, t: number): number {
  const i = 9 * t;
  const ux = (p[i + 3] ?? 0) - (p[i] ?? 0);
  const uz = (p[i + 5] ?? 0) - (p[i + 2] ?? 0);
  const vx = (p[i + 6] ?? 0) - (p[i] ?? 0);
  const vz = (p[i + 8] ?? 0) - (p[i + 2] ?? 0);
  return uz * vx - ux * vz;
}

/** The plug's outline: every vertex on an edge that only one triangle uses, as plan (x, y) and height. */
function outline(d: { positions: Float32Array; triangleCount: number }): { x: number; y: number; z: number }[] {
  const key = (v: number) => `${(d.positions[3 * v] ?? 0).toFixed(4)},${(d.positions[3 * v + 2] ?? 0).toFixed(4)}`;
  const uses = new Map<string, number>();
  const edge = (a: number, b: number) => [key(a), key(b)].sort().join("|");
  const pairs = [
    [0, 1],
    [1, 2],
    [2, 0],
  ] as const;
  for (let t = 0; t < d.triangleCount; t++) for (const [a, b] of pairs) uses.set(edge(3 * t + a, 3 * t + b), (uses.get(edge(3 * t + a, 3 * t + b)) ?? 0) + 1);
  const out: { x: number; y: number; z: number }[] = [];
  for (let t = 0; t < d.triangleCount; t++) {
    for (const [a, b] of pairs) {
      if (uses.get(edge(3 * t + a, 3 * t + b)) !== 1) continue;
      for (const v of [3 * t + a, 3 * t + b]) out.push({ x: d.positions[3 * v] ?? 0, y: -(d.positions[3 * v + 2] ?? 0), z: d.positions[3 * v + 1] ?? 0 });
    }
  }
  return out;
}

/** The terrain's baked colour at plan (x, y): the node colours, barycentric in the LOD0 triangle holding it. */
function bakedColour(t: Terrain, lat: ReturnType<typeof lodLattice>, shading: TerrainShading, x: number, y: number, axis: number): number {
  const a = lat.spacingM;
  const rf = y / (a * (Math.sqrt(3) / 2));
  const qf = x / a - rf / 2;
  const Q = Math.floor(qf + 1e-9);
  const R = Math.floor(rf + 1e-9);
  const fq = qf - Q;
  const fr = rf - R;
  const c = (q: number, r: number) => shading.colors[3 * lodNodeIndex(t, lat, q, r) + axis] ?? 0;
  if (fq + fr <= 1 + 1e-9) return (1 - fq - fr) * c(Q, R) + fq * c(Q + 1, R) + fr * c(Q, R + 1);
  return (1 - fr) * c(Q + 1, R) + (1 - fq) * c(Q, R + 1) + (fq + fr - 1) * c(Q + 1, R + 1);
}

/** A 45° headwall notch from the track bed behind the face (the terrain mesh's underlay), across |u| < 10 m. */
function underlay(frame: PortalFrame, natural: (x: number, y: number) => number) {
  return (x: number, y: number) => {
    const s = x - frame.x;
    const u = frame.y - y;
    const n = natural(x, y);
    return s > 0 && Math.abs(u) < 10 ? Math.min(n, frame.z + Math.max(0, Math.abs(u) - 3) / 1.5 + s) : n;
  };
}

/**
 * A drawn-ground function as the terrain mesh draws it: linear in each 1.25 m sub-lattice triangle (the plug meets it
 * there along its contour, `HillPlug`), so a step in a test's stub reads as the ramp the mesh draws.
 */
function meshed(drawn: (x: number, y: number) => number): (x: number, y: number) => number {
  const sub = 5 / 4;
  const row = sub * (Math.sqrt(3) / 2);
  const at = (qs: number, rs: number) => drawn(sub * (qs + rs / 2), row * rs);
  return (x, y) => {
    const rf = y / row;
    const qf = x / sub - rf / 2;
    const Q = Math.floor(qf + 1e-9);
    const R = Math.floor(rf + 1e-9);
    const fq = qf - Q;
    const fr = rf - R;
    if (fq + fr <= 1) return (1 - fq - fr) * at(Q, R) + fq * at(Q + 1, R) + fr * at(Q, R + 1);
    return (fq + fr - 1) * at(Q + 1, R + 1) + (1 - fq) * at(Q, R + 1) + (1 - fr) * at(Q + 1, R);
  };
}

describe("hill plug", () => {
  it("draws the hill the portal retains over the underlay's notch, exactly the natural ground and shaded as it", () => {
    // The hill stands 12 m over the track (28 m); the core's effective ground behind the face is the natural hill.
    const s = site(280);
    const natural = () => 28;
    const drawnM = underlay(s.frame, natural);
    const plug = plugOf(s, { drawnM, effectiveM: natural });
    const d = plug.data;
    expect(d.triangleCount).toBeGreaterThan(100);
    // Over the notch the plug is the hill itself (plus the lift); where the underlay is the hill, nothing is drawn.
    for (const [ss, u] of [
      [4, 3],
      [8, -6],
      [10, 2],
    ] as const) {
      const p = at(ss, u);
      expect(plug.heightAt(p.x, p.y), `s ${ss} u ${u}`).toBeCloseTo(28 + PLUG_LIFT_M, 9);
    }
    // Right behind the face it never stands over the parapet coping, rising 2 : 1 behind its back edge (verification
    // fix 2026-09-29: this stub's hill is a 12 m cliff at the face plane; the core's retained hill rises 45° from 0.25 m
    // over the face top, so there the cap takes at most 0.24 m off it). Before, it stood 3.4 m over the coping here.
    const behind = at(1, 0);
    expect(plug.heightAt(behind.x, behind.y)).toBeCloseTo(s.frame.z + masonryCapV(1, 0, { left: 5, right: 5 }), 9);
    expect(masonryCapV(1, 0, { left: 5, right: 5 })).toBeCloseTo(FACE_COPING_TOP_V - 0.02 + 2 * (1 - 0.71), 9);
    expect(Number.isNaN(plug.heightAt(at(16, 0).x, at(16, 0).y))).toBe(true);
    expect(Number.isNaN(plug.heightAt(at(-2, 0).x, at(-2, 0).y))).toBe(true);
    // Beyond the cap's reach (and its neighbours') every vertex is the natural ground: the terrain's own normal (flat:
    // straight up), its baked colour (barycentric in its lattice triangle, as the terrain mesh interpolates it), and no
    // lip weight. Nearer the masonry every vertex is the cap exactly.
    const lat = lodLattice(s.terrain, 0);
    const wings5 = { left: 5, right: 5 };
    const capAt = (x: number, y: number) => s.frame.z + masonryCapV(x - s.frame.x, s.frame.y - y, wings5);
    let capped = 0;
    for (let v = 0; v < 3 * d.triangleCount; v++) {
      const vx = d.positions[3 * v] ?? 0;
      const vy = -(d.positions[3 * v + 2] ?? 0);
      // The cap under the hill at the vertex, or within two sub-lattice steps (a clipped vertex interpolates two
      // lattice vertices, whose normals read their neighbours).
      let near = capAt(vx, vy);
      for (const r of [1.26, 2.52]) for (let k = 0; k < 12; k++) near = Math.min(near, capAt(vx + r * Math.cos((k * Math.PI) / 6), vy + r * Math.sin((k * Math.PI) / 6)));
      if (near < 28 + PLUG_LIFT_M) {
        const cap = capAt(vx, vy);
        // Either on the plug's surface (the hill, the cap under it, or the open front's bank), or on the drawn ground
        // as the terrain mesh draws it, where the plug comes down to it (its contour).
        // (The lift fades out as the plug comes down to the ground: `PLUG_LIFT_M`.)
        const pz = d.positions[3 * v + 1] ?? 0;
        const ground = meshed(drawnM)(vx, vy);
        const top = plug.surface.sample(vx, vy, 28, { v: 0, d: 0, e: 0, n: 0, f: 0, t: 0 }).t;
        const onGround = Math.abs(pz - ground) <= 1e-4;
        if (!onGround) expect(pz, `vertex ${v}`).toBeCloseTo(top + PLUG_LIFT_M * smoothstep(0, PLUG_LIFT_M, top - ground), 4);
        if (!onGround) expect(top).toBeLessThanOrEqual(Math.min(28, cap - PLUG_LIFT_M) + 1e-9);
        if (cap < 28 + PLUG_LIFT_M && !onGround && Math.abs(pz - cap) < 1e-4) capped += 1;
        continue;
      }
      // (Lifted over the notch; on the ground itself at its rim, where the lift fades out.)
      expect(d.positions[3 * v + 1]).toBeCloseTo(28 + PLUG_LIFT_M * smoothstep(0, PLUG_LIFT_M, 28 - meshed(drawnM)(vx, vy)), 3);
      expect(d.normals[3 * v + 1], `vertex ${v}`).toBeCloseTo(1, 6);
      expect(d.earthwork[3 * v]).toBe(0);
      const x = d.positions[3 * v] ?? 0;
      const y = -(d.positions[3 * v + 2] ?? 0);
      for (let axis = 0; axis < 3; axis++) expect(d.colors[3 * v + axis], `vertex ${v}`).toBeCloseTo(bakedColour(s.terrain, lat, s.shading, x, y, axis), 5);
    }
    expect(capped).toBeGreaterThan(20);
    for (let t = 0; t < d.triangleCount; t++) expect(faceUp(d.positions, t)).toBeGreaterThan(0);
  });

  it("keeps its normals steady along the face behind the masonry, where its neighbours lie on the cutting: no sawtooth (D4 portal wedges)", () => {
    // A flat hill 8.5 m over the track (the ew75 east portal's): the approach's cutting in front of the face, the
    // underlay's notch behind it, and the core's retained hill (natural here, trimmed 45° above the retained skyline).
    // Along the face the surface is the same at every u, so the plug's normals must be too; they alternated with the
    // lattice where a vertex's six neighbours reached across the face into the cutting 8 m below (verification finding
    // 2026-09-29, the "ew75 east teeth").
    const s = site(245);
    const n = 24.5;
    const z = s.frame.z;
    const cut = (u: number) => Math.min(n, z + Math.max(0, Math.abs(u) - 3) / 1.5);
    const drawnM = (x: number, y: number) => {
      const ss = x - s.frame.x;
      const u = s.frame.y - y;
      return ss <= 0 ? cut(u) : Math.abs(u) < 10 ? Math.min(n, z + Math.max(0, Math.abs(u) - 3) / 1.5 + ss) : n;
    };
    const effectiveM = (x: number, y: number) => {
      const ss = x - s.frame.x;
      const u = s.frame.y - y;
      return ss <= 0 ? cut(u) : Math.min(n, z + retainV(Math.abs(u)) + ss);
    };
    const plug = plugOf(s, { drawnM, effectiveM });
    const d = plug.data;
    // Behind the wall's back (1.2–2.4 m behind the face plane) the surface is the flat hill (the cap under the coping
    // meets it 0.92 m behind): the plug's normals there stand near vertical, the same along the face at every u.
    let worst = 0;
    let count = 0;
    for (let v = 0; v < 3 * d.triangleCount; v++) {
      const ss = (d.positions[3 * v] ?? 0) - s.frame.x;
      const u = s.frame.y + (d.positions[3 * v + 2] ?? 0);
      if (ss < 1.2 || ss > 2.4 || Math.abs(u) > 3) continue;
      count += 1;
      worst = Math.max(worst, Math.hypot(d.normals[3 * v] ?? 0, d.normals[3 * v + 2] ?? 0));
    }
    expect(count).toBeGreaterThan(10);
    // (With the whole six-neighbour stencil the first two rows leaned up to 0.92, toward the cutting.)
    expect(worst).toBeLessThan(0.2);
  });

  it("closes a low portal with the compact backfill: the face top over the face and the bore, then 1 : 1.5 down to the hill", () => {
    // The hill stands only 4 m over the track (20 m); no notch.
    const s = site(200);
    const plug = plugOf(s, {});
    const top = s.frame.z + PORTAL_TOP_V + PLUG_UNDER_COPING_M + PLUG_LIFT_M;
    const h = (ss: number, u: number) => plug.heightAt(at(ss, u).x, at(ss, u).y);
    // The retained skyline for a metre behind the face, across the face's width, and over the bore to its drawn depth.
    expect(h(PLUG_START_M + 0.1, 0)).toBeCloseTo(top, 9);
    expect(h(1, PORTAL_HALF_WIDTH_M - 0.1)).toBeCloseTo(top, 9);
    expect(h(BORE_DEPTH_M, 0)).toBeCloseTo(top, 9);
    // Then falling at 1 : 1.5 to the natural ground behind, and beside the face along the wings' coping line.
    expect(h(BORE_DEPTH_M + 1.5, 0)).toBeCloseTo(top - 1, 9);
    expect(h(1, PORTAL_HALF_WIDTH_M + 3)).toBeCloseTo(s.frame.z + retainV(PORTAL_HALF_WIDTH_M + 3) + PLUG_LIFT_M, 9);
    expect(Number.isNaN(h(15, 0))).toBe(true);
    // Beyond the face width it never stands over its own wing's coping; the arch ring (radius 3.22 m about the
    // springing) keeps at least 0.5 m of cover over the bore's drawn depth.
    let checked = 0;
    for (let ss = PLUG_START_M; ss <= 16; ss += 0.25) {
      for (let u = -16; u <= 16; u += 0.25) {
        const v = h(ss, u);
        if (Number.isNaN(v)) continue;
        checked += 1;
        const au = Math.abs(u);
        if (au > PORTAL_HALF_WIDTH_M) {
          // Never above its own wing's coping (5 m wings): the coping's top at the wing's nearest point.
          const along = -0.5 * ss + (Math.sqrt(3) / 2) * (au - PORTAL_HALF_WIDTH_M);
          const t = Math.min(5.6, Math.max(0, along));
          expect(v - PLUG_LIFT_M, `s ${ss} u ${u}`).toBeLessThanOrEqual(s.frame.z + portalSkylineV(wingAcross(t)) + 0.28 + 1e-9);
        }
        const ring = BORE_HALF_M + 0.62;
        if (ss <= BORE_DEPTH_M && au < ring) expect(v - PLUG_LIFT_M, `arch s ${ss} u ${u}`).toBeGreaterThanOrEqual(s.frame.z + BORE_SPRING_V + Math.sqrt(ring * ring - au * au) + 0.5);
      }
    }
    expect(checked).toBeGreaterThan(300);
    // Made ground reads as an embankment: its attribute is the fill's potential (3.65 m of fill over the hill at most:
    // the lip and the earthwork weight in full), its departure is never negative (no bare cut face), and its outline is
    // the fill's toe, with the potential of the daylight line there (since the plug ends along its toe, verification
    // fix 2026-09-29; before, sub-triangles kept past the toe carried less, down to 0 on the natural ground).
    const attr = (v: number, k: number) => plug.data.earthwork[3 * v + k] ?? 0;
    const n = 3 * plug.data.triangleCount;
    const xs = Array.from({ length: n }, (_, v) => attr(v, 0));
    expect(Math.max(...xs)).toBeCloseTo(encodeEarthworkPotential(PORTAL_TOP_V + PLUG_UNDER_COPING_M - 4), 5);
    expect(Math.max(...xs)).toBeGreaterThan(EARTHWORK_WEIGHT_FROM_X);
    expect(Math.min(...xs)).toBeCloseTo(encodeEarthworkPotential(0), 3);
    for (let v = 0; v < n; v++) expect(attr(v, 1)).toBeGreaterThanOrEqual(0);
    expect(plug.maxZ).toBeCloseTo(top, 6);
  });

  it("ends along its contour with the drawn ground, with the terrain's own look there: no staircase (verification fix 2026-09-29)", () => {
    // A low portal on flat ground 4 m over the track: the backfill's 1 : 1.5 falls meet the ground in oblique lines.
    const s = site(200);
    const wings = { left: 5, right: 5 };
    const plug = plugOf(s, {}, wings);
    const surface = plug.surface;
    const sample = { v: 0, d: 0, e: 0, n: 0, f: 0, t: 0 };
    const d = plug.data;
    const key = (x: number, y: number) => `${x.toFixed(4)},${y.toFixed(4)}`;
    const open = new Set(outline(d).filter((p) => {
      const ss = p.x - s.frame.x;
      const u = s.frame.y - p.y;
      return !(behindFront(ss, u) < 1e-3 && (Math.abs(u) <= PORTAL_HALF_WIDTH_M + 0.2 || Math.abs(u) <= wingAcross(5.6) + 0.35));
    }).map((p) => key(p.x, p.y)));
    expect(open.size).toBeGreaterThan(40);
    let worstRise = 0;
    const rises: number[] = [];
    let worstNormal = 0;
    let worstLip = 0;
    for (let v = 0; v < 3 * d.triangleCount; v++) {
      const x = d.positions[3 * v] ?? 0;
      const y = -(d.positions[3 * v + 2] ?? 0);
      if (!open.has(key(x, y))) continue;
      // On the toe where the backfill meets the ground (f = D): before, whole sub-triangles past it were kept wherever
      // a corner rose, and the outline ran along their edges, up to a metre of fill short of the ground.
      surface.sample(x, y, surface.naturalAt(x, y), sample);
      // (Where the fill is defined; past the open front and the walls' lines it is not.)
      if (Number.isFinite(sample.f)) {
        worstRise = Math.max(worstRise, Math.abs(sample.f - sample.d));
        rises.push(Math.abs(sample.f - sample.d));
      }
      // The flat natural ground's own normal (straight up), and the potential of the fill's daylight line, so the
      // relief's facets fade out along the toe itself (from a metre outside it), as on the terrain's own banks.
      worstNormal = Math.max(worstNormal, 1 - (d.normals[3 * v + 1] ?? 0));
      if (Number.isFinite(sample.f)) worstLip = Math.max(worstLip, Math.abs((d.earthwork[3 * v] ?? 0) - encodeEarthworkPotential(0)));
    }
    rises.sort((a, b) => a - b);
    // Linear along each sub-triangle edge, the clip lands on the toe to within the fill's kinks (before this fix,
    // 2026-09-29, automated: median 0.43 m, 90th percentile 0.90 m, most 1.09 m short of the ground).
    expect(rises[Math.floor(rises.length / 2)]).toBeLessThan(0.01);
    expect(rises[Math.floor(rises.length * 0.9)]).toBeLessThan(0.15);
    expect(worstRise).toBeLessThan(0.3);
    expect(worstNormal).toBeLessThan(1e-6);
    expect(worstLip).toBeLessThan(0.05);
    // The clipped cells keep their winding: every triangle faces up.
    for (let t = 0; t < d.triangleCount; t++) expect(faceUp(d.positions, t)).toBeGreaterThan(0);
  });

  it("never floats its front edge over the masonry it abuts: under the face coping and each wing coping (verification fix 2026-09-29)", () => {
    // A hill 12 m over the track, retained as the core retains it: 0.25 m over the face top at the face plane (falling
    // 1 : 1.5 beyond the face's width), rising 45° behind it; the underlay notch under it.
    const s = site(280);
    const z = s.frame.z;
    const effectiveM = (x: number, y: number) => {
      const ss = x - s.frame.x;
      return ss > 0 ? Math.min(28, z + retainV(Math.abs(s.frame.y - y)) + ss) : 28;
    };
    const wings = { left: 5, right: 5 };
    const plug = plugOf(s, { drawnM: underlay(s.frame, () => 28), effectiveM }, wings);
    const h = (ss: number, u: number) => plug.heightAt(at(ss, u).x, at(ss, u).y);
    // Along the face coping's back edge the retained hill stood 0.24 m over its top (0.17 m at the plug's front line),
    // so rays passed under the plug's edge to the bore's dark back: the black sliver.
    let face = 0;
    for (let u = -4.2; u <= 4.2; u += 0.1) {
      const v = h(FACE_COPING_BACK_M, u);
      if (Number.isNaN(v)) continue;
      face += 1;
      expect(v, `u ${u}`).toBeLessThanOrEqual(z + FACE_COPING_TOP_V - 0.02 + 1e-9);
      expect(effectiveM(at(FACE_COPING_BACK_M, u).x, at(FACE_COPING_BACK_M, u).y)).toBeGreaterThan(z + FACE_COPING_TOP_V);
    }
    expect(face).toBeGreaterThan(60);
    // Along each wing's back edge (its coping's), from its root out: never over the coping's top (the corner where the
    // face meets the wing stood up to 0.8 m over it: the black notch).
    let wing = 0;
    for (const side of [1, -1] as const) {
      const n = { s: Math.sqrt(3) / 2, u: side * 0.5 };
      for (let t = 0; t <= 5; t += 0.25) {
        const w = wingPoint(side, t);
        const back = 0.8 + 0.06;
        const v = h(w.s + n.s * back, w.u + n.u * back);
        if (Number.isNaN(v)) continue;
        wing += 1;
        expect(v, `side ${side} t ${t}`).toBeLessThanOrEqual(z + wingCopingV(t) + 0.28 - 0.02 + 1e-9);
      }
    }
    expect(wing).toBeGreaterThan(8);
    // A metre and more behind the coping the plug is the retained hill again.
    expect(h(2, 0)).toBeCloseTo(effectiveM(at(2, 0).x, at(2, 0).y) + PLUG_LIFT_M, 9);
  });

  it("meets the drawn ground along its whole outline except inside the masonry: no tear, no fade band", () => {
    // A low portal on flat ground 4 m over the track, with a neighbour's 6 m-deep cutting across the plug (8–14 m right).
    const s = site(200);
    // Drawn as the terrain mesh draws it (linear in each 1.25 m sub-triangle, as the app's drawn heightfield is): the
    // plug ends along its contour with it (verification fix 2026-09-29).
    const cutting = meshed((_x: number, y: number) => (90 - y > 8 && 90 - y < 14 ? 14 : 20));
    for (const wings of [
      { left: 5, right: 5 },
      { left: 0, right: 2.5 },
    ]) {
      const plug = plugOf(s, { drawnM: cutting }, wings);
      const edge = outline(plug.data);
      expect(edge.length).toBeGreaterThan(20);
      let worst = 0;
      let open = 0;
      for (const p of edge) {
        const ss = p.x - s.frame.x;
        const u = s.frame.y - p.y;
        // The front edge inside the face wall and along the wings, to the far side of their end piers (the front line
        // lies 0.6 m behind the walls' fronts, so 0.3 m further out across), is in the masonry.
        const wing = u >= 0 ? wings.right : wings.left;
        // (Positions are float32: 1e-3 m of slack at the wall line.)
        const inWall = behindFront(ss, u) < 1e-3 && (Math.abs(u) <= PORTAL_HALF_WIDTH_M + 0.2 || (wing > 0.05 && Math.abs(u) <= wingAcross(wing + 0.6) + 0.35));
        if (inWall) continue;
        open += 1;
        // (On the ground itself: the lift fades out there.)
        worst = Math.max(worst, Math.abs(p.z - cutting(p.x, p.y)));
      }
      expect(open).toBeGreaterThan(20);
      expect(worst, JSON.stringify(wings)).toBeLessThan(0.01 + 1e-6);
    }
  });

  it("stays under another track's cut envelope: the backfill never covers a neighbour's formation or its side slopes", () => {
    const s = site(200);
    // A neighbour 11 m right of the bore in a cutting at 14 m: its formation to 3 m, then 1 : 1.5 up to the ground.
    const cut = (_x: number, y: number) => 14 + Math.max(0, Math.abs(90 - y - 11) - 3) / 1.5;
    const drawn = (x: number, y: number) => Math.min(20, cut(x, y));
    const plug = plugOf(s, { drawnM: drawn, cutM: cut });
    let over = 0;
    for (let ss = 0.7; ss < 16; ss += 0.25) {
      for (let u = -16; u < 16; u += 0.25) {
        const p = at(ss, u);
        const h = plug.heightAt(p.x, p.y);
        if (!Number.isNaN(h)) over = Math.max(over, h - PLUG_LIFT_M - cut(p.x, p.y));
      }
    }
    expect(over).toBeLessThanOrEqual(1e-9);
    // On the neighbour's formation the plug draws nothing: the cutting is the surface there.
    expect(Number.isNaN(plug.heightAt(at(2, 11).x, at(2, 11).y))).toBe(true);
  });

  it("splits a short two-portal tunnel at its middle with an exact seam, and keeps both bores covered", () => {
    for (const lengthM of [5, 10, 20]) {
      const s = site(200);
      const a: PortalFrame = s.frame;
      const b: PortalFrame = { x: 100 + lengthM, y: 90, z: 16, tx: -1, ty: 0 };
      const surface = new PlugSurface(s.terrain, [
        { frame: a, wings: { left: 5, right: 5 } },
        { frame: b, wings: { left: 5, right: 5 } },
      ]);
      const mid = { x: 100 + lengthM / 2, y: 90, tx: 1, ty: 0 };
      const plugs = [
        new HillPlug(s.terrain, s.shading, surface, region(lengthM, { portal: 0, split: mid })),
        new HillPlug(s.terrain, s.shading, surface, region(lengthM, { portal: 1, split: { ...mid, tx: -1 } })),
      ];
      // Vertices on the middle line, from each side: the same points at the same heights.
      const seam = (p: HillPlug) => {
        const out = new Map<string, number>();
        for (let v = 0; v < 3 * p.data.triangleCount; v++) {
          const x = p.data.positions[3 * v] ?? 0;
          if (Math.abs(x - mid.x) > 1e-6) continue;
          out.set((-(p.data.positions[3 * v + 2] ?? 0)).toFixed(6), p.data.positions[3 * v + 1] ?? 0);
        }
        return out;
      };
      const [sa, sb] = plugs.map(seam) as [Map<string, number>, Map<string, number>];
      // (At 20 m the backfill has fallen to the hill by the middle: since the plug ends along its toe (verification fix
      // 2026-09-29) no vertex lies on the middle line; before, a few of the sub-triangles kept past the toe did.)
      expect(sa.size, `${lengthM} m`).toBeGreaterThanOrEqual(lengthM < 20 ? 6 : 0);
      expect([...sa.keys()].sort()).toEqual([...sb.keys()].sort());
      for (const [y, z] of sa) expect(sb.get(y), `${lengthM} m at y ${y}`).toBe(z);
      // Each plug stays on its side; over each bore's drawn depth the arch keeps its cover.
      for (const [i, p] of plugs.entries()) {
        const f = i === 0 ? a : b;
        for (let v = 0; v < 3 * p.data.triangleCount; v++) expect(((p.data.positions[3 * v] ?? 0) - mid.x) * (i === 0 ? 1 : -1)).toBeLessThanOrEqual(1e-6);
        for (let ss = PLUG_START_M + 0.01; ss <= Math.min(BORE_DEPTH_M, lengthM - PLUG_START_M); ss += 0.25) {
          const x = f.x + f.tx * ss;
          const h = Math.max(...plugs.map((q) => q.heightAt(x, 90)).filter((v) => !Number.isNaN(v)));
          expect(h, `${lengthM} m, s ${ss}`).toBeGreaterThanOrEqual(f.z + BORE_SPRING_V + BORE_HALF_M + 0.62 + 0.5);
        }
      }
    }
  });

  it("meets the ground as a bank beyond a wing stopped short, where the core retains a step at the face plane", () => {
    // A deep hill (28 m, 12 m over the track) and a ground approach in its cutting: in front of the face plane the
    // cutting, behind it the terrain mesh's underlay (the 45° headwall from the section) and the core's effective
    // ground (the hill retained up to the skyline, then 45°). The left wing was stopped 1 m out by another track.
    const s = site(280);
    const z = s.frame.z;
    const section = (u: number) => z + Math.max(0, Math.abs(u) - 4) / 1.5;
    // (Drawn as the terrain mesh draws it: linear in each sub-triangle, as the app's drawn heightfield is.)
    const cutting = meshed((x: number, y: number) => {
      const ss = x - 100;
      const u = 90 - y;
      return ss <= 0 ? Math.min(28, section(u)) : Math.min(28, section(u) + ss);
    });
    const effective = (x: number, y: number) => {
      const ss = x - 100;
      const u = 90 - y;
      return ss <= 0 ? Math.min(28, section(u)) : Math.min(28, Math.max(section(u), z + retainV(Math.abs(u))) + ss);
    };
    const wings = { left: 1, right: 6.5 };
    const plug = plugOf(s, { drawnM: cutting, effectiveM: effective }, wings);
    // Beyond the left end pier, across the face plane: no step steeper than the 45° bank or the 45° headwall.
    const u = -(wingAcross(1 + 0.6) + 1.5);
    let worst = 0;
    let prev = Number.NaN;
    for (let ss = -4; ss <= 6; ss += 0.25) {
      const p = at(ss, u);
      const h = plug.heightAt(p.x, p.y);
      const v = Number.isNaN(h) ? cutting(p.x, p.y) : h - PLUG_LIFT_M;
      if (!Number.isNaN(prev)) worst = Math.max(worst, Math.abs(v - prev));
      prev = v;
    }
    expect(worst).toBeLessThan(0.26);
    // And the plug's outline meets the drawn ground away from the masonry.
    let open = 0;
    let far = 0;
    for (const p of outline(plug.data)) {
      const ss = p.x - 100;
      const pu = 90 - p.y;
      const wing = pu >= 0 ? wings.right : wings.left;
      if (behindFront(ss, pu) < 1e-3 && (Math.abs(pu) <= PORTAL_HALF_WIDTH_M + 0.2 || Math.abs(pu) <= wingAcross(wing + 0.6) + 0.35)) continue;
      open += 1;
      far = Math.max(far, Math.abs(p.z - cutting(p.x, p.y)));
    }
    expect(open).toBeGreaterThan(10);
    expect(far).toBeLessThan(0.01 + 1e-6);
  });

  it("fills behind a splayed wing up to its coping, in front of the face plane", () => {
    const s = site(200);
    const plug = plugOf(s, {}, { left: 6, right: 6 });
    // Halfway along the right wing, just behind its back face: the wing's retained skyline.
    const w = wingPoint(1, 3);
    const behind = frameWorld(s.frame, w.s + 0.866 * 1.2, w.u + 0.5 * 1.2);
    const u = 90 - behind.y;
    expect(behind.x).toBeLessThan(100);
    expect(plug.heightAt(behind.x, behind.y) - PLUG_LIFT_M).toBeCloseTo(s.frame.z + backfillV(behind.x - 100, u, { left: 6, right: 6 }), 9);
    // Behind the wall's back face (0.8 m) the berm stands at the wing's own retained skyline: over the wall's top, under its coping.
    for (const t of [0.5, 1.5, 3, 4.5, 6]) {
      const w = wingPoint(1, t);
      for (const d of [0.8, 0.9, 1]) {
        const p = frameWorld(s.frame, w.s + 0.866 * d, w.u + 0.5 * d);
        const h = plug.heightAt(p.x, p.y) - PLUG_LIFT_M;
        expect(h, `t ${t} behind ${d}`).toBeGreaterThan(s.frame.z + portalSkylineV(wingAcross(t)) + 0.2);
        expect(h, `t ${t} behind ${d}`).toBeLessThanOrEqual(s.frame.z + portalSkylineV(wingAcross(t)) + 0.28);
      }
    }
    // In front of the wing (the approach's side) the plug draws nothing.
    const front = frameWorld(s.frame, w.s - 0.866 * 0.5, w.u - 0.5 * 0.5);
    expect(Number.isNaN(plug.heightAt(front.x, front.y))).toBe(true);
  });
});

describe("portal wings", () => {
  it("stop where the hill they retain stands less than 0.3 m over the ground in front", () => {
    const { terrain, frame } = site(200);
    // Flat ground 4 m over the track, a ground approach in its cutting: the wing retains the hill until the cutting's
    // side slope rises to within 0.3 m of it, the same |u| on both sides.
    const cut = portalWings(terrain, frame, "ground");
    expect(cut.left).toBeCloseTo(cut.right, 9);
    const u = wingAcross(cut.left);
    // The cutting (3 m formation, 2 m ease, 1 : 1.5) reaches 4 − 0.3 m at 3 + 1 + 1.5 · 3.7 m.
    expect(u).toBeGreaterThan(9.3);
    expect(u).toBeLessThan(9.9);
    // A neighbour's formation across the right wing stops it short; the other runs on.
    const blocked = portalWings(terrain, frame, "ground", undefined, (_x, y) => 90 - y > 6 && 90 - y < 12);
    expect(wingAcross(blocked.right)).toBeLessThanOrEqual(6 + 0.3);
    expect(blocked.left).toBeCloseTo(cut.left, 9);
    // A neighbour's cutting that lowers the ground in front never draws a wing out beyond the portal's own section.
    expect(portalWings(terrain, frame, "ground", () => 10).left).toBeCloseTo(cut.left, 9);
    // A hill a neighbour's cutting took away is not retained: the wing stops at once.
    expect(portalWings(terrain, frame, "ground", undefined, undefined, () => frame.z).left).toBe(0);
  });

  it("keeps the downhill wing short on a side slope, where the old rule ran it 23 m", () => {
    // Ground falling 0.5 m per metre toward the south (the portal's right): 20 m at the node, the track 6 m under it.
    const { terrain, frame } = site((_q, _r, _col, row) => Math.round(200 + (row * 2.5 * Math.sqrt(3) - 90) * 5));
    const f = { ...frame, z: 14 };
    const wings = portalWings(terrain, f, "ground");
    expect(wings.right).toBeGreaterThan(1);
    expect(wings.right).toBeLessThan(6);
    // The downhill wing holds the face's fill as a steep wall down the bank; the uphill one retains the cutting.
    expect([wings.steepLeft, wings.steepRight]).toEqual([false, true]);
    // Uphill the cutting deepens: that wing retains the hill until the coping meets the cut.
    expect(wings.left).toBeGreaterThan(wings.right);
    expect(wings.left).toBeLessThan(8);
  });

  it("turn steep where a wing on the skyline could not back a low face: the coping follows the bank down to the ground", () => {
    // Flat ground 2 m over the track: the cutting daylights 6.5 m out, where a wing on the 1 : 1.5 skyline would stop,
    // but the face's edge needs 5.65 m of fill behind it, which a 45° bank from there cannot give.
    const { terrain, frame } = site(180);
    const wings = portalWings(terrain, frame, "ground");
    expect([wings.steepLeft, wings.steepRight]).toEqual([true, true]);
    expect(wings.left).toBeCloseTo(wings.right, 9);
    // It runs until its 45° coping stands within 0.3 m of the ground in front (2 m): 7.4 − t = 2.3.
    expect(PORTAL_TOP_V - wings.right).toBeLessThan(2 + 0.3 + 0.25);
    expect(PORTAL_TOP_V - (wings.right - 0.25)).toBeGreaterThanOrEqual(2 + 0.3);
    // So the face's edge is backed: the bank from the open front beyond it reaches the retained skyline there.
    const need = PORTAL_TOP_V + PLUG_UNDER_COPING_M - 2;
    expect(openFrontDistance(1, wings.right, 1, PORTAL_HALF_WIDTH_M) * OPEN_FRONT_RISE).toBeGreaterThanOrEqual(need);
    // And the plug's fill behind the steep wing stands just under its coping all along it: its back never shows.
    const s = site(180);
    const plug = plugOf(s, {}, wings);
    for (let t = 0.5; t < wings.right; t += 0.5) {
      const w = wingPoint(1, t);
      const p = frameWorld(s.frame, w.s + 0.866 * 0.85, w.u + 0.5 * 0.85);
      const h = plug.heightAt(p.x, p.y) - PLUG_LIFT_M;
      expect(h, `t ${t}`).toBeGreaterThan(s.frame.z + wingCopingV(t, true) + 0.2);
      expect(h, `t ${t}`).toBeLessThanOrEqual(s.frame.z + wingCopingV(t, true) + 0.28);
    }
  });
});
