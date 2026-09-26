import { type BufferGeometry, Vector3 } from "three";
import type { MeshPart, MeshPartKind } from "../../src/render/scenery/meshBuilder";

/**
 * Geometry checks shared by the procedural-asset tests. Materials are
 * `FrontSide` only (ADR 0009), so every generator must wind its triangles
 * counter-clockwise seen from outside, and its stored normals must agree.
 */

export function triangleCount(g: BufferGeometry): number {
  const index = g.getIndex();
  return (index ? index.count : g.getAttribute("position").count) / 3;
}

function corner(g: BufferGeometry, t: number, k: number, out: Vector3): Vector3 {
  const index = g.getIndex();
  const i = index ? index.getX(3 * t + k) : 3 * t + k;
  const p = g.getAttribute("position");
  return out.set(p.getX(i), p.getY(i), p.getZ(i));
}

function vertexIndex(g: BufferGeometry, t: number, k: number): number {
  const index = g.getIndex();
  return index ? index.getX(3 * t + k) : 3 * t + k;
}

/** Triangles whose winding (b − a) × (c − a) disagrees with any of its vertex normals. */
export function windingMismatches(g: BufferGeometry): number {
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const face = new Vector3();
  const n = new Vector3();
  const normals = g.getAttribute("normal");
  let bad = 0;
  for (let t = 0; t < triangleCount(g); t++) {
    corner(g, t, 0, a);
    corner(g, t, 1, b);
    corner(g, t, 2, c);
    face.subVectors(b, a).cross(c.sub(a));
    for (let k = 0; k < 3; k++) {
      const i = vertexIndex(g, t, k);
      n.set(normals.getX(i), normals.getY(i), normals.getZ(i));
      if (face.dot(n) <= 0) {
        bad += 1;
        break;
      }
    }
  }
  return bad;
}

/**
 * Triangles that face toward the inside of the part they belong to. `parts`
 * come from `MeshBuilder.parts`, which records each part's inside point.
 */
export function inwardFacing(g: BufferGeometry, parts: readonly MeshPart[]): number {
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const face = new Vector3();
  const centroid = new Vector3();
  let bad = 0;
  for (const part of parts) {
    for (let t = part.start; t < part.end; t++) {
      corner(g, t, 0, a);
      corner(g, t, 1, b);
      corner(g, t, 2, c);
      centroid.copy(a).add(b).add(c).divideScalar(3);
      face.subVectors(b, a).cross(new Vector3().subVectors(c, a));
      if (face.dot(centroid.sub(part.inside)) <= 0) bad += 1;
    }
  }
  return bad;
}

const CONVEX: ReadonlySet<MeshPartKind> = new Set<MeshPartKind>(["box", "prism", "cone", "blob"]);

/**
 * Triangles of convex parts (box, prism, cone, blob) that face toward the
 * centroid of their own part's vertices. This oracle never reads the recorded
 * inside point, so a generator that hands the builder a wrong one still fails.
 */
export function convexInwardFacing(g: BufferGeometry, parts: readonly MeshPart[]): number {
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const face = new Vector3();
  const centre = new Vector3();
  const centroid = new Vector3();
  let bad = 0;
  for (const part of parts) {
    if (!CONVEX.has(part.kind)) continue;
    centre.set(0, 0, 0);
    for (let t = part.start; t < part.end; t++) for (let k = 0; k < 3; k++) centre.add(corner(g, t, k, a));
    centre.divideScalar(3 * (part.end - part.start));
    for (let t = part.start; t < part.end; t++) {
      corner(g, t, 0, a);
      corner(g, t, 1, b);
      corner(g, t, 2, c);
      centroid.copy(a).add(b).add(c).divideScalar(3);
      face.subVectors(b, a).cross(c.sub(a));
      if (face.dot(centroid.sub(centre)) <= 0) bad += 1;
    }
  }
  return bad;
}

/**
 * Triangles whose winding faces down or sideways (for roof slots, where every
 * plane must face the sky). A part's recorded bottom cap (a soffit) is exempt;
 * triangles outside every part are checked too.
 */
export function downFacing(g: BufferGeometry, parts: readonly MeshPart[]): number {
  const soffit = new Uint8Array(triangleCount(g));
  for (const part of parts) soffit.fill(1, part.soffitStart, part.end);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const face = new Vector3();
  let bad = 0;
  for (let t = 0; t < soffit.length; t++) {
    if (soffit[t] === 1) continue;
    corner(g, t, 0, a);
    corner(g, t, 1, b);
    corner(g, t, 2, c);
    face.subVectors(b, a).cross(c.sub(a));
    if (face.y <= 0) bad += 1;
  }
  return bad;
}

/** Whether two geometries hold exactly the same attribute data. */
export function sameGeometry(x: BufferGeometry, y: BufferGeometry): boolean {
  for (const name of ["position", "normal", "color"]) {
    const ax = x.getAttribute(name);
    const ay = y.getAttribute(name);
    if (!ax || !ay || ax.count !== ay.count || ax.itemSize !== ay.itemSize) return false;
    const dx = ax.array;
    const dy = ay.array;
    for (let i = 0; i < dx.length; i++) if (dx[i] !== dy[i]) return false;
  }
  return true;
}
