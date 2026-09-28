import { describe, expect, it } from "vitest";
import { type PieceSpec, resolvePiece } from "../../core/sim/api";
import { steepestDrawnFace } from "../../../tests/support/drawnFaces";
import { makeTerrain } from "../../../tests/support/makeTerrain";
import { type PieceInput, SIDE_SLOPE_RUN, conformTerrain } from "./earthworks";

/**
 * A second, higher ground track beside a first (PR #83 re-review, finding 1). Its fill overrides the first track's
 * cut ("cuts win" draws the cut), and the first track's reach was sized from the natural relief alone, so at that
 * reach the drawn ground jumped from the first track's cut up to the second track's fill: a near-vertical ledge, at
 * both LODs. The reach now also clears every neighbour's envelopes (`settleReaches`).
 */

function straight(q: number, r: number, zMm: number): PieceInput {
  const res = resolvePiece({ kind: "straight", from: { q, r, zMm }, heading: 0, z1Mm: zMm } as PieceSpec);
  if (!res.ok) throw new Error(res.failure.message);
  return { key: res.piece.key, prims: res.piece.prims, z0Mm: res.piece.ends[0].node.zMm, z1Mm: res.piece.ends[1].node.zMm };
}

/** 120 × 80 nodes, flat at 20 m. */
const flat = makeTerrain(120, 80, () => 200);

/** 16 straights east along row r at height zMm (x ≈ 120–200 m). */
function run(r: number, zMm: number): PieceInput[] {
  return Array.from({ length: 16 }, (_, i) => straight(24 - Math.floor(r / 2) + i, r, zMm));
}

/** The designed side slope, with room for the piecewise-linear sub-lattice and the smooth clamp's band. */
const MAX_FACE = (1 / SIDE_SLOPE_RUN) * 1.15;

describe("earthworks beside a second, higher ground track (PR #83 re-review)", () => {
  // Rows apart (4.33 m each) and the second track's height over the first, on flat ground at the first's height. The
  // review measured jumps of 2.64 m (3 rows, +6 m), 1.74 m (2, +5), 6.54 m (3, +10) and 3.79 m (4, +10).
  const cases = [
    { rows: 3, dzMm: 6000 },
    { rows: 2, dzMm: 5000 },
    { rows: 3, dzMm: 10_000 },
    { rows: 4, dzMm: 10_000 },
  ];
  for (const { rows, dzMm } of cases) {
    for (const lod of [0, 1] as const) {
      it(`${(rows * 2.5 * Math.sqrt(3)).toFixed(2)} m apart and ${dzMm / 1000} m higher, LOD${lod}: no drawn face steeper than the side slope`, () => {
        const field = conformTerrain(flat, { pieces: [...run(20, 20_000), ...run(20 + rows, 20_000 + dzMm)] }, lod);
        expect(field.triangles.size).toBeGreaterThan(0);
        const face = steepestDrawnFace(field);
        expect(face.slope, `steepest at (${face.x.toFixed(1)}, ${face.y.toFixed(1)})`).toBeLessThan(MAX_FACE);
      });
    }
  }
});
