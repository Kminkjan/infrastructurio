/**
 * Index arithmetic for the terrain's offset-row layout (core `terrain.ts`:
 * row = r, col = q + floor(r/2), index = row·columns + col), done directly so
 * mesh building and shading never allocate an `Axial` per node. The tests pin
 * these tables to the core's `nodeOfOffset`/`offsetOfNode`.
 */

/** Terrain LOD: 0 = every node (5 m), 1 = every other node (10 m). */
export type TerrainLod = 0 | 1;

/**
 * The six primary neighbours as (dCol, dRow), in heading order 0, 2, 4, 6, 8,
 * 10 (E, NE, NW, W, SW, SE). Odd rows sit half a step east, so their diagonal
 * neighbours are one column further east than an even row's.
 */
const EVEN_ROW_NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
];
const ODD_ROW_NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, -1],
];

/** Lattice heading (0, 2, …, 10) of neighbour slot `i` (0..5). */
export function neighbourHeading(i: number): 0 | 2 | 4 | 6 | 8 | 10 {
  return (2 * i) as 0 | 2 | 4 | 6 | 8 | 10;
}

/** Index of neighbour slot `i` (0..5) of (col, row), or −1 outside the map. */
export function neighbourIndex(columns: number, rows: number, col: number, row: number, i: number): number {
  const delta = ((row & 1) === 0 ? EVEN_ROW_NEIGHBOURS : ODD_ROW_NEIGHBOURS)[i];
  if (!delta) return -1;
  const c = col + delta[0];
  const r = row + delta[1];
  return c < 0 || c >= columns || r < 0 || r >= rows ? -1 : r * columns + c;
}

/**
 * Vertex grid of a LOD in its own (i, j) coordinates. LOD1 keeps even rows and,
 * in LOD row j, the columns 2i + (j & 1): the sub-lattice with q and r both
 * even, i.e. the same triangular lattice at 10 m, itself in offset-row layout.
 * Its column count fits both row parities, so it drops at most the last 5–10 m
 * of the east edge and the last row when `rows` is even.
 */
export function lodGridSize(columns: number, rows: number, lod: TerrainLod): { columns: number; rows: number } {
  if (lod === 0) return { columns, rows };
  return { columns: Math.floor((columns - 2) / 2) + 1, rows: Math.floor((rows - 1) / 2) + 1 };
}

/** Terrain column of LOD vertex (i, j). */
export function lodCol(lod: TerrainLod, i: number, j: number): number {
  return lod === 0 ? i : 2 * i + (j & 1);
}

/** Terrain row of LOD vertex (i, j). */
export function lodRow(lod: TerrainLod, j: number): number {
  return lod === 0 ? j : 2 * j;
}

/**
 * Calls `emit` with the (i, j) corners of every lattice triangle whose
 * vertices lie in [i0, i1] × [j0, j1], counter-clockwise in plan view (sim x
 * east, y north), so their normals point up.
 *
 * Between rows j and j + 1 each column step holds one up- and one
 * down-pointing triangle. Which corners they use depends on the parity of
 * row j, because odd rows are shifted half a step east; using the same
 * diagonal on every row would create non-lattice (isosceles) triangles.
 */
export function forEachLatticeTriangle(
  i0: number,
  i1: number,
  j0: number,
  j1: number,
  emit: (ai: number, aj: number, bi: number, bj: number, ci: number, cj: number) => void,
): void {
  for (let j = j0; j < j1; j++) {
    const even = (j & 1) === 0;
    for (let i = i0; i < i1; i++) {
      if (even) {
        emit(i, j, i + 1, j, i, j + 1);
        emit(i + 1, j, i + 1, j + 1, i, j + 1);
      } else {
        emit(i, j, i + 1, j, i + 1, j + 1);
        emit(i, j, i + 1, j + 1, i, j + 1);
      }
    }
  }
}
