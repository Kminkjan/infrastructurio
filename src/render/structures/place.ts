import { BufferAttribute, BufferGeometry } from "three";
import type { PathPoint, RunPath } from "./runPath";

/**
 * Maps model-space structure templates (`assets.ts`: +X along, +Y up, +Z to
 * the right of travel) into three world space through a run's frame, and
 * gathers a run's parts into one flat-shaded geometry.
 *
 * - `bend`: spans follow the run. Model x becomes arc length s = s0 + dir·x·scale,
 *   z the offset to the right (times dir), y the height above the track at s.
 *   `scale` stretches a template of whole decimetres to the exact distance
 *   between its supports, so neighbouring spans meet exactly.
 * - `place`: piers, abutments and portals stand rigid, square to the run's
 *   tangent at one point.
 *
 * dir −1 turns a part to face back along the run (an abutment at the run's
 * far end, a portal whose tunnel lies behind it): a rotation by 180°, never a
 * mirror, so winding survives. The run frame (tangent, right, up) is
 * right-handed and bending only stretches it along s by 1 − κ·right (κ at most
 * 1/60 m, |right| at most about 30 m for the widest portal wings), so every
 * triangle keeps its orientation; face normals are recomputed from the mapped
 * positions. Positions go sim → three as (x, z, −y), like `coords.ts`, inlined
 * so the loop allocates nothing.
 */

export class GeometrySink {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];

  get triangleCount(): number {
    return this.positions.length / 9;
  }

  /** The gathered triangles as a non-indexed geometry with bounds (the caller owns it). */
  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(this.positions), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(this.normals), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(this.colors), 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

const scratchPoint: PathPoint = { x: 0, y: 0, z: 0, tx: 1, ty: 0 };
const sim = { x: 0, y: 0, z: 0 };
const tri = new Float64Array(9);

/** Appends one triangle (world corners in `tri`) with its face normal and the template's colours. */
function emit(sink: GeometrySink, colors: ArrayLike<number>, base: number, colorSize: number): void {
  const ax = tri[0] ?? 0;
  const ay = tri[1] ?? 0;
  const az = tri[2] ?? 0;
  const ux = (tri[3] ?? 0) - ax;
  const uy = (tri[4] ?? 0) - ay;
  const uz = (tri[5] ?? 0) - az;
  const vx = (tri[6] ?? 0) - ax;
  const vy = (tri[7] ?? 0) - ay;
  const vz = (tri[8] ?? 0) - az;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (!(len > 0)) return;
  nx /= len;
  ny /= len;
  nz /= len;
  for (let k = 0; k < 3; k++) {
    sink.positions.push(tri[3 * k] ?? 0, tri[3 * k + 1] ?? 0, tri[3 * k + 2] ?? 0);
    sink.normals.push(nx, ny, nz);
    const c = (base + k) * colorSize;
    sink.colors.push(colors[c] ?? 0, colors[c + 1] ?? 0, colors[c + 2] ?? 0);
  }
}

function eachTriangle(geometry: BufferGeometry, map: (x: number, y: number, z: number, k: number) => void, sink: GeometrySink): void {
  const position = geometry.getAttribute("position");
  const color = geometry.getAttribute("color");
  const p = position.array as ArrayLike<number>;
  const c = color.array as ArrayLike<number>;
  const count = position.count;
  for (let t = 0; t + 2 < count; t += 3) {
    for (let k = 0; k < 3; k++) {
      const i = (t + k) * 3;
      map(p[i] ?? 0, p[i + 1] ?? 0, p[i + 2] ?? 0, k);
    }
    emit(sink, c, t, color.itemSize);
  }
}

/** Bends a span template along `path` from arc length `s0` (see the module note). */
export function bend(sink: GeometrySink, geometry: BufferGeometry, path: RunPath, s0: number, dir: 1 | -1 = 1, scale = 1): void {
  eachTriangle(
    geometry,
    (x, y, z, k) => {
      path.toSim(s0 + dir * x * scale, dir * z, y, sim, scratchPoint);
      tri[3 * k] = sim.x;
      tri[3 * k + 1] = sim.z;
      tri[3 * k + 2] = -sim.y;
    },
    sink,
  );
}

/** Where a rigid part stands: sim plan position, the unit tangent its +X follows, and the height of its y = 0. */
export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly tx: number;
  readonly ty: number;
}

/** Places a template rigidly: +X along (tx, ty), +Z to its right, y = 0 at height z. */
export function place(sink: GeometrySink, geometry: BufferGeometry, at: Placement): void {
  const { tx, ty } = at;
  eachTriangle(
    geometry,
    (x, y, z, k) => {
      // Right of (tx, ty) is (ty, −tx).
      const sx = at.x + tx * x + ty * z;
      const sy = at.y + ty * x - tx * z;
      tri[3 * k] = sx;
      tri[3 * k + 1] = at.z + y;
      tri[3 * k + 2] = -sy;
    },
    sink,
  );
}
