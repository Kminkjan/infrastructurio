import { describe, expect, it } from "vitest";
import { forAll, pick } from "../../../tests/support/forall";
import { randomSpec } from "../../../tests/support/trackGen";
import { HEADINGS, opposite, toWorld } from "../lattice";
import {
  type PieceSpec,
  Z_LIMIT_MM,
  canonicalKey,
  compareNodes,
  formatKey,
  parseKey,
  pieceFromKey,
  resolvePiece,
} from "./piece";
import type { RadiusClassM, Turn } from "./templates";

function resolved(spec: PieceSpec) {
  const res = resolvePiece(spec);
  if (!res.ok) throw new Error(res.failure.message);
  return res.piece;
}

/** The same piece described from its other end. */
function fromOtherEnd(spec: PieceSpec): PieceSpec {
  const p = resolved(spec);
  const [a, b] = p.ends;
  const startIsA = a.node.q === spec.from.q && a.node.r === spec.from.r && a.node.zMm === spec.from.zMm;
  const far = startIsA ? b : a;
  const heading = far.outward;
  const z1Mm = spec.from.zMm;
  if (spec.kind === "straight") return { kind: "straight", from: far.node, heading, z1Mm };
  if (spec.kind === "shift") return { kind: "shift", from: far.node, heading, side: spec.side, z1Mm };
  return { kind: "curve", from: far.node, heading, turn: (0 - spec.turn) as Turn, radiusM: spec.radiusM, variant: spec.variant, z1Mm };
}

describe("pieces and canonical keys", () => {
  it("formats the three key shapes with z in mm", () => {
    expect(formatKey({ kind: "straight", from: { q: 3, r: -2, zMm: 1200 }, heading: 0, z1Mm: 1375 })).toBe("S:3,-2,1200:0:1375");
    expect(formatKey({ kind: "curve", from: { q: 0, r: 0, zMm: 0 }, heading: 1, turn: -2, radiusM: 90, variant: 2, z1Mm: 0 })).toBe(
      "C:0,0,0:1:-2:90:2:0",
    );
    expect(formatKey({ kind: "shift", from: { q: 5, r: 5, zMm: -300 }, heading: 6, side: "left", z1Mm: -300 })).toBe(
      "H:5,5,-300:6:left:-300",
    );
  });

  it("gives the same key from either end", () => {
    forAll(
      { seed: "piece-either-end", runs: 400 },
      (prng) => randomSpec(prng, { q: prng.nextInt(40) - 20, r: prng.nextInt(40) - 20, zMm: pick(prng, [0, 500, -250]) }, pick(prng, HEADINGS)),
      (spec) => {
        const back = fromOtherEnd(spec);
        expect(canonicalKey(back)).toBe(canonicalKey(spec));
        const p = resolved(spec);
        expect(compareNodes(p.ends[0].node, p.ends[1].node)).toBeLessThan(0);
      },
    );
  });

  it("round-trips keys through parse and format", () => {
    forAll(
      { seed: "piece-key-roundtrip", runs: 300 },
      (prng) => randomSpec(prng, { q: prng.nextInt(60) - 30, r: prng.nextInt(60) - 30, zMm: prng.nextInt(20_000) - 10_000 }, pick(prng, HEADINGS)),
      (spec) => {
        const key = formatKey(spec);
        expect(parseKey(key)).toEqual(spec);
        const canonical = resolved(spec).key;
        const again = parseKey(canonical);
        expect(again && formatKey(again)).toBe(canonical);
        expect(pieceFromKey(canonical)?.key).toBe(canonical);
      },
    );
    for (const bad of ["", "S:1,2,3:0", "S:01,2,3:0:3", "S:-0,2,3:0:3", "S:1,2,3:12:3", "C:0,0,0:0:0:60:0:0", "C:0,0,0:0:4:60:0:0",
      "C:0,0,0:0:1:50:0:0", "H:0,0,0:0:up:0", "X:0,0,0:0:0", "S:1.5,2,3:0:3", "S:9007199254740993,0,0:0:0"]) {
      expect(parseKey(bad), bad).toBeUndefined();
    }
  });

  it("gives different keys at different z, so nodes at different heights never share a key", () => {
    const low = resolved({ kind: "straight", from: { q: 0, r: 0, zMm: 0 }, heading: 0, z1Mm: 0 });
    const high = resolved({ kind: "straight", from: { q: 0, r: 0, zMm: 7000 }, heading: 0, z1Mm: 7000 });
    const ramp = resolved({ kind: "straight", from: { q: 0, r: 0, zMm: 0 }, heading: 0, z1Mm: 175 });
    expect(new Set([low.key, high.key, ramp.key]).size).toBe(3);
    expect(low.ends[1].node).not.toEqual(high.ends[1].node);
  });

  it("normalises a piece written from its larger end and swaps z0 and z1", () => {
    const p = resolved({ kind: "straight", from: { q: 4, r: 0, zMm: 175 }, heading: 6, z1Mm: 0 });
    expect(p.key).toBe("S:3,0,0:0:175");
    expect(p.ends.map((e) => e.outward)).toEqual([0, 6]);
    expect(p.gradePermille).toEqual({ num: 35, den: 1 });
  });

  it("carries both ends with outward headings, exact grade and world primitives", () => {
    const spec: PieceSpec = { kind: "curve", from: { q: 10, r: 4, zMm: 0 }, heading: 0, turn: 2, radiusM: 60, variant: 0, z1Mm: 1000 };
    const p = resolved(spec);
    expect(p.ends[0]).toEqual({ node: { q: 10, r: 4, zMm: 0 }, outward: 0 });
    expect(p.ends[1].outward).toBe(opposite(2));
    expect(p.gradePermille.num * p.lengthMm).toBe(1000 * 1000 * p.gradePermille.den);
    expect(p.radiusClassM).toBe(60);
    expect(p.radiusMm).toBe(60_000);
    expect(p.speedLimitMms).toBe(6944);
    const origin = toWorld({ q: 10, r: 4 });
    const first = p.prims[0];
    expect(first?.kind === "line" && [first.x0, first.y0]).toEqual([origin.x, origin.y]);
    expect(p.boundsM.minX).toBeCloseTo(origin.x, 9);
    expect(Object.isFrozen(p) && Object.isFrozen(p.prims) && Object.isFrozen(p.ends[0].node)).toBe(true);
  });

  it("fails malformed specs with the catalogue's geometry and structural codes, never throwing", () => {
    const from = { q: 0, r: 0, zMm: 0 };
    const code = (spec: unknown) => {
      const res = resolvePiece(spec as PieceSpec);
      return res.ok ? "ok" : res.failure.code;
    };
    expect(code({ kind: "curve", from, heading: 0, turn: 1, radiusM: 50 as RadiusClassM, variant: 0, z1Mm: 0 })).toBe("radius-too-tight");
    expect(code({ kind: "curve", from, heading: 0, turn: 1, radiusM: 100 as RadiusClassM, variant: 0, z1Mm: 0 })).toBe("radius-too-tight");
    expect(code({ kind: "curve", from, heading: 0, turn: 4 as Turn, radiusM: 60, variant: 0, z1Mm: 0 })).toBe("turn-too-sharp");
    expect(code({ kind: "curve", from, heading: 0, turn: 4 as Turn, radiusM: 50 as RadiusClassM, variant: 0, z1Mm: 0 })).toBe(
      "radius-too-tight",
    );
    expect(code({ kind: "curve", from, heading: 0, turn: 1, radiusM: 60, variant: 1, z1Mm: 0 })).toBe("no-fit");
    expect(code({ kind: "curve", from, heading: 0, turn: 0 as Turn, radiusM: 60, variant: 0, z1Mm: 0 })).toBe("no-fit");
    expect(code({ kind: "straight", from, heading: 12, z1Mm: 0 })).toBe("no-fit");
    expect(code({ kind: "spiral", from, heading: 0, z1Mm: 0 })).toBe("no-fit");
    expect(code({ kind: "shift", from, heading: 0, side: "up", z1Mm: 0 })).toBe("no-fit");
    expect(code({ kind: "straight", from: { q: 0.5, r: 0, zMm: 0 }, heading: 0, z1Mm: 0 })).toBe("out-of-bounds");
    expect(code({ kind: "straight", from, heading: 0, z1Mm: 0.5 })).toBe("out-of-bounds");
    expect(code(null)).toBe("no-fit");
    const res = resolvePiece({ kind: "curve", from, heading: 0, turn: 4 as Turn, radiusM: 60, variant: 0, z1Mm: 0 });
    expect(!res.ok && res.failure.message).toMatch(/120° turn .*; split it into two bends\./);
  });

  it("bounds node heights to ±10 km, so the grade stays an exact rational of safe integers", () => {
    const from = { q: 0, r: 0, zMm: 0 };
    const atLimit = resolved({ kind: "straight", from, heading: 0, z1Mm: Z_LIMIT_MM });
    expect(atLimit.gradePermille).toEqual({ num: 2_000_000, den: 1 });
    // The worst rise (−10 km → +10 km) on the longest template; checked in BigInt,
    // since num × lengthMm itself would pass 2^53.
    const steep = resolved({ kind: "curve", from: { q: 0, r: 0, zMm: -Z_LIMIT_MM }, heading: 1, turn: 3, radiusM: 360, variant: 1, z1Mm: Z_LIMIT_MM });
    const { num, den } = steep.gradePermille;
    expect(Number.isSafeInteger(num) && Number.isSafeInteger(den)).toBe(true);
    const riseMm = steep.ends[1].node.zMm - steep.ends[0].node.zMm;
    expect(BigInt(num) * BigInt(steep.lengthMm)).toBe(BigInt(riseMm) * 1000n * BigInt(den));
    expect(Math.abs(riseMm)).toBe(2 * Z_LIMIT_MM);
    for (const spec of [
      { kind: "straight", from, heading: 0, z1Mm: Z_LIMIT_MM + 1 },
      { kind: "straight", from: { q: 0, r: 0, zMm: -Z_LIMIT_MM - 1 }, heading: 0, z1Mm: 0 },
      // Found in review: this used to resolve with a numerator past 2^53.
      { kind: "straight", from, heading: 0, z1Mm: Number.MAX_SAFE_INTEGER },
    ] as const) {
      const res = resolvePiece(spec);
      expect(!res.ok && res.failure.code).toBe("out-of-bounds");
      expect(!res.ok && res.failure.message).toMatch(/±10 km .*; keep the track within 10 km of height 0\.$/);
    }
    expect(pieceFromKey(`S:0,0,0:0:${Z_LIMIT_MM + 1}`)).toBeUndefined();
  });
});
