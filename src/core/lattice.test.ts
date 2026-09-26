import { describe, expect, it } from "vitest";
import {
  HEADINGS,
  LATTICE_SPACING_M,
  add,
  axial,
  headingOfStep,
  isPrimary,
  mirrorX,
  nearestNode,
  normalizeHeading,
  opposite,
  rotate60,
  stepLengthMm,
  stepOf,
  toWorld,
  unit,
} from "./lattice";

const EPS = 1e-9;

describe("triangular lattice", () => {
  it("gives every heading an integer step whose direction is h × 30°", () => {
    for (const h of HEADINGS) {
      const step = stepOf(h);
      expect(Number.isInteger(step.q) && Number.isInteger(step.r)).toBe(true);
      const w = toWorld(step);
      const degrees = (Math.atan2(w.y, w.x) * 180) / Math.PI;
      const wrapped = ((((degrees - h * 30) % 360) + 540) % 360) - 180;
      expect(Math.abs(wrapped)).toBeLessThan(1e-9);
    }
  });

  it("uses 5 m primary and 5√3 m secondary steps with matching integer millimetres", () => {
    for (const h of HEADINGS) {
      const w = toWorld(stepOf(h));
      const length = Math.hypot(w.x, w.y);
      const expected = isPrimary(h) ? LATTICE_SPACING_M : LATTICE_SPACING_M * Math.sqrt(3);
      expect(Math.abs(length - expected)).toBeLessThan(EPS);
      expect(stepLengthMm(h)).toBe(Math.round(expected * 1000));
    }
  });

  it("keeps the unit table consistent with the step directions", () => {
    for (const h of HEADINGS) {
      const w = toWorld(stepOf(h));
      const length = Math.hypot(w.x, w.y);
      const u = unit(h);
      expect(Math.abs(u.x - w.x / length)).toBeLessThan(EPS);
      expect(Math.abs(u.y - w.y / length)).toBeLessThan(EPS);
    }
  });

  it("maps each step's heading h to h+2 when rotated 60°, returning to identity after six turns", () => {
    for (const h of HEADINGS) {
      const rotated = rotate60(stepOf(h));
      expect(headingOfStep(rotated.q, rotated.r)).toBe(normalizeHeading(h + 2));
      const back = rotate60(stepOf(h), 6);
      expect(back).toEqual(stepOf(h));
    }
    expect(rotate60(axial(3, -2), -1)).toEqual(rotate60(axial(3, -2), 5));
  });

  it("mirrors heading h to 12 - h across the x-axis", () => {
    for (const h of HEADINGS) {
      const m = mirrorX(stepOf(h));
      expect(headingOfStep(m.q, m.r)).toBe(normalizeHeading(12 - h));
    }
  });

  it("returns opposite headings with negated steps", () => {
    for (const h of HEADINGS) {
      const s = stepOf(h);
      const o = stepOf(opposite(h));
      expect(o).toEqual(axial(-s.q, -s.r));
    }
  });

  it("never produces negative zero coordinates", () => {
    expect(Object.is(rotate60(axial(0, 0)).q, -0)).toBe(false);
    expect(Object.is(mirrorX(axial(2, 0)).r, -0)).toBe(false);
    expect(Object.is(nearestNode({ x: -0.4, y: 0.1 }).q, -0)).toBe(false);
  });

  it("snaps world points back to their node, including jitter inside the Voronoi cell", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let q = -6; q <= 6; q++) {
      for (let r = -6; r <= 6; r++) {
        const node = axial(q, r);
        const w = toWorld(node);
        expect(nearestNode(w)).toEqual(node);
        const angle = rand() * Math.PI * 2;
        const radius = rand() * 0.49 * LATTICE_SPACING_M * (Math.sqrt(3) / 2);
        const jittered = { x: w.x + Math.cos(angle) * radius, y: w.y + Math.sin(angle) * radius };
        expect(nearestNode(jittered)).toEqual(node);
      }
    }
  });

  it("adds steps along a heading", () => {
    expect(add(axial(2, 3), stepOf(1), 4)).toEqual(axial(6, 7));
  });
});
