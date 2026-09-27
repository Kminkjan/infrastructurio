import { describe, expect, it } from "vitest";
import { type Heading, HEADINGS, axial, isPrimary, opposite, rotateHeading, stepOf, toWorld } from "../lattice";
import { hashCanonical } from "../util/hash";
import {
  BASE_CURVE_TEMPLATES,
  CURVE_TEMPLATES,
  CURVE_TURNS,
  MAX_SPEED_MMS,
  RADIUS_CLASSES_M,
  type RenderPrim,
  SHIFT_ANGLE_RAD,
  SHIFT_TEMPLATES,
  STRAIGHT_TEMPLATES,
  type Template,
  curveTemplate,
  curveVariantCount,
  shiftTemplate,
  speedLimitMmsForRadiusMm,
} from "./templates";

const EPS = 1e-9;
const ALL: readonly Template[] = [...STRAIGHT_TEMPLATES, ...CURVE_TEMPLATES, ...SHIFT_TEMPLATES];

/** Signed angle difference wrapped into (−π, π]. */
function angleDiff(a: number, b: number): number {
  const d = (((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI);
  return d - Math.PI;
}

function headingAngle(h: Heading): number {
  return (h * Math.PI) / 6;
}

interface Ends {
  readonly start: { x: number; y: number; tangent: number };
  readonly end: { x: number; y: number; tangent: number };
  readonly lengthM: number;
}

/** Endpoints, tangents and length of one primitive, computed independently with trig. */
function ends(p: RenderPrim): Ends {
  if (p.kind === "line") {
    const tangent = Math.atan2(p.y1 - p.y0, p.x1 - p.x0);
    return {
      start: { x: p.x0, y: p.y0, tangent },
      end: { x: p.x1, y: p.y1, tangent },
      lengthM: Math.hypot(p.x1 - p.x0, p.y1 - p.y0),
    };
  }
  const turn = Math.sign(p.sweepRad) * (Math.PI / 2);
  const a0 = p.startRad;
  const a1 = p.startRad + p.sweepRad;
  return {
    start: { x: p.cx + p.radiusM * Math.cos(a0), y: p.cy + p.radiusM * Math.sin(a0), tangent: a0 + turn },
    end: { x: p.cx + p.radiusM * Math.cos(a1), y: p.cy + p.radiusM * Math.sin(a1), tangent: a1 + turn },
    lengthM: p.radiusM * Math.abs(p.sweepRad),
  };
}

function describeTemplate(t: Template): string {
  if (t.kind === "curve") return `curve d${t.heading} turn ${t.turn} R${t.radiusM} v${t.variant}`;
  if (t.kind === "shift") return `shift d${t.heading} ${t.side}`;
  return `straight d${t.heading}`;
}

describe("piece templates", () => {
  it("keeps the shift angle literal equal to 2·atan(√3/15) within 1e-15", () => {
    expect(Math.abs(2 * Math.atan(Math.sqrt(3) / 15) - SHIFT_ANGLE_RAD)).toBeLessThanOrEqual(1e-15);
    expect((SHIFT_ANGLE_RAD * 180) / Math.PI).toBeCloseTo(13.1736, 4);
  });

  it("generates 12 straights, 120 base curves, 720 oriented curves and 24 shifts", () => {
    expect(STRAIGHT_TEMPLATES).toHaveLength(12);
    expect(BASE_CURVE_TEMPLATES).toHaveLength(120);
    expect(CURVE_TEMPLATES).toHaveLength(720);
    expect(SHIFT_TEMPLATES).toHaveLength(24);
    expect(SHIFT_TEMPLATES.filter((t) => isPrimary(t.heading))).toHaveLength(12);
    for (const h of HEADINGS) {
      expect(CURVE_TEMPLATES.filter((t) => t.heading === h)).toHaveLength(isPrimary(h) ? 48 : 72);
    }
  });

  it("has 1 variant for 30°, 1 (primary) or 3 (secondary) for 60°, and 2 for 90°", () => {
    for (const h of HEADINGS) {
      for (const turn of CURVE_TURNS) {
        for (const r of RADIUS_CLASSES_M) {
          const abs = Math.abs(turn);
          const expected = abs === 1 ? 1 : abs === 2 ? (isPrimary(h) ? 1 : 3) : 2;
          expect(curveVariantCount(h, turn, r)).toBe(expected);
          expect(curveTemplate(h, turn, r, expected)).toBeUndefined();
        }
      }
    }
  });

  it("closes every oriented template exactly on its lattice node with tangent continuity", () => {
    for (const t of ALL) {
      const label = describeTemplate(t);
      expect(Number.isSafeInteger(t.dq) && Number.isSafeInteger(t.dr), label).toBe(true);
      const parts = t.prims.map(ends);
      const first = parts[0];
      const last = parts[parts.length - 1];
      if (!first || !last) throw new Error(`${label} has no primitives`);
      expect(Math.hypot(first.start.x, first.start.y), label).toBeLessThan(EPS);
      expect(Math.abs(angleDiff(first.start.tangent, headingAngle(t.heading))), label).toBeLessThan(EPS);
      for (let i = 1; i < parts.length; i++) {
        const a = parts[i - 1] as Ends;
        const b = parts[i] as Ends;
        expect(Math.hypot(a.end.x - b.start.x, a.end.y - b.start.y), label).toBeLessThan(EPS);
        expect(Math.abs(angleDiff(a.end.tangent, b.start.tangent)), label).toBeLessThan(EPS);
      }
      const node = toWorld(axial(t.dq, t.dr));
      expect(Math.hypot(last.end.x - node.x, last.end.y - node.y), label).toBeLessThan(EPS);
      expect(Math.abs(angleDiff(last.end.tangent, headingAngle(t.endHeading))), label).toBeLessThan(EPS);
    }
  });

  it("turns each curve by its signed turn and keeps the lead straights non-negative", () => {
    for (const t of CURVE_TEMPLATES) {
      expect(t.endHeading).toBe(rotateHeading(t.heading, t.turn));
      expect(t.leadInM).toBeGreaterThanOrEqual(0);
      expect(t.leadOutM).toBeGreaterThanOrEqual(0);
      const arcs = t.prims.filter((p) => p.kind === "arc");
      expect(arcs).toHaveLength(1);
      expect(arcs[0]?.kind === "arc" && arcs[0].radiusM).toBe(t.radiusM);
    }
  });

  it("stores integer lengths equal to round(float length × 1000)", () => {
    for (const t of ALL) {
      const floatM = t.prims.map(ends).reduce((sum, e) => sum + e.lengthM, 0);
      expect(t.lengthMm, describeTemplate(t)).toBe(Math.round(floatM * 1000));
      expect(Number.isSafeInteger(t.lengthMm)).toBe(true);
    }
    expect(straightTemplateLengths()).toEqual([5000, 8660]);
  });

  it("reaches every node of each curve's cone exactly once as straights + one variant + straights", () => {
    let checked = 0;
    for (const d0 of HEADINGS) {
      for (const turn of CURVE_TURNS) {
        for (const radiusM of RADIUS_CLASSES_M) {
          const d1 = rotateHeading(d0, turn);
          const u0 = { x: Math.cos(headingAngle(d0)), y: Math.sin(headingAngle(d0)) };
          const u1 = { x: Math.cos(headingAngle(d1)), y: Math.sin(headingAngle(d1)) };
          const det = u0.x * u1.y - u0.y * u1.x;
          const tangent = radiusM * Math.tan((Math.abs(turn) * Math.PI) / 12);
          const s0 = stepOf(d0);
          const s1 = stepOf(d1);
          const len0 = Math.hypot(toWorld(s0).x, toWorld(s0).y);
          const len1 = Math.hypot(toWorld(s1).x, toWorld(s1).y);
          const stepDet = s0.q * s1.r - s0.r * s1.q;
          const variants = Array.from({ length: curveVariantCount(d0, turn, radiusM) }, (_, v) =>
            curveTemplate(d0, turn, radiusM, v),
          );
          // Axial window generously covering A ∈ [T, T + 4|s0|], B ∈ [T, T + 4|s1|].
          const reach = Math.ceil((tangent + 4 * Math.max(len0, len1)) / 4) + 4;
          for (let r = -2 * reach; r <= 2 * reach; r++) {
            for (let q = -2 * reach; q <= 2 * reach; q++) {
              const w = toWorld(axial(q, r));
              const a = (w.x * u1.y - w.y * u1.x) / det;
              const b = (u0.x * w.y - u0.y * w.x) / det;
              if (a < tangent - 1e-6 || b < tangent - 1e-6) continue;
              if (a > tangent + 4 * len0 || b > tangent + 4 * len1) continue;
              let hits = 0;
              for (const v of variants) {
                if (!v) throw new Error("missing variant");
                const dq = q - v.dq;
                const dr = r - v.dr;
                const n = (dq * s1.r - dr * s1.q) / stepDet;
                const m = (s0.q * dr - s0.r * dq) / stepDet;
                if (Number.isInteger(n) && Number.isInteger(m) && n >= 0 && m >= 0) hits += 1;
              }
              expect(hits, `d${d0} turn ${turn} R${radiusM} node (${q}, ${r})`).toBe(1);
              checked += 1;
            }
          }
        }
      }
    }
    // 432 families (12 headings × 6 turns × 6 radii), each windowed to 4 straights past the cell.
    expect(checked).toBe(12_164);
  });

  it("describes each curve and shift from its other end by the reversed template", () => {
    for (const t of CURVE_TEMPLATES) {
      const back = curveTemplate(opposite(t.endHeading), (0 - t.turn) as typeof t.turn, t.radiusM, t.variant);
      expect(back, describeTemplate(t)).toBeDefined();
      expect([back?.dq, back?.dr, back?.endHeading, back?.lengthMm]).toEqual([0 - t.dq, 0 - t.dr, opposite(t.heading), t.lengthMm]);
      expect(back?.leadInM).toBeCloseTo(t.leadOutM, 9);
    }
    for (const t of SHIFT_TEMPLATES) {
      const back = shiftTemplate(opposite(t.heading), t.side);
      expect([back.dq, back.dr, back.lengthMm]).toEqual([0 - t.dq, 0 - t.dr, t.lengthMm]);
    }
  });

  it("derives speed limits from √(0.8·R) rounded to 5 km/h, matching the table in #66", () => {
    const table: Record<number, number> = { 60: 6944, 90: 8333, 120: 9722, 180: 12500, 240: 13888, 360: 16666 };
    for (const t of CURVE_TEMPLATES) expect(t.speedLimitMms).toBe(table[t.radiusM]);
    for (const t of STRAIGHT_TEMPLATES) expect(t.speedLimitMms).toBe(MAX_SPEED_MMS);
    for (const t of SHIFT_TEMPLATES) expect(t.speedLimitMms).toBe(8333);
    for (let radiusMm = 1000; radiusMm <= 600_000; radiusMm += 997) {
      const kmh = Math.min(60, Math.round((Math.sqrt(0.8 * (radiusMm / 1000)) * 3.6) / 5) * 5);
      expect(speedLimitMmsForRadiusMm(radiusMm), `R ${radiusMm} mm`).toBe(Math.floor((kmh * 1000) / 3.6));
    }
  });

  it("builds shifts of 37.5 m × 4.33 m (R ≈ 82.3 m) and 43.3 m × 5.0 m (R = 95.0 m)", () => {
    expect([shiftTemplate(0, "left").dq, shiftTemplate(0, "left").dr]).toEqual([7, 1]);
    expect([shiftTemplate(0, "right").dq, shiftTemplate(0, "right").dr]).toEqual([8, -1]);
    expect([shiftTemplate(1, "left").dq, shiftTemplate(1, "left").dr]).toEqual([4, 6]);
    expect([shiftTemplate(1, "right").dq, shiftTemplate(1, "right").dr]).toEqual([6, 4]);
    for (const t of SHIFT_TEMPLATES) {
      const u = { x: Math.cos(headingAngle(t.heading)), y: Math.sin(headingAngle(t.heading)) };
      const w = toWorld(axial(t.dq, t.dr));
      const span = w.x * u.x + w.y * u.y;
      const lateral = u.x * w.y - u.y * w.x;
      const primary = isPrimary(t.heading);
      expect(span).toBeCloseTo(primary ? 37.5 : 25 * Math.sqrt(3), 9);
      expect(lateral).toBeCloseTo((t.side === "left" ? 1 : -1) * (primary ? 2.5 * Math.sqrt(3) : 5), 9);
      expect(t.radiusMm).toBe(primary ? 82_272 : 95_000);
      expect(t.lengthMm).toBe(primary ? 37_832 : 43_685);
      for (const p of t.prims) expect(p.kind === "arc" && Math.abs(Math.abs(p.sweepRad) - SHIFT_ANGLE_RAD) < EPS).toBe(true);
    }
  });

  it("bounds every template's primitives", () => {
    for (const t of ALL) {
      for (const p of t.prims) {
        const samples = 64;
        for (let i = 0; i <= samples; i++) {
          const f = i / samples;
          const x = p.kind === "line" ? p.x0 + (p.x1 - p.x0) * f : p.cx + p.radiusM * Math.cos(p.startRad + p.sweepRad * f);
          const y = p.kind === "line" ? p.y0 + (p.y1 - p.y0) * f : p.cy + p.radiusM * Math.sin(p.startRad + p.sweepRad * f);
          expect(x).toBeGreaterThanOrEqual(t.boundsM.minX - EPS);
          expect(x).toBeLessThanOrEqual(t.boundsM.maxX + EPS);
          expect(y).toBeGreaterThanOrEqual(t.boundsM.minY - EPS);
          expect(y).toBeLessThanOrEqual(t.boundsM.maxY + EPS);
        }
      }
    }
  });

  it("keeps the integer template table stable (golden hash)", () => {
    const table = ALL.map((t) => [
      t.kind,
      t.heading,
      t.endHeading,
      t.dq,
      t.dr,
      t.lengthMm,
      t.speedLimitMms,
      t.kind === "curve" ? `${t.turn}:${t.radiusM}:${t.variant}` : t.kind === "shift" ? t.side : "",
    ]);
    expect(hashCanonical(table)).toBe(GOLDEN_TABLE_HASH);
  });
});

/**
 * Recorded 2026-09-26 when the generator landed (D2). A change means every
 * saved key's geometry moved, so re-record only deliberately, never casually.
 */
const GOLDEN_TABLE_HASH = "5565e541";

function straightTemplateLengths(): number[] {
  return [...new Set(STRAIGHT_TEMPLATES.map((t) => t.lengthMm))].sort((a, b) => a - b);
}
