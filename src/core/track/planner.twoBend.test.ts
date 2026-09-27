import { describe, expect, it } from "vitest";
import { CURVE_TURNS } from "../geometry/templates";
import { type Axial, type Heading, rotateHeading, stepLengthMm, stepOf } from "../lattice";
import { solveThree } from "./planner";

/**
 * The straights of a two-bend fit, x·a + y·b + z·c = D with x, y, z ≥ 0,
 * against a brute-force oracle (review of PR #82: with three secondary
 * headings every y is feasible, and stepping by |det(a, c)| missed the end
 * of the interval). Kept apart from `planner.test.ts` so the drag table
 * there can change without touching this file.
 */

type Triple = readonly [number, number, number];

interface Setup {
  readonly a: Axial;
  readonly la: number;
  readonly b: Axial;
  readonly lb: number;
  readonly c: Axial;
  readonly lc: number;
}

function setup(d0: Heading, dm: Heading, de: Heading): Setup {
  return { a: stepOf(d0), la: stepLengthMm(d0), b: stepOf(dm), lb: stepLengthMm(dm), c: stepOf(de), lc: stepLengthMm(de) };
}

const lengthOf = (s: Setup, t: Triple): number => t[0] * s.la + t[1] * s.lb + t[2] * s.lc;

/**
 * Every shortest non-negative solution, by enumeration: for each y up to 200,
 * x and z are the exact solution of a 2 × 2 system; with c parallel to a,
 * every (x, y) up to 60 is tried and z follows. Offsets within 10 steps need
 * far less than either bound.
 */
function shortest(s: Setup, D: Axial): Triple[] {
  const g = s.a.q * s.c.r - s.a.r * s.c.q;
  let best: Triple[] = [];
  let bestLength = Infinity;
  const consider = (t: Triple): void => {
    if (t[0] < 0 || t[1] < 0 || t[2] < 0) return;
    if (t[0] * s.a.q + t[1] * s.b.q + t[2] * s.c.q !== D.q || t[0] * s.a.r + t[1] * s.b.r + t[2] * s.c.r !== D.r) return;
    const l = lengthOf(s, t);
    if (l < bestLength) {
      bestLength = l;
      best = [t];
    } else if (l === bestLength) {
      best.push(t);
    }
  };
  const maxY = g !== 0 ? 200 : 60;
  for (let y = 0; y <= maxY; y++) {
    const rq = D.q - y * s.b.q;
    const rr = D.r - y * s.b.r;
    if (g !== 0) {
      const xn = rq * s.c.r - rr * s.c.q;
      const zn = s.a.q * rr - s.a.r * rq;
      if (xn % g === 0 && zn % g === 0) consider([xn / g + 0, y, zn / g + 0]);
    } else {
      for (let x = 0; x <= 60; x++) {
        const zq = rq - x * s.a.q;
        const zr = rr - x * s.a.r;
        const z = s.c.q !== 0 ? zq / s.c.q : zr / s.c.r;
        if (Number.isInteger(z)) consider([x, y, z + 0]);
      }
    }
  }
  return best;
}

const key = (t: Triple): string => t.join(",");

describe("two-bend straights (solveThree)", () => {
  it("finds the shortest fit for a 60° + 60° join between secondary headings (the review's cases)", () => {
    // Headings 1 → 3 → 5: a = (1, 1), b = (−1, 2), c = (−2, 1); det(a, c) = 3 and a + c = b.
    const s = setup(1, 3, 5);
    const cases: readonly [number, number, Triple][] = [
      [5, 5, [0, 5, 0]],
      [4, 4, [0, 4, 0]],
      [7, 7, [0, 7, 0]],
      [3, 5, [0, 3, 2]],
    ];
    for (const [x, z, want] of cases) {
      const D = { q: x * s.a.q + z * s.c.q, r: x * s.a.r + z * s.c.r };
      expect(solveThree(s.a, s.la, s.b, s.lb, s.c, s.lc, D), `D = ${x}a + ${z}c`).toEqual([want]);
      expect(shortest(s, D).map(key)).toEqual([key(want)]);
    }
  });

  it("agrees with brute force for every turn pair and every offset within 10 steps", () => {
    // A primary and a secondary start heading: a 60° turn maps the lattice onto itself, so they cover the rest.
    let solved = 0;
    for (const d0 of [0, 1] as const) {
      for (const turn1 of CURVE_TURNS) {
        const dm = rotateHeading(d0, turn1);
        for (const turn2 of CURVE_TURNS) {
          const de = rotateHeading(dm, turn2);
          const s = setup(d0, dm, de);
          const same = de === d0;
          for (let q = -10; q <= 10; q++) {
            for (let r = -10; r <= 10; r++) {
              const D = { q, r };
              const got = solveThree(s.a, s.la, s.b, s.lb, s.c, s.lc, D);
              const want = shortest(s, D);
              const where = `headings ${d0} → ${dm} → ${de}, D = (${q}, ${r})`;
              if (want.length === 0) {
                expect(got, where).toEqual([]);
                continue;
              }
              solved += 1;
              const wantLength = lengthOf(s, want[0] ?? [0, 0, 0]);
              const wanted = new Set(want.map(key));
              for (const t of got) {
                expect(wanted.has(key(t)), `${where}: ${key(t)} is not a shortest solution`).toBe(true);
                expect(lengthOf(s, t)).toBe(wantLength);
              }
              if (same) {
                // An S-bend back onto the start heading fixes only x + z: bends first and bends last.
                const k = Math.max(...want.map((t) => t[0]));
                const placements = k === 0 ? [[0, want[0]?.[1], 0]] : [[0, want[0]?.[1], k], [k, want[0]?.[1], 0]];
                expect(got, where).toEqual(placements);
              } else {
                // Otherwise one solution: the fewest straights before the first bend among the shortest.
                const lead = Math.min(...want.map((t) => t[0]));
                expect(got.map(key), where).toEqual(want.filter((t) => t[0] === lead).map(key));
              }
            }
          }
        }
      }
    }
    // Guards against a degenerate sweep (8,378 solvable cases when written).
    expect(solved).toBeGreaterThan(5_000);
  });
});
