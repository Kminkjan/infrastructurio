import { describe, expect, it } from "vitest";
import { forAll, pick } from "../../../tests/support/forall";
import { randomSpec } from "../../../tests/support/trackGen";
import { HEADINGS } from "../lattice";
import {
  CLEARANCE_SAGITTA_M,
  type ClearanceShape,
  clearanceShape,
  createClearanceIndex,
  shapesTooClose,
} from "./clearance";
import { type Piece, type PieceSpec, resolvePiece } from "./piece";

function piece(spec: PieceSpec): Piece {
  const res = resolvePiece(spec);
  if (!res.ok) throw new Error(res.failure.message);
  return res.piece;
}

function straight(q: number, r: number, heading: 0 | 1 | 2 | 3, zMm = 0, z1Mm = zMm): Piece {
  return piece({ kind: "straight", from: { q, r, zMm }, heading, z1Mm });
}

interface Expected {
  readonly piece: string;
  readonly other: string;
  readonly distanceM: number;
}

/**
 * Brute force: the first new piece that clashes with a committed piece or an
 * earlier new one, paired with its closest partner (ties: the smaller key).
 */
function bruteForceConflict(existing: readonly ClearanceShape[], added: readonly ClearanceShape[]): Expected | null {
  for (let i = 0; i < added.length; i++) {
    const a = added[i] as ClearanceShape;
    let worst: Expected | null = null;
    for (const b of [...existing, ...added.slice(0, i)]) {
      const hit = shapesTooClose(a, b);
      if (!hit) continue;
      if (worst === null || hit.distanceM < worst.distanceM || (hit.distanceM === worst.distanceM && b.key < worst.other)) {
        worst = { piece: a.key, other: b.key, distanceM: hit.distanceM };
      }
    }
    if (worst) return worst;
  }
  return null;
}

describe("track clearance", () => {
  it("allows primary double track 4.33 m apart and rejects secondary lines 2.5 m apart", () => {
    const index = createClearanceIndex();
    index.insert(straight(0, 0, 0));
    expect(index.findConflict([straight(0, 1, 0)], new Set())).toBeNull();
    const secondary = createClearanceIndex();
    secondary.insert(straight(5, 5, 1));
    const hit = secondary.findConflict([straight(6, 5, 1)], new Set());
    expect(hit?.distanceM).toBeCloseTo(2.5, 9);
    expect([hit?.piece, hit?.other]).toEqual(["S:6,5,0:1:0", "S:5,5,0:1:0"]);
  });

  it("exempts pieces sharing a node, but not pieces over the same (q, r) at another height", () => {
    const a = clearanceShape(straight(0, 0, 0));
    const b = clearanceShape(straight(1, 0, 2));
    expect(shapesTooClose(a, b)).toBeNull();
    const low = clearanceShape(straight(0, 0, 2, 0));
    const near = clearanceShape(straight(0, 0, 0, 6499));
    const clear = clearanceShape(straight(0, 0, 0, 6500));
    expect(shapesTooClose(low, near)?.distanceM).toBe(0);
    expect(shapesTooClose(low, clear)).toBeNull();
  });

  it("compares heights where the tracks come close on a climb", () => {
    const flat = clearanceShape(straight(0, 1, 0, 0));
    // Directly above in plan, climbing: 6.4 m at the low end is too close, 6.5 m clears.
    expect(shapesTooClose(flat, clearanceShape(straight(0, 1, 0, 6400, 6600)))).not.toBeNull();
    expect(shapesTooClose(flat, clearanceShape(straight(0, 1, 0, 6500, 6700)))).toBeNull();
    expect(shapesTooClose(flat, clearanceShape(straight(0, 1, 0, -6500, -6600)))).toBeNull();
  });

  it("reports the closest clashing partner, not the smallest key", () => {
    // Found in review: a secondary piece from (12, 9) crosses S:11,10 at 0 m and
    // passes S:10,10 at 2.5 m; the reason used to quote the 2.5 m one.
    const index = createClearanceIndex();
    index.insert(straight(10, 10, 0));
    index.insert(straight(11, 10, 0));
    const hit = index.findConflict([straight(12, 9, 3)], new Set());
    expect([hit?.piece, hit?.other]).toEqual(["S:11,11,0:9:0", "S:11,10,0:0:0"]);
    expect(hit?.distanceM).toBeCloseTo(0, 9);
  });

  it("pads arcs by the sampling sagitta, so a curve is never judged clearer than it is", () => {
    const curve = clearanceShape(piece({ kind: "curve", from: { q: 0, r: 0, zMm: 0 }, heading: 0, turn: 3, radiusM: 360, variant: 0, z1Mm: 0 }));
    expect(curve.padM).toBe(CLEARANCE_SAGITTA_M);
    expect(clearanceShape(straight(0, 0, 0)).padM).toBe(0);
  });

  it("matches a brute-force full check on random layouts, incrementally with inserts and removals", () => {
    forAll(
      { seed: "clearance-incremental", runs: 25 },
      (prng) => prng,
      (prng) => {
        const index = createClearanceIndex();
        const committed = new Map<string, ClearanceShape>();
        let rejected = 0;
        for (let step = 0; step < 60; step++) {
          const count = 1 + prng.nextInt(3);
          const batch: Piece[] = [];
          for (let i = 0; i < count; i++) {
            const from = { q: prng.nextInt(40) - 20, r: prng.nextInt(40), zMm: pick(prng, [0, 0, 3000, 7000]) };
            batch.push(piece(randomSpec(prng, from, pick(prng, HEADINGS))));
          }
          const fresh = batch.filter((p, i) => !committed.has(p.key) && batch.findIndex((b) => b.key === p.key) === i);
          const ignored = new Set<string>();
          if (committed.size > 0 && prng.nextInt(4) === 0) ignored.add([...committed.keys()].sort()[prng.nextInt(committed.size)] ?? "");
          const existing = [...committed.values()].filter((s) => !ignored.has(s.key));
          const hit = index.findConflict(fresh, ignored);
          const brute = bruteForceConflict(existing, fresh.map(clearanceShape));
          expect(hit && { piece: hit.piece, other: hit.other, distanceM: hit.distanceM }).toEqual(brute);
          if (hit) {
            rejected += 1;
            continue;
          }
          for (const k of ignored) {
            index.remove(k);
            committed.delete(k);
          }
          for (const p of fresh) {
            index.insert(p);
            committed.set(p.key, clearanceShape(p));
          }
        }
        expect(index.size).toBe(committed.size);
        expect(rejected).toBeGreaterThan(0);
        expect(committed.size).toBeGreaterThan(5);
      },
    );
  });
});
