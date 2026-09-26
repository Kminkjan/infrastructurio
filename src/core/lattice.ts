/**
 * Triangular construction lattice (ADR 0010, proposed).
 *
 * Nodes use axial integer coordinates (q, r). World space is metres, math
 * Y-up (x = east, y = north). Spacing a = 5 m puts parallel primary rows
 * a·√3/2 = 4.33 m apart, which is a double-track centre spacing.
 *
 * There are 12 headings at 30° intervals, numbered counter-clockwise from +x.
 * Even headings are primary steps (length a); odd headings are secondary
 * steps (length a·√3). Every step is an integer axial vector.
 *
 * No trigonometry: the unit vectors come from a table built on SQRT3, so
 * results are identical on every JavaScript engine.
 */

export const SQRT3 = 1.7320508075688772;
export const LATTICE_SPACING_M = 5;
export const LATTICE_SPACING_MM = 5000;

export type Heading = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export interface Axial {
  readonly q: number;
  readonly r: number;
}

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export const HEADINGS: readonly Heading[] = Object.freeze([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
]);

const STEPS: readonly Axial[] = Object.freeze(
  [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 2],
    [-1, 1],
    [-2, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -2],
    [1, -1],
    [2, -1],
  ].map(([q, r]) => Object.freeze({ q: q ?? 0, r: r ?? 0 })),
);

const HALF_SQRT3 = SQRT3 / 2;

const UNITS: readonly Vec2[] = Object.freeze(
  [
    [1, 0],
    [HALF_SQRT3, 0.5],
    [0.5, HALF_SQRT3],
    [0, 1],
    [-0.5, HALF_SQRT3],
    [-HALF_SQRT3, 0.5],
    [-1, 0],
    [-HALF_SQRT3, -0.5],
    [-0.5, -HALF_SQRT3],
    [0, -1],
    [0.5, -HALF_SQRT3],
    [HALF_SQRT3, -0.5],
  ].map(([x, y]) => Object.freeze({ x: x ?? 0, y: y ?? 0 })),
);

/** Converts a -0 result (from negation or rounding) to +0. */
function noNegativeZero(n: number): number {
  return n + 0;
}

export function axial(q: number, r: number): Axial {
  return Object.freeze({ q: noNegativeZero(q), r: noNegativeZero(r) });
}

export function isHeading(n: number): n is Heading {
  return Number.isInteger(n) && n >= 0 && n < 12;
}

export function normalizeHeading(n: number): Heading {
  const h = ((n % 12) + 12) % 12;
  if (!isHeading(h)) throw new RangeError(`invalid heading ${n}`);
  return h;
}

export function isPrimary(h: Heading): boolean {
  return h % 2 === 0;
}

/** Axial step vector for one lattice step along `h`. */
export function stepOf(h: Heading): Axial {
  const step = STEPS[h];
  if (!step) throw new RangeError(`invalid heading ${h}`);
  return step;
}

/** Length of one step along `h`, in integer millimetres (8660 for secondary). */
export function stepLengthMm(h: Heading): number {
  return isPrimary(h) ? LATTICE_SPACING_MM : 8660;
}

/** Unit direction vector of heading `h` in world space (math Y-up). */
export function unit(h: Heading): Vec2 {
  const u = UNITS[h];
  if (!u) throw new RangeError(`invalid heading ${h}`);
  return u;
}

export function opposite(h: Heading): Heading {
  return normalizeHeading(h + 6);
}

export function rotateHeading(h: Heading, steps30: number): Heading {
  return normalizeHeading(h + steps30);
}

/** Heading whose single step equals (dq, dr), or undefined if none does. */
export function headingOfStep(dq: number, dr: number): Heading | undefined {
  for (const h of HEADINGS) {
    const s = stepOf(h);
    if (s.q === dq && s.r === dr) return h;
  }
  return undefined;
}

export function add(a: Axial, b: Axial, times = 1): Axial {
  return axial(a.q + b.q * times, a.r + b.r * times);
}

export function equals(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r;
}

export function axialKey(a: Axial): string {
  return `${a.q},${a.r}`;
}

/** Rotates a node 60° counter-clockwise about the origin, `k` times. */
export function rotate60(a: Axial, k = 1): Axial {
  let { q, r } = a;
  const turns = ((k % 6) + 6) % 6;
  for (let i = 0; i < turns; i++) {
    const nq = 0 - r;
    const nr = q + r;
    q = nq;
    r = nr;
  }
  return axial(q, r);
}

/** Mirrors a node across the world x-axis (heading h maps to 12 - h). */
export function mirrorX(a: Axial): Axial {
  return axial(a.q + a.r, 0 - a.r);
}

/** World position of a lattice node, in metres. */
export function toWorld(a: Axial): Vec2 {
  return {
    x: LATTICE_SPACING_M * (a.q + a.r / 2),
    y: LATTICE_SPACING_M * a.r * HALF_SQRT3,
  };
}

/** Nearest lattice node to a world point in metres, via cube rounding. */
export function nearestNode(p: Vec2): Axial {
  const rf = p.y / (LATTICE_SPACING_M * HALF_SQRT3);
  const qf = p.x / LATTICE_SPACING_M - rf / 2;
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return axial(q, r);
}
