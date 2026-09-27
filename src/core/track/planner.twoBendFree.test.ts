import { describe, expect, it } from "vitest";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import type { PieceSpec } from "../geometry/piece";
import { CURVE_TEMPLATES, type CurveTemplate, type RadiusClassM, SHIFT_SIDES, type ShiftTemplate, shiftTemplate } from "../geometry/templates";
import { type Axial, type Heading, SQRT3, nearestNode, opposite, rotateHeading, stepLengthMm, stepOf } from "../lattice";
import { createWorld } from "../sim/world";
import {
  type Candidate,
  type PlanXY,
  type Rules,
  type Seg,
  arcTurn,
  bestTwoBend,
  MAX_VALIDATIONS,
  nearestUTurnEnd,
  twoBendFits,
  twoBendOrder,
  twoBendReach,
} from "./planner";

/**
 * Oracles for the two-bend fallback of free drags (owner decision
 * 2026-09-27): the fast paths (the cone prefilter, the pruned best-8 list,
 * the tabled reach test, the separable U-turn search) against plain
 * enumeration. Kept apart from `planner.test.ts`, like the `solveThree`
 * oracle in `planner.twoBend.test.ts`.
 */

const CAP_360: Rules = { allowRadius: (r) => r <= 360 };
const CAP_90: Rules = { allowRadius: (r) => r <= 90 };
const only = (radiusM: RadiusClassM): Rules => ({ allowRadius: (r) => r === radiusM });

/** Node plan position in mm, as the planner computes it. */
function planOf(q: number, r: number): PlanXY {
  return { x: 2500 * (2 * q + r), y: 2500 * SQRT3 * r };
}

function hexNodes(radius: number): Axial[] {
  const out: Axial[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) out.push({ q, r });
  }
  return out;
}

function straightRun(heading: Heading, count: number): Seg[] {
  return count > 0 ? [{ kind: "straight", heading, count }] : [];
}

const sideOf = (turn: number): number => (turn > 0 ? 0 : 1);

function curvePair(d0: Heading, t1: CurveTemplate, t2: CurveTemplate, x: number, y: number, z: number): Candidate {
  const dm = t1.endHeading;
  const de = t2.endHeading;
  return {
    fit: "two-bend",
    segs: [...straightRun(d0, x), { kind: "curve", t: t1 }, ...straightRun(dm, y), { kind: "curve", t: t2 }, ...straightRun(de, z)],
    bends: 2,
    radiusMm: Math.min(t1.radiusM, t2.radiusM) * 1000,
    lengthMm: x * stepLengthMm(d0) + t1.lengthMm + y * stepLengthMm(dm) + t2.lengthMm + z * stepLengthMm(de),
    turnSum: Math.abs(t1.turn) + Math.abs(t2.turn),
    turn: t1.turn + t2.turn,
    sides: 2 * sideOf(t1.turn) + sideOf(t2.turn),
    lead: x,
    endHeading: de,
  };
}

function shiftPair(d0: Heading, t: ShiftTemplate, x: number, z: number): Candidate {
  return {
    fit: "two-bend",
    segs: [...straightRun(d0, x), { kind: "shift", t }, { kind: "shift", t }, ...straightRun(d0, z)],
    bends: 2,
    radiusMm: t.radiusMm,
    lengthMm: (x + z) * stepLengthMm(d0) + 2 * t.lengthMm,
    turnSum: 0,
    turn: 0,
    sides: t.side === "left" ? 0 : 3,
    lead: x,
    endHeading: d0,
  };
}

/**
 * Every two-bend fit landing on `delta` with runs of at most 60 straights, by
 * enumeration: each curve pair on d0, each count y of middle straights with x
 * and z from the 2 × 2 system; when the first and last runs are parallel
 * (an S back onto d0, or a U-turn), y from the 2 × 2 system of the first two
 * runs and every x; every placement of two shifts. No cone test, no
 * `solveThree`.
 */
function enumerate(d0: Heading, delta: Axial, rules: Rules, endHeading?: Heading): Candidate[] {
  const out: Candidate[] = [];
  const a = stepOf(d0);
  for (const t1 of CURVE_TEMPLATES) {
    if (t1.heading !== d0 || !rules.allowRadius(t1.radiusM)) continue;
    const b = stepOf(t1.endHeading);
    for (const t2 of CURVE_TEMPLATES) {
      if (t2.heading !== t1.endHeading || !rules.allowRadius(t2.radiusM)) continue;
      if (endHeading !== undefined && t2.endHeading !== endHeading) continue;
      const c = stepOf(t2.endHeading);
      const g = a.q * c.r - a.r * c.q;
      const Dq = delta.q - t1.dq - t2.dq;
      const Dr = delta.r - t1.dr - t2.dr;
      const tryXyz = (x: number, y: number): void => {
        const zq = Dq - x * a.q - y * b.q;
        const zr = Dr - x * a.r - y * b.r;
        const z = c.q !== 0 ? zq / c.q : zr / c.r;
        if (Number.isInteger(z) && z >= 0 && z <= 60 && z * c.q === zq && z * c.r === zr) out.push(curvePair(d0, t1, t2, x, y, z + 0));
      };
      if (g !== 0) {
        for (let y = 0; y <= 60; y++) {
          const x = ((Dq - y * b.q) * c.r - (Dr - y * b.r) * c.q) / g;
          if (Number.isInteger(x) && x >= 0 && x <= 60) tryXyz(x + 0, y);
        }
      } else {
        // c = ±a: (x ± z)·a + y·b = D fixes y; every x ≤ 60 is tried.
        const h = a.q * b.r - a.r * b.q;
        const y = (a.q * Dr - a.r * Dq) / h;
        if (Number.isInteger(y) && y >= 0 && y <= 60) for (let x = 0; x <= 60; x++) tryXyz(x, y + 0);
      }
    }
  }
  if (endHeading === undefined || endHeading === d0) {
    for (const side of SHIFT_SIDES) {
      const t = shiftTemplate(d0, side);
      for (let x = 0; x <= 60; x++) {
        for (let z = 0; z <= 60; z++) {
          if (delta.q === 2 * t.dq + (x + z) * a.q && delta.r === 2 * t.dr + (x + z) * a.r) out.push(shiftPair(d0, t, x, z));
        }
      }
    }
  }
  return out;
}

function describeSegs(c: Candidate): string {
  return c.segs.map((s) => (s.kind === "straight" ? `S${s.heading}x${s.count}` : s.kind === "curve" ? `C${s.t.heading}:${s.t.turn}:${s.t.radiusM}:${s.t.variant}` : `H${s.t.heading}:${s.t.side}`)).join("|");
}

/** A plan's pieces in the same notation: straight runs collapsed. */
function describePieces(pieces: readonly PieceSpec[]): string {
  const out: string[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (p.kind === "straight") {
      const m = last?.match(/^S(\d+)x(\d+)$/);
      if (m && Number(m[1]) === p.heading) out[out.length - 1] = `S${p.heading}x${Number(m[2]) + 1}`;
      else out.push(`S${p.heading}x1`);
    } else {
      out.push(p.kind === "curve" ? `C${p.heading}:${p.turn}:${p.radiusM}:${p.variant}` : `H${p.heading}:${p.side}`);
    }
  }
  return out.join("|");
}

describe("the arc turn τ (twice the pointer's bearing)", () => {
  it("agrees with atan2 away from ties, and gives a U-turn toward the pointer's side abeam and behind", () => {
    const from = { q: 0, r: 0 };
    let checked = 0;
    for (const d0 of [0, 1, 7] as const) {
      const base = (d0 * Math.PI) / 6;
      for (let deg = -179; deg <= 180; deg += 1.5) {
        for (const distM of [7, 40, 180]) {
          const a = base + (deg * Math.PI) / 180;
          const p = { x: distM * 1000 * Math.cos(a), y: distM * 1000 * Math.sin(a) };
          const ahead = Math.cos((deg * Math.PI) / 180);
          const left = Math.sin((deg * Math.PI) / 180);
          const steps = (2 * deg) / 30;
          // Skip bearings within a hair of a rounding boundary or of abeam; floats decide those.
          if (Math.abs(Math.abs(steps % 1) - 0.5) < 1e-6 || Math.abs(ahead) < 1e-9) continue;
          let want = ahead <= 0 ? (left < 0 ? -6 : 6) : Math.round(steps);
          if (Math.abs(want) === 6) want = left < 0 ? -6 : 6;
          expect(arcTurn(p, from, d0), `d0 ${d0}, bearing ${deg}°`).toBe(want + 0);
          checked += 1;
        }
      }
    }
    // Guards against a degenerate sweep (2,160 bearings checked when written).
    expect(checked).toBeGreaterThan(1500);
    // Straight ahead is 0; exactly abeam, or on the line behind, is a left U-turn.
    expect(arcTurn({ x: 50_000, y: 0 }, from, 0)).toBe(0);
    expect(arcTurn({ x: 0, y: 50_000 }, from, 0)).toBe(6);
    expect(arcTurn({ x: 0, y: -50_000 }, from, 0)).toBe(-6);
    expect(arcTurn({ x: -50_000, y: 0 }, from, 0)).toBe(6);
  });
});

describe("two-bend fits of a free end", () => {
  it("the tabled reach test agrees with finding a fit, node by node", () => {
    let reached = 0;
    let tested = 0;
    for (const d0 of [0, 1] as const) {
      const combos: readonly [Rules, Heading | undefined][] = [
        [CAP_360, undefined],
        [CAP_90, undefined],
        [only(120), undefined],
        [only(60), opposite(d0)],
        [only(120), d0],
        [CAP_360, rotateHeading(d0, 4)],
      ];
      for (const [rules, endHeading] of combos) {
        const reach = twoBendReach(d0, endHeading, rules);
        for (const delta of hexNodes(30)) {
          const want = twoBendFits(d0, delta, endHeading, rules).length > 0;
          expect(reach(delta), `d0 ${d0}, end ${endHeading}, delta (${delta.q}, ${delta.r})`).toBe(want);
          tested += 1;
          if (want) reached += 1;
        }
      }
    }
    // Guards against a degenerate sweep: both answers occur often (3,840 of 33,492 reached when written).
    expect(reached).toBeGreaterThan(1000);
    expect(tested - reached).toBeGreaterThan(1000);
  });

  it("keeps exactly the best 8 of all fits by the free rank, whatever the pruning skipped", () => {
    let compared = 0;
    for (const d0 of [0, 1] as const) {
      for (const [rules, endHeading] of [
        [CAP_360, undefined],
        [only(90), undefined],
        [CAP_360, opposite(d0)],
      ] as const) {
        for (let q = -36; q <= 36; q += 6) {
          for (let r = -36; r <= 36; r += 6) {
            const delta = { q, r };
            for (const tau of [-6, 1, 5]) {
              const order = twoBendOrder(tau);
              const all = twoBendFits(d0, delta, endHeading, rules).sort(order);
              expect(bestTwoBend(d0, delta, endHeading, rules, tau)).toEqual(all.slice(0, MAX_VALIDATIONS));
              if (all.length > 0) compared += 1;
            }
          }
        }
      }
    }
    // Guards against a degenerate sweep (1,014 non-empty pools when written).
    expect(compared).toBeGreaterThan(800);
  });

  it("returns the best fit that plain enumeration finds, and the planner lays it (a small sweep)", () => {
    const w = createWorld(makeTerrain(200, 174, () => 200));
    const start = { q: 57, r: 87, zMm: 20_000 };
    let planned = 0;
    for (const d0 of [0, 1] as const) {
      for (let q = -40; q <= 40; q += 4) {
        for (let r = -40; r <= 40; r += 4) {
          const delta = { q, r };
          const all = enumerate(d0, delta, CAP_360);
          if (all.length === 0) continue;
          const p = planOf(start.q + q, start.r + r);
          const tau = arcTurn(p, start, d0);
          const order = twoBendOrder(tau);
          const best = all.reduce((m, c) => (order(c, m) < 0 ? c : m));
          const got = bestTwoBend(d0, delta, undefined, CAP_360, tau)[0];
          expect(got && describeSegs(got), `d0 ${d0}, delta (${q}, ${r})`).toBe(best && describeSegs(best));
          // Where no single bend reaches the node or any of its six neighbours, the planner ends there with that
          // fit (valid on the empty map); a single bend a node off wins otherwise (owner decision 2026-09-27).
          const plan = w.plan({ from: start, fromHeading: d0, to: { xMm: p.x, yMm: p.y }, dzMm: 0, magnetism: true });
          if (plan.fit !== "two-bend") continue;
          expect(plan.end?.node).toMatchObject({ q: start.q + q, r: start.r + r });
          expect(w.run({ type: "build-track", pieces: plan.pieces, structure: "auto" }, false).ok).toBe(true);
          expect(describePieces(plan.pieces)).toBe(best && describeSegs(best));
          planned += 1;
        }
      }
    }
    // Guards against a degenerate sweep (182 planned two-bend fits when written, and still 182 once one bend a
    // node off beats two bends).
    expect(planned).toBeGreaterThan(100);
  });
});

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}

describe("the U-turn end nearest a pointer behind the start", () => {
  /**
   * Brute force: every node within `rings` of the pointer's node that some U-turn pair reaches, nearest
   * first (ties: left, then q, then r). Ring k lies at least k·4.33 m from that node, so the answer is exact
   * when it lies within rings · 4.33 m less the node's offset from the pointer, which the test asserts.
   */
  function nearestByEnumeration(p: PlanXY, from: Axial, d0: Heading, rules: Rules, rings: number): { node: Axial; distMm: number } | undefined {
    const n = nearestNode({ x: p.x / 1000, y: p.y / 1000 });
    const a = stepOf(d0);
    const pairs = ([3, -3] as const).flatMap((turn, side) => {
      const b = stepOf(rotateHeading(d0, turn));
      return CURVE_TEMPLATES.filter((t1) => t1.heading === d0 && t1.turn === turn && rules.allowRadius(t1.radiusM)).flatMap((t1) =>
        CURVE_TEMPLATES.filter((t2) => t2.heading === t1.endHeading && t2.turn === turn && rules.allowRadius(t2.radiusM)).map((t2) => ({
          side,
          b,
          g: a.q * b.r - a.r * b.q,
          tq: from.q + t1.dq + t2.dq,
          tr: from.r + t1.dr + t2.dr,
        })),
      );
    });
    let best: { node: Axial; key: number[] } | undefined;
    for (const offset of hexNodes(rings)) {
      const node = { q: n.q + offset.q, r: n.r + offset.r };
      const e = planOf(node.q, node.r);
      const d2 = (e.x - p.x) * (e.x - p.x) + (e.y - p.y) * (e.y - p.y);
      for (const { side, b, g, tq, tr } of pairs) {
        // node − from − T = k·a + y·b with k any integer and y ≥ 0 (x, z ≥ 0 give every k).
        const vq = node.q - tq;
        const vr = node.r - tr;
        const kn = vq * b.r - vr * b.q;
        const yn = a.q * vr - a.r * vq;
        if (kn % g !== 0 || yn % g !== 0 || yn / g < 0) continue;
        const key = [d2, side, node.q, node.r];
        if (!best || lexLess(key, best.key)) best = { node, key };
      }
    }
    return best && { node: best.node, distMm: Math.sqrt(best.key[0] ?? 0) };
  }

  it("matches enumeration, and the planner ends there", () => {
    const w = createWorld(makeTerrain(200, 174, () => 200));
    const start = { q: 57, r: 87, zMm: 20_000 };
    const s = planOf(start.q, start.r);
    let checked = 0;
    for (const d0 of [0, 1, 5] as const) {
      const u = { x: Math.cos((d0 * Math.PI) / 6), y: Math.sin((d0 * Math.PI) / 6) };
      for (const [rules, precision] of [
        [CAP_360, undefined],
        [only(90), 90],
      ] as const) {
        for (const back of [8_000, 130_000]) {
          for (const left of [-90_000, -21_700, 0, 64_000]) {
            const p = { x: s.x - back * u.x - left * u.y, y: s.y - back * u.y + left * u.x };
            const got = nearestUTurnEnd(p, start, d0, rules);
            if (!got) throw new Error("no U-turn end");
            // Enumerate every node out to just past the answer: any nearer end would be among them.
            const n = nearestNode({ x: p.x / 1000, y: p.y / 1000 });
            const nOffset = Math.hypot(planOf(n.q, n.r).x - p.x, planOf(n.q, n.r).y - p.y);
            const gotMm = Math.hypot(planOf(got.q, got.r).x - p.x, planOf(got.q, got.r).y - p.y);
            const rings = Math.ceil((gotMm + nOffset) / 4330) + 1;
            const want = nearestByEnumeration(p, start, d0, rules, rings);
            expect(want && want.distMm < rings * 4330 - nOffset, "within the enumerated rings").toBe(true);
            expect(got, `d0 ${d0}, R ${precision ?? "≤ 360"}, back ${back}, left ${left}`).toEqual(want?.node);
            const plan = w.plan({ from: start, fromHeading: d0, to: { xMm: p.x, yMm: p.y }, dzMm: 0, magnetism: false, ...(precision ? { precision: { radiusM: precision } } : {}) });
            // Nothing reaches these pointers' nodes (all within 120 m of the start's line), so the plan ends on that U-turn.
            expect(plan.fit).toBe("two-bend");
            expect(plan.end?.node).toMatchObject(got ?? {});
            expect(plan.end?.heading).toBe(opposite(d0));
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(48);
  }, 30_000);
});
