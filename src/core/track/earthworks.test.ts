import { describe, expect, it } from "vitest";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { simOn } from "../../../tests/support/simOn";
import type { PieceSpec } from "../geometry/piece";
import { type ClipPlane, type EarthworkPiece, type Envelope, HEADWALL_RISE, bedAt, envelopeAt, slopeRiseM } from "./earthworks";
import { PORTAL_HALF_WIDTH_M, PORTAL_RETAIN_ABOVE_TOP_M, PORTAL_TOP_V, PORTAL_WING_RUN, portalRetainV, portalSkylineV } from "./portal";

/**
 * The clip planes' tunnel flag and the retain rule (D4 second feel-check fixes, 2026-09-28): past a tunnel end's
 * plane, in "ground" mode, the cut envelope starts at the portal's retained skyline; bridge and buffer planes, the
 * fill envelope and the "underlay" mode keep the earlier 45° headwall from the track bed, bit for bit.
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
  const out: Envelope = { u: 0, l: 0, d: 0 };
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
          // The underlay is the earlier envelope: the section at the foot on the plane, plus the headwall.
          const foot = envelopes(p, plane.x, y, "underlay");
          if (!foot) continue;
          expect(u.u).toBeCloseTo(foot.u + HEADWALL_RISE * t, 9);
          // Ground mode: never below the underlay, never below the retained skyline, and one of the two exactly.
          const floor = plane.zM + portalRetainV(across) + HEADWALL_RISE * t;
          expect(g.u).toBe(Math.max(u.u, g.u));
          expect(g.u).toBeGreaterThanOrEqual(floor - 1e-9);
          expect(g.u === u.u || Math.abs(g.u - floor) < 1e-9).toBe(true);
          // The fill envelope and the plan distance are the underlay's.
          expect([g.l, g.d]).toEqual([u.l, u.d]);
        }
      }
    }
    // The last approach piece over the face: exactly the skyline plus the headwall, 7.65 m + t over the track.
    const at = envelopes(last, plane.x + 3, plane.y, "ground");
    expect(at?.u).toBeCloseTo(7.65 + 3, 9);
    // Beyond the wing ends the approach's own section is higher: nothing changes, bit for bit.
    const far = envelopes(last, plane.x + 1, plane.y + 14, "ground");
    const farUnder = envelopes(last, plane.x + 1, plane.y + 14, "underlay");
    expect(far).not.toBeNull();
    expect(far).toEqual(farUnder);
    expect(bedAt(last, last.lengthM) + slopeRiseM(14)).toBeGreaterThan(plane.zM + portalRetainV(14));
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
        const g: Envelope = { u: 0, l: 0, d: 0 };
        const u: Envelope = { u: 0, l: 0, d: 0 };
        const x = 5 * 29 + 2;
        const y = 20 * 2.5 * Math.sqrt(3) + 1;
        expect(envelopeAt(p, p, x, y, clip, { d: 0, s: 0 }, g, "ground")).toBe(envelopeAt(p, p, x, y, clip, { d: 0, s: 0 }, u, "underlay"));
        expect(g).toEqual(u);
      }
    }
  });
});
