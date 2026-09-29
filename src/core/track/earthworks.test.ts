import { describe, expect, it } from "vitest";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { simOn } from "../../../tests/support/simOn";
import type { PieceSpec } from "../geometry/piece";
import {
  type ClipPlane,
  DAYLIGHT_ROUND_M,
  type EarthworkPiece,
  type Envelope,
  HEADWALL_RISE,
  NO_PLANES,
  PORTAL_V_ACROSS_M,
  PORTAL_V_BOTTOM_V,
  bedAt,
  conformRule,
  conformedHeightM,
  envelopeAt,
  naturalHeightAtM,
  nearestOnPiece,
  slopeRiseM,
  withPlanes,
} from "./earthworks";
import { PORTAL_DAYLIGHT_ROUND_M, PORTAL_HALF_WIDTH_M, PORTAL_RETAIN_ABOVE_TOP_M, PORTAL_TOP_V, PORTAL_WING_RUN, portalRetainV, portalSkylineV } from "./portal";

/**
 * The clip planes' tunnel flag and the retain rule (D4 second feel-check fixes, 2026-09-28): past a tunnel end's
 * plane, in "ground" mode, the cut envelope starts at the portal's retained skyline; bridge and buffer planes and the
 * fill envelope keep the earlier 45° headwall, bit for bit. Since the D4 portal wedges (owner decision 2026-09-29
 * "Round it off") the cut beyond the wing ends is a fan round the V where the skyline meets the section, met with a
 * smooth maximum, and the "underlay" mode takes the lower of the earlier headwall and that.
 */

/** Level straights east along row 20 at z = 0 from q0: `n` of them. */
function run(q0: number, n: number, zMm = 0): PieceSpec[] {
  return Array.from({ length: n }, (_, i) => ({ kind: "straight", from: { q: q0 + i, r: 20, zMm }, heading: 0, z1Mm: zMm }) as const);
}

/** Flat ground at 0 m with a hill by column (col = q + ⌊r/2⌋, so x ≈ 5 · col): 6 m at column 29, 14 m from 30 to 45. */
const HILL = makeTerrain(120, 40, (_q, _r, col) => (col === 29 ? 60 : col >= 30 && col <= 45 ? 140 : 0), -100);

/** The approach's pieces and the tunnel plane they carry: ground from (10, 20) to the portal at (19, 20), a tunnel on to (27, 20). */
function portalScene() {
  const sim = simOn(HILL);
  const built = sim.execute({ type: "build-track", pieces: [...run(10, 9), ...run(19, 8)], structure: "auto" });
  if (!built.ok) throw new Error(`${built.reason.code}: ${built.reason.message}`);
  const pieces = [...sim.ground().pieces.values()];
  return { sim, built, pieces };
}

function envelopes(p: EarthworkPiece, x: number, y: number, mode: "ground" | "underlay"): Envelope | null {
  const out: Envelope = { u: 0, l: 0, d: 0, band: 0 };
  return envelopeAt(p, p, x, y, null, { d: 0, s: 0 }, out, mode) ? out : null;
}

describe("portal outline", () => {
  it("is the face top over the face, falling 1 : 1.5 along the wing copings, and retains the hill 0.25 m above it", () => {
    expect([PORTAL_HALF_WIDTH_M, PORTAL_TOP_V, PORTAL_WING_RUN, PORTAL_RETAIN_ABOVE_TOP_M]).toEqual([4.2, 7.4, 1.5, 0.25]);
    expect(portalSkylineV(0)).toBe(7.4);
    expect(portalSkylineV(-4.2)).toBe(7.4);
    expect(portalSkylineV(5.7)).toBeCloseTo(6.4, 12);
    expect(portalRetainV(0)).toBe(7.65);
    expect(portalRetainV(-7.2)).toBeCloseTo(5.65, 12);
  });
});

describe("clip planes at a tunnel end", () => {
  it("marks the plane where a tunnel goes on, with the track height there, on every piece of the approach", () => {
    const { built, pieces } = portalScene();
    expect(built.diff.added.filter((a) => a.structure === "tunnel")).toHaveLength(8);
    expect(pieces).toHaveLength(9);
    for (const p of pieces) {
      const portal = p.planes.find((c) => c.key === "19,20,0");
      expect(portal, p.key).toMatchObject({ fixed: true, tunnel: true, zM: 0, tx: 1, ty: 0 });
      // The approach's west end is a buffer: a query plane, no tunnel.
      expect(p.planes.find((c) => c.key === "10,20,0"), p.key).toMatchObject({ fixed: false, tunnel: false });
    }
  });

  it("marks a bridge end fixed but not a tunnel", () => {
    // A 20 m deep valley from column 30: the approach at 0 m goes on as a bridge.
    const valley = makeTerrain(120, 40, (_q, _r, col) => (col >= 30 && col <= 45 ? -200 : 0), -300);
    const sim = simOn(valley);
    expect(sim.execute({ type: "build-track", pieces: [...run(10, 9), ...run(19, 8)], structure: "auto" }).ok).toBe(true);
    const pieces = [...sim.ground().pieces.values()];
    expect(pieces.length).toBeGreaterThan(0);
    for (const p of pieces) expect(p.planes.find((c) => c.key === "19,20,0"), p.key).toMatchObject({ fixed: true, tunnel: false });
  });
});

describe("the retain rule (\"ground\" mode) past a tunnel plane", () => {
  const { pieces } = portalScene();
  const plane = pieces[0]?.planes.find((c) => c.tunnel) as ClipPlane;
  const last = pieces.find((p) => p.key === "S:18,20,0:0:0") as EarthworkPiece;

  it("starts the cut at the retained skyline over the face and the wings, then rises at 45°", () => {
    for (const t of [0.25, 1, 2.5, 5, 9]) {
      for (const across of [0, 2, 4.2, 5, 7]) {
        const x = plane.x + t;
        const y = plane.y + across;
        for (const p of pieces) {
          const g = envelopes(p, x, y, "ground");
          const u = envelopes(p, x, y, "underlay");
          expect(g === null, `${p.key} ${t} ${across}`).toBe(u === null);
          if (!g || !u) continue;
          // The underlay is the earlier envelope (the section at the foot on the plane plus the headwall), no higher
          // than the ground mode's.
          const foot = envelopes(p, plane.x, y, "underlay");
          if (!foot) continue;
          expect(u.u).toBeCloseTo(Math.min(foot.u + HEADWALL_RISE * t, g.u), 9);
          // Ground mode: never below the retained skyline rising at 45°, and exactly it behind the face and the wings,
          // clear of the valley past the wing ends (|u| ≈ 9.84 m), where the smooth maximum rounds it.
          const floor = plane.zM + portalRetainV(across) + HEADWALL_RISE * t;
          expect(g.u).toBeGreaterThanOrEqual(floor - 1e-9);
          if (across <= 5 || t < 1) expect(g.u, `${p.key} ${t} ${across}`).toBeCloseTo(floor, 9);
          // The fill envelope and the plan distance are the underlay's.
          expect([g.l, g.d]).toEqual([u.l, u.d]);
        }
      }
    }
    // The last approach piece over the face: exactly the skyline plus the headwall, 7.65 m + t over the track.
    const at = envelopes(last, plane.x + 3, plane.y, "ground");
    expect(at?.u).toBeCloseTo(7.65 + 3, 9);
  });

  it("ends the cutting beyond the wing ends in a fan round the V, not the 45° headwall (D4 portal wedges)", () => {
    // Where the retained skyline meets the level section at the plane: 9.84 m across, 3.89 m over the track.
    expect(PORTAL_V_ACROSS_M).toBeCloseTo(9.8375, 9);
    expect(PORTAL_V_BOTTOM_V).toBeCloseTo(slopeRiseM(PORTAL_V_ACROSS_M), 12);
    expect(plane.zM + portalRetainV(PORTAL_V_ACROSS_M)).toBeCloseTo(plane.zM + PORTAL_V_BOTTOM_V, 9);
    for (const t of [3, 5, 8]) {
      for (const across of [12, 14, 16]) {
        const g = envelopes(last, plane.x + t, plane.y + across, "ground");
        const u = envelopes(last, plane.x + t, plane.y + across, "underlay");
        expect(g).not.toBeNull();
        if (!g || !u) continue;
        const section = bedAt(last, last.lengthM) + slopeRiseM(across);
        const fan = plane.zM + PORTAL_V_BOTTOM_V + Math.sqrt(t * t + (section - plane.zM - PORTAL_V_BOTTOM_V) ** 2);
        // The fan (or the approach's own rounded end, where it stands higher), never over the old headwall; the
        // underlay draws the same beyond the wing ends.
        expect(g.u).toBeGreaterThanOrEqual(fan - 1e-9);
        expect(g.u).toBeLessThan(section + HEADWALL_RISE * t);
        expect(u.u).toBeCloseTo(g.u, 9);
      }
    }
  });

  it("meets the cutting in front of the plane with the same height and slope beyond the wing ends: no crease along the plane", () => {
    for (const across of [10.5, 12, 14, 17]) {
      const y = plane.y + across;
      const front = envelopes(last, plane.x - 1e-4, y, "ground");
      const back = envelopes(last, plane.x + 1e-4, y, "ground");
      expect(front && back).toBeTruthy();
      if (!front || !back) continue;
      expect(Math.abs(back.u - front.u)).toBeLessThan(1e-3);
      // The slope into the hill at the plane: 0 in front (the section runs along the track), and so behind it, where
      // the old headwall rose at 45°.
      const h = 0.05;
      const ahead = envelopes(last, plane.x + h, y, "ground");
      expect(ahead).not.toBeNull();
      if (ahead) expect((ahead.u - back.u) / h).toBeLessThan(0.1);
    }
  });

  it("rounds the V where the retained skyline meets the fan: no crease behind the plane (D4 portal wedges)", () => {
    // The greatest change of slope across 0.5 m (the second difference over 0.25 m, per metre) of the cut envelope,
    // behind the plane and beyond the face, 1–12 m back. The old rule's hard maximum put 4/3 there, at the V.
    const h = 0.25;
    const cut = (x: number, y: number): number => {
      let u = Infinity;
      for (const p of pieces) {
        const e = envelopes(p, x, y, "ground");
        if (e && e.u < u) u = e.u;
      }
      return u;
    };
    const oldCut = (x: number, y: number): number => {
      const t = x - plane.x;
      const a = Math.abs(y - plane.y);
      return Math.max(plane.zM + slopeRiseM(a), plane.zM + portalRetainV(a)) + HEADWALL_RISE * t;
    };
    const sharpest = (f: (x: number, y: number) => number): number => {
      let worst = 0;
      for (let t = 1; t <= 12; t += 0.5) {
        for (let a = 5; a <= 20; a += 0.125) {
          for (const sign of [1, -1]) {
            const x = plane.x + t;
            const y = plane.y + sign * a;
            const d2 = Math.abs(f(x, y + h) - 2 * f(x, y) + f(x, y - h)) / h;
            if (d2 > worst) worst = d2;
          }
        }
      }
      return worst;
    };
    expect(sharpest(oldCut)).toBeGreaterThan(1);
    expect(sharpest(cut)).toBeLessThan(0.3);
  });

  it("never lies under the approach's own envelope with no clip plane, so the reach bounds hold", () => {
    for (const p of pieces) {
      const bare = withPlanes(p, NO_PLANES);
      for (let t = 0.5; t <= 20; t += 1.5) {
        for (let a = -24; a <= 24; a += 1.5) {
          const g = envelopes(p, plane.x + t, plane.y + a, "ground");
          const b = envelopes(bare, plane.x + t, plane.y + a, "ground");
          if (g && b) expect(g.u, `${p.key} ${t} ${a}`).toBeGreaterThanOrEqual(b.u - 1e-9);
        }
      }
    }
  });

  it("widens the daylight clamp beyond the wing ends only, back to the default at the plane and before the reach", () => {
    const band = (x: number, y: number, p: EarthworkPiece = last) => envelopes(p, x, y, "ground")?.band;
    // In front of the plane, over the face and the wings and at the plane itself: the default.
    expect(band(plane.x - 3, plane.y + 14)).toBe(DAYLIGHT_ROUND_M);
    expect(band(plane.x + 5, plane.y + 2)).toBe(DAYLIGHT_ROUND_M);
    expect(band(plane.x + 5, plane.y - 7)).toBe(DAYLIGHT_ROUND_M);
    expect(band(plane.x + 1e-6, plane.y + 14)).toBeCloseTo(DAYLIGHT_ROUND_M, 6);
    // Beyond the wing ends, 5 m behind: the full band.
    expect(band(plane.x + 5, plane.y + 14)).toBeCloseTo(PORTAL_DAYLIGHT_ROUND_M, 9);
    // Where the piece's earthworks end, the default again (so the ground is continuous there).
    for (let a = 5; a <= 30; a += 0.5) {
      const x = plane.x + 6;
      const y = plane.y + a;
      const e = envelopes(last, x, y, "ground");
      if (!e) continue;
      const m = nearestOnPiece(last, x, y);
      if (m.d > last.reachM - 1) expect(e.band, `${a}`).toBe(DAYLIGHT_ROUND_M);
    }
    // conformRule with the default band is the rule as it was; a wider one rounds more, never over the cut or natural.
    for (const [n, u] of [
      [10, 9.5],
      [10, 10.4],
      [10, 8],
    ] as const) {
      expect(conformRule(n, u, -20)).toBe(conformRule(n, u, -20, DAYLIGHT_ROUND_M));
      const wide = conformRule(n, u, -20, PORTAL_DAYLIGHT_ROUND_M);
      expect(wide).toBeLessThanOrEqual(Math.min(n, u) + 1e-12);
      expect(wide).toBeGreaterThanOrEqual(Math.min(n, u) - PORTAL_DAYLIGHT_ROUND_M / 4 - 1e-12);
    }
  });

  it("gives the wider band way where another piece's earthworks end beside a portal: no step in the ground (verification 2026-09-29)", async () => {
    // The verification's traced worst case (automated, at 8c7dca9): a Track drag through a hill on the diorama (the
    // committed population's free drag 244, (243, 116) → (218, 91), 25 pieces, 16 tunnel), then a Track drag from
    // node (228, 91) at 25.3 m along the tunnel's heading (7 ground pieces) beside its portal at (224, 97). Where a
    // piece of the second track reached its earthworks' end (8.9 m from its centreline) the portal's 2.5 m band had
    // read its fill envelope, and past it no longer: the ground stepped 0.175 m in 0.02 m, 2.75 m behind the plane and
    // 16.1 m across, where the natural ground is smooth. The band now gives way within a metre of every piece's reach
    // edge, either side (`reachEdgeWeight`), so the reach bound of DAYLIGHT_ROUND_M holds there again.
    const { diorama } = await import("../../../tests/support/groundPlans");
    const { toWorld } = await import("../lattice");
    const { terrain } = diorama();
    const sim = simOn(terrain);
    const drag = (q0: number, r0: number, z0Mm: number, q1: number, r1: number, fromHeading?: 1) => {
      const w = toWorld({ q: q1, r: r1 });
      const plan = sim.planTrack({
        from: { q: q0, r: r0, zMm: z0Mm },
        ...(fromHeading === undefined ? {} : { fromHeading }),
        to: { xMm: Math.round(w.x * 1000), yMm: Math.round(w.y * 1000) },
        dzMm: (sim.groundMm(q1, r1) ?? z0Mm) - z0Mm,
        magnetism: true,
        heightMode: "auto",
      });
      return sim.execute({ type: "build-track", pieces: plan.pieces, structure: "auto" });
    };
    expect(drag(243, 116, 11_800, 218, 91).ok).toBe(true);
    expect(sim.network().pieces.map((p) => p.structure[0]).join("")).toBe("ggggggttttttttttttttttggg");
    expect(drag(228, 91, 25_300, 235, 98, 1).ok).toBe(true);
    const all = [...sim.ground().pieces.values()];
    // The portal plane at node (224, 97), square to heading 1 (into the tunnel); t behind it, a across it.
    const o = toWorld({ q: 224, r: 97 });
    const tx = Math.sqrt(3) / 2;
    const ty = 0.5;
    const at = (t: number, a: number) => ({ x: o.x + tx * t - ty * a, y: o.y + ty * t + tx * a });
    let worst = 0;
    let where = "";
    for (let t = 0.5; t <= 12; t += 0.25) {
      let prev = Number.NaN;
      let prevN = Number.NaN;
      for (let a = -24; a <= 24; a += 0.02) {
        const p = at(t, a);
        const n = naturalHeightAtM(terrain, p.x, p.y);
        const g = conformedHeightM(all, p.x, p.y, n, 0, null, "ground");
        if (!Number.isNaN(prev)) {
          const step = Math.abs(g - prev - (n - prevN));
          if (step > worst) {
            worst = step;
            where = `t ${t} a ${a.toFixed(2)}`;
          }
        }
        prev = g;
        prevN = n;
      }
    }
    // Measured 2026-09-29 (these rows, 0.02 m steps, the change beyond the natural's): 0.175 m at t 2.75, a −16.08
    // before; 0.017 m since, the rounded cutting's own curvature.
    expect(worst, where).toBeLessThan(0.05);
    // The effective ground the world keeps is the same surface (the node heights round it to mm).
    for (const [q, r] of [
      [226, 93],
      [225, 95],
      [227, 94],
    ] as const) {
      const w = toWorld({ q, r });
      expect(sim.groundMm(q, r)).toBe(Math.round(conformedHeightM(all, w.x, w.y, naturalHeightAtM(terrain, w.x, w.y), 0, null, "ground") * 1000));
    }
  });

  it("keeps the hill behind the face and the wings within the smooth clamp's rounding, never above it, and the rails clear", () => {
    const { sim } = portalScene();
    const all = [...sim.ground().pieces.values()];
    for (let t = 0.05; t <= 20; t += 0.25) {
      for (let a = -24; a <= 24; a += 0.5) {
        const x = plane.x + t;
        const y = plane.y + a;
        const n = naturalHeightAtM(HILL, x, y);
        if (Number.isNaN(n)) continue;
        const e = conformedHeightM(all, x, y, n, 0, null, "ground");
        expect(e, `${t} ${a}`).toBeLessThanOrEqual(n + 1e-9);
        const floor = Math.min(n, plane.zM + portalRetainV(a) + HEADWALL_RISE * t);
        // Behind the face and the wings the clamp is DAYLIGHT_ROUND_M's, as before the portal wedges were rounded.
        if (Math.abs(a) <= PORTAL_V_ACROSS_M - 0.5) expect(e, `${t} ${a}`).toBeGreaterThanOrEqual(floor - DAYLIGHT_ROUND_M / 4 - 1e-9);
      }
    }
    // The approach's formation stays at the bed, right up to the plane.
    for (const s of [0.5, 5, 20, 40]) expect(conformedHeightM(all, plane.x - s, plane.y, naturalHeightAtM(HILL, plane.x - s, plane.y), 0, null, "ground")).toBeCloseTo(0, 9);
  });

  it("changes nothing in front of the plane", () => {
    for (const p of pieces) {
      for (const [dx, dy] of [
        [-0.5, 0],
        [-3, 2],
        [-8, -5],
      ] as const) {
        expect(envelopes(p, plane.x + dx, plane.y + dy, "ground"), p.key).toEqual(envelopes(p, plane.x + dx, plane.y + dy, "underlay"));
      }
    }
  });

  it("leaves bridge planes and buffer planes as they were", () => {
    const valley = makeTerrain(120, 40, (_q, _r, col) => (col >= 30 && col <= 45 ? -200 : 0), -300);
    const sim = simOn(valley);
    expect(sim.execute({ type: "build-track", pieces: [...run(10, 9), ...run(19, 8)], structure: "auto" }).ok).toBe(true);
    const bridged = [...sim.ground().pieces.values()];
    const bridgePlane = bridged[0]?.planes.find((c) => c.fixed) as ClipPlane;
    expect(bridgePlane.tunnel).toBe(false);
    for (const p of bridged) {
      for (const t of [0.5, 3, 8]) {
        for (const across of [0, 3, 6]) {
          expect(envelopes(p, bridgePlane.x + t, bridgePlane.y + across, "ground")).toEqual(envelopes(p, bridgePlane.x + t, bridgePlane.y + across, "underlay"));
        }
      }
    }
    // A buffer end's query plane: the same either way.
    const lone = simOn(HILL);
    expect(lone.execute({ type: "build-track", pieces: run(10, 9), structure: "auto" }).ok).toBe(true);
    for (const p of lone.ground().pieces.values()) {
      const buffer = p.planes.find((c) => !c.fixed) as ClipPlane;
      for (const clip of [null, new Set([buffer.key])]) {
        const g: Envelope = { u: 0, l: 0, d: 0, band: 0 };
        const u: Envelope = { u: 0, l: 0, d: 0, band: 0 };
        const x = 5 * 29 + 2;
        const y = 20 * 2.5 * Math.sqrt(3) + 1;
        expect(envelopeAt(p, p, x, y, clip, { d: 0, s: 0 }, g, "ground")).toBe(envelopeAt(p, p, x, y, clip, { d: 0, s: 0 }, u, "underlay"));
        expect(g).toEqual(u);
      }
    }
  });
});
