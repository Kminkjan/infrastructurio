import { type Terrain, nodeOfOffset } from "../../src/core/terrain";

/**
 * Hand-built terrains for render tests. `Terrain` is plain data, so tests can
 * shape exact heights instead of depending on the generator's output.
 */
export function makeTerrain(
  columns: number,
  rows: number,
  heightDm: (q: number, r: number, col: number, row: number) => number,
  waterLevelDm = 100,
): Terrain {
  const heightsDm = new Int16Array(columns * rows);
  const water = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const { q, r } = nodeOfOffset(col, row);
      const h = Math.round(heightDm(q, r, col, row));
      heightsDm[row * columns + col] = h;
      water[row * columns + col] = h < waterLevelDm ? 1 : 0;
    }
  }
  return { seed: "test", generatorVersion: 1, columns, rows, waterLevelDm, heightsDm, water };
}
