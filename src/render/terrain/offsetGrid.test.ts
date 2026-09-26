import { describe, expect, it } from "vitest";
import { axial, stepOf, toWorld } from "../../core/lattice";
import { type Terrain, nodeOfOffset, offsetOfNode } from "../../core/terrain";
import { forEachLatticeTriangle, lodCol, lodGridSize, lodRow, neighbourHeading, neighbourIndex } from "./offsetGrid";

/** Only the size matters to offsetOfNode. */
function sizeOnly(columns: number, rows: number): Terrain {
  return { seed: "", generatorVersion: 1, columns, rows, waterLevelDm: 100, heightsDm: new Int16Array(0), water: new Uint8Array(0) };
}

describe("offset grid", () => {
  it("matches the core's axial neighbours on even and odd rows", () => {
    const columns = 9;
    const rows = 8;
    const t = sizeOnly(columns, rows);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const node = nodeOfOffset(col, row);
        for (let i = 0; i < 6; i++) {
          const step = stepOf(neighbourHeading(i));
          const expected = offsetOfNode(t, axial(node.q + step.q, node.r + step.r));
          const index = neighbourIndex(columns, rows, col, row, i);
          expect(index).toBe(expected === undefined ? -1 : expected.row * columns + expected.col);
        }
      }
    }
  });

  it("maps LOD1 onto the 10 m sub-lattice with even q and r", () => {
    const { columns, rows } = lodGridSize(400, 346, 1);
    expect(columns).toBe(200);
    expect(rows).toBe(173);
    for (let j = 0; j < 6; j++) {
      for (let i = 0; i < 6; i++) {
        const node = nodeOfOffset(lodCol(1, i, j), lodRow(1, j));
        expect(Math.abs(node.q % 2)).toBe(0);
        expect(Math.abs(node.r % 2)).toBe(0);
      }
    }
    // Every LOD1 vertex stays on the map for both row parities.
    expect(lodCol(1, columns - 1, 1)).toBeLessThanOrEqual(399);
    expect(lodRow(1, rows - 1)).toBeLessThanOrEqual(345);
    expect(lodGridSize(2, 2, 1)).toEqual({ columns: 1, rows: 1 });
  });

  it("emits only equilateral, counter-clockwise lattice triangles at both LODs", () => {
    for (const lod of [0, 1] as const) {
      const spacing = lod === 0 ? 5 : 10;
      let count = 0;
      forEachLatticeTriangle(0, 6, 0, 5, (ai, aj, bi, bj, ci, cj) => {
        const [a, b, c] = [
          toWorld(nodeOfOffset(lodCol(lod, ai, aj), lodRow(lod, aj))),
          toWorld(nodeOfOffset(lodCol(lod, bi, bj), lodRow(lod, bj))),
          toWorld(nodeOfOffset(lodCol(lod, ci, cj), lodRow(lod, cj))),
        ];
        for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
          expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeCloseTo(spacing, 9);
        }
        const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        expect(cross).toBeGreaterThan(0);
        count++;
      });
      expect(count).toBe(2 * 6 * 5);
    }
  });
});
