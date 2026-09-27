import { SQRT3 } from "../../core/sim/api";
import { EARTHWORK_ITEM_SIZE } from "../art/shaderChunks/earthwork";
import { type ChunkPass, EARTHWORK_MIN_M, REFINE, SUB_VERTS, forEachChunkTriangle, lodNodeIndex, subAxial, triangleCorners } from "./earthworks";
import { type MeshData, buildChunkData } from "./terrainGeometry";
import type { TerrainShading } from "./terrainShading";
import { smoothstep } from "../math";

/**
 * Chunk geometry with earthworks (see `earthworks.ts`): the plain chunk mesh,
 * with each refined lattice triangle replaced by its 16 sub-triangles and
 * each plain triangle beside one replaced by a fan through the refined
 * edge's vertices. A vertex the conform left natural keeps the plain mesh's
 * colour and normal (barycentric where it is new), so a refined or fanned
 * triangle that did not move looks exactly like the plain one. A moved
 * vertex's normal is the smooth natural normal tilted by the departure's
 * least-squares gradient over its six sub-lattice neighbours, and its colour
 * blends toward the dry recipe (`TerrainShading.dryColors`, no shore soil) as
 * it moves (render pass iteration, 2026-09-27). The vec3 `earthwork` attribute
 * (encoded potential, signed departure, distance to the centreline;
 * `ChunkPass.attributesAt`) drives the terrain shader's earthwork colours
 * (`shaderChunks/earthwork.ts`). Plain corners that refined triangles reuse
 * carry their true attribute too, so the colour interpolates correctly up to
 * them; plain vertices elsewhere keep zeros, which the shader reads as natural
 * ground, and so do fans, whose edge vertices the rule never moves.
 */

export interface EarthworkMeshData extends MeshData {
  /** Per vertex, EARTHWORK_ITEM_SIZE floats: the `earthwork` attribute (zeros on natural ground). */
  readonly earthwork: Float32Array;
}

const HALF_SQRT3 = SQRT3 / 2;
/** Made ground takes the dry colour (`TerrainShading.dryColors`) in full once it moved this far. */
export const DRY_FULL_M = 0.6;
/** Sub-lattice neighbour steps (dQs, dRs) and their plan unit vectors, headings 0, 2, …, 10: dq, dr, ux, uy per row. */
const NEIGHBOURS = new Float64Array([1, 0, 1, 0, 0, 1, 0.5, HALF_SQRT3, -1, 1, -0.5, HALF_SQRT3, -1, 0, -1, 0, 0, -1, -0.5, -HALF_SQRT3, 1, -1, 0.5, -HALF_SQRT3]);

// Reused between builds: vertex ids of sub-lattice grid points in the current build (stamped, so never cleared).
let slotId = new Int32Array(0);
let slotStamp = new Uint32Array(0);
let stamp = 0;

/**
 * Builds chunk geometry from a finished pass; a chunk without earthworks equals
 * the plain chunk exactly. `base`, when given, must be that plain chunk
 * (`buildChunkData` for the pass's chunk and LOD); callers that rebuild a chunk
 * often keep it, since it never changes.
 */
export function buildEarthworkChunk(pass: ChunkPass, shading: TerrainShading, plain?: MeshData): EarthworkMeshData {
  const t = pass.terrain;
  const lat = pass.lat;
  const base = plain ?? buildChunkData(t, shading, pass.chunkX, pass.chunkY, lat.lod);
  const baseCount = base.positions.length / 3;
  const { refined, fans } = pass.stats;
  if (refined === 0 && fans === 0) return { ...base, earthwork: new Float32Array(baseCount * EARTHWORK_ITEM_SIZE) };

  const k = REFINE;
  const sub = lat.spacingM / k;
  const across = pass.i1 - pass.i0 + 1;
  const baseIndex = (Q: number, R: number) => (R - pass.j0) * across + (Q + Math.floor(R / 2) - pass.i0);

  // Capacity: every refined triangle's sub-vertices, and per fan its centre and three split edges.
  const capacity = baseCount + refined * SUB_VERTS + fans * (1 + 3 * (k - 1));
  const positions = new Float32Array(capacity * 3);
  const normals = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const earthwork = new Float32Array(capacity * EARTHWORK_ITEM_SIZE);
  positions.set(base.positions);
  normals.set(base.normals);
  colors.set(base.colors);
  const indexCapacity = base.indices.length + refined * (k * k - 1) * 3 + fans * 3 * (3 * k);
  const idx = new Uint32Array(indexCapacity);
  let ni = 0;
  let count = baseCount;

  const gridSize = pass.gridSize;
  if (slotId.length < gridSize) {
    slotId = new Int32Array(gridSize);
    slotStamp = new Uint32Array(gridSize);
    stamp = 0;
  }
  stamp += 1;
  if (stamp === 0xffffffff) {
    slotStamp.fill(0);
    stamp = 1;
  }

  const s = { qs: 0, rs: 0 };
  const corners = [0, 0, 0, 0, 0, 0];
  let n0 = -1;
  let n1 = -1;
  let n2 = -1;
  let w0 = 0;
  let w1 = 0;
  let w2 = 0;

  /** The natural LOD triangle holding sub-vertex (qs, rs) and its barycentric weights (zero-weight corners may be −1). */
  const naturalFrame = (qs: number, rs: number): void => {
    const Q = Math.floor(qs / k);
    const R = Math.floor(rs / k);
    const a = qs - k * Q;
    const b = rs - k * R;
    if (a + b <= k) {
      n0 = lodNodeIndex(t, lat, Q, R);
      n1 = lodNodeIndex(t, lat, Q + 1, R);
      n2 = lodNodeIndex(t, lat, Q, R + 1);
      w0 = 1 - (a + b) / k;
      w1 = a / k;
      w2 = b / k;
    } else {
      n0 = lodNodeIndex(t, lat, Q + 1, R + 1);
      n1 = lodNodeIndex(t, lat, Q, R + 1);
      n2 = lodNodeIndex(t, lat, Q + 1, R);
      w0 = 1 - (2 * k - a - b) / k;
      w1 = (k - a) / k;
      w2 = (k - b) / k;
    }
  };
  const blend = (source: Float32Array, axis: number): number => {
    let v = 0;
    if (w0 !== 0 && n0 >= 0) v += w0 * (source[3 * n0 + axis] ?? 0);
    if (w1 !== 0 && n1 >= 0) v += w1 * (source[3 * n1 + axis] ?? 0);
    if (w2 !== 0 && n2 >= 0) v += w2 * (source[3 * n2 + axis] ?? 0);
    return v;
  };

  /** The vertex at sub-lattice (qs, rs), shared by every triangle that meets it. */
  const vertexAt = (qs: number, rs: number): number => {
    const g = pass.gridIndex(qs, rs);
    if (g >= 0 && slotStamp[g] === stamp) return slotId[g] ?? 0;
    const id = count++;
    if (g >= 0) {
      slotStamp[g] = stamp;
      slotId[g] = id;
    }
    const drawn = pass.drawnAt(qs, rs);
    positions[3 * id] = sub * (qs + rs / 2);
    positions[3 * id + 1] = drawn;
    positions[3 * id + 2] = -(sub * rs * HALF_SQRT3);
    naturalFrame(qs, rs);
    let nx = blend(shading.normals, 0);
    let ny = blend(shading.normals, 1);
    let nz = blend(shading.normals, 2);
    let len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    // The drawn surface is the natural one plus the departure D = C − N, so its normal is the smooth natural
    // normal tilted by D's least-squares gradient over the six neighbours, (Σ u·ΔD) / (3·spacing). D is smooth
    // and exactly 0 on natural ground, so the normals stay continuous across the lip; the 5 m lattice facets
    // a raw drawn-surface normal would carry never enter it (the relief chunk's slope gain magnifies those).
    const d0 = pass.departureAt(qs, rs);
    let gx = 0;
    let gy = 0;
    for (let i = 0; i < 24; i += 4) {
      const dd = pass.departureAt(qs + (NEIGHBOURS[i] ?? 0), rs + (NEIGHBOURS[i + 1] ?? 0)) - d0;
      gx += (NEIGHBOURS[i + 2] ?? 0) * dd;
      gy += (NEIGHBOURS[i + 3] ?? 0) * dd;
    }
    if (gx !== 0 || gy !== 0) {
      // World surface y = f(x, z) has n ∝ (−f_x, 1, −f_z); sim (x, y) → world (x, −z), so D_x = gx and D_z = −gy.
      const s0 = 1 / Math.max(ny, 1e-3);
      nx = nx * s0 - gx / (3 * sub);
      nz = nz * s0 + gy / (3 * sub);
      ny = 1;
      len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
    }
    normals[3 * id] = nx;
    normals[3 * id + 1] = ny;
    normals[3 * id + 2] = nz;
    // Made ground blends toward the colour without the shore soil (and never the underwater bed's), as it moves.
    const dry = smoothstep(EARTHWORK_MIN_M, DRY_FULL_M, Math.abs(d0));
    for (let axis = 0; axis < 3; axis++) {
      const natural = blend(shading.colors, axis);
      colors[3 * id + axis] = dry > 0 ? natural + (blend(shading.dryColors, axis) - natural) * dry : natural;
    }
    pass.attributesAt(qs, rs, earthwork, EARTHWORK_ITEM_SIZE * id);
    return id;
  };

  const setCorners = (Q: number, R: number, up: 0 | 1): void => {
    const c = triangleCorners(Q, R, up);
    for (let i = 0; i < 6; i++) corners[i] = c[i] ?? 0;
  };

  /** Barycentric sub-vertex (a, b) of triangle (Q, R, up): an unmoved corner reuses its plain vertex. */
  const cornerOrVertex = (Q: number, R: number, up: 0 | 1, a: number, b: number): number => {
    subAxial(Q, R, up, a, b, s);
    const corner = a === 0 && b === 0 ? 0 : a === k && b === 0 ? 1 : a === 0 && b === k ? 2 : -1;
    if (corner >= 0 && !pass.isModified(s.qs, s.rs)) {
      const plainVertex = baseIndex(corners[2 * corner] ?? 0, corners[2 * corner + 1] ?? 0);
      pass.attributesAt(s.qs, s.rs, earthwork, EARTHWORK_ITEM_SIZE * plainVertex);
      return plainVertex;
    }
    return vertexAt(s.qs, s.rs);
  };

  const loop: number[] = [];
  // Rows outside the pass's active rows are the plain chunk's: copy their indices in bulk.
  const perRow = 2 * (pass.i1 - pass.i0);
  const [first, last] = pass.activeRows;
  const head = Math.max(0, first - pass.j0) * perRow * 3;
  idx.set(base.indices.subarray(0, head), 0);
  ni = head;
  forEachChunkTriangle(pass.i0, pass.i1, first, last + 1, (Q, R, up, ordinal) => {
    if (pass.isRefined(Q, R, up)) {
      setCorners(Q, R, up);
      for (let b = 0; b < k; b++) {
        for (let a = 0; a + b < k; a++) {
          const p00 = cornerOrVertex(Q, R, up, a, b);
          const p10 = cornerOrVertex(Q, R, up, a + 1, b);
          const p01 = cornerOrVertex(Q, R, up, a, b + 1);
          idx[ni++] = p00;
          idx[ni++] = p10;
          idx[ni++] = p01;
          if (a + b + 1 < k) {
            idx[ni++] = p10;
            idx[ni++] = cornerOrVertex(Q, R, up, a + 1, b + 1);
            idx[ni++] = p01;
          }
        }
      }
      return;
    }
    const bits = pass.fanEdges(Q, R, up);
    if (bits === 0) {
      idx[ni++] = base.indices[3 * ordinal] ?? 0;
      idx[ni++] = base.indices[3 * ordinal + 1] ?? 0;
      idx[ni++] = base.indices[3 * ordinal + 2] ?? 0;
      return;
    }
    // A fan around the triangle's centroid, through the refined neighbours' edge vertices. It lies in
    // the plain triangle's plane with its interpolated normals and colours, so it looks the same.
    setCorners(Q, R, up);
    const ca = baseIndex(corners[0] ?? 0, corners[1] ?? 0);
    const cb = baseIndex(corners[2] ?? 0, corners[3] ?? 0);
    const cc = baseIndex(corners[4] ?? 0, corners[5] ?? 0);
    const centre = count++;
    for (let axis = 0; axis < 3; axis++) {
      positions[3 * centre + axis] = ((base.positions[3 * ca + axis] ?? 0) + (base.positions[3 * cb + axis] ?? 0) + (base.positions[3 * cc + axis] ?? 0)) / 3;
      normals[3 * centre + axis] = ((base.normals[3 * ca + axis] ?? 0) + (base.normals[3 * cb + axis] ?? 0) + (base.normals[3 * cc + axis] ?? 0)) / 3;
      colors[3 * centre + axis] = ((base.colors[3 * ca + axis] ?? 0) + (base.colors[3 * cb + axis] ?? 0) + (base.colors[3 * cc + axis] ?? 0)) / 3;
    }
    const nl = Math.hypot(normals[3 * centre] ?? 0, normals[3 * centre + 1] ?? 0, normals[3 * centre + 2] ?? 1) || 1;
    for (let axis = 0; axis < 3; axis++) normals[3 * centre + axis] = (normals[3 * centre + axis] ?? 0) / nl;
    loop.length = 0;
    for (let e = 0; e < 3; e++) {
      loop.push(e === 0 ? ca : e === 1 ? cb : cc);
      if ((bits & (1 << e)) === 0) continue;
      const fromQ = corners[2 * e] ?? 0;
      const fromR = corners[2 * e + 1] ?? 0;
      const toQ = corners[(2 * e + 2) % 6] ?? 0;
      const toR = corners[(2 * e + 3) % 6] ?? 0;
      for (let i = 1; i < k; i++) loop.push(vertexAt(k * fromQ + i * (toQ - fromQ), k * fromR + i * (toR - fromR)));
    }
    for (let i = 0; i < loop.length; i++) {
      idx[ni++] = centre;
      idx[ni++] = loop[i] ?? 0;
      idx[ni++] = loop[(i + 1) % loop.length] ?? 0;
    }
  }, head / 3);
  const tail = (last + 1 - pass.j0) * perRow * 3;
  idx.set(base.indices.subarray(tail), ni);
  ni += base.indices.length - tail;

  const nodeIndices = new Int32Array(count).fill(-1);
  nodeIndices.set(base.nodeIndices);
  return {
    positions: positions.slice(0, count * 3),
    normals: normals.slice(0, count * 3),
    colors: colors.slice(0, count * 3),
    indices: count > 0xffff ? idx.slice(0, ni) : Uint16Array.from(idx.subarray(0, ni)),
    nodeIndices,
    triangleCount: ni / 3,
    earthwork: earthwork.slice(0, count * EARTHWORK_ITEM_SIZE),
  };
}
