import type { BufferGeometry, Vector3Like } from "three";
import type { MaterialSlot } from "../art/AssetRegistry";
import { MeshBuilder } from "../scenery/meshBuilder";

/**
 * Procedural structure parts on top of `MeshBuilder` (flat triangles, face
 * normals, palette colours through `THREE.Color`, each triangle wound to face
 * away from a point inside its part). Structures fill three material slots:
 * `walls` (masonry bodies), `trim` (dressed stone: copings, voussoirs, string
 * courses) and `metal` (painted steel); all three draw with the shared `built`
 * material, and the slots keep a later glTF replacement possible (ADR 0013).
 *
 * Model space as the asset contract has it: metres, +Y up, forward +X. Bridge
 * parts run along +X with +Z to the right of travel; spans hang from the track
 * height (y = 0), piers stand on their foot (y = 0).
 *
 * Every convex solid (`hexa`, `bar`, `beam`, `frustum`) is recorded with its
 * triangle range, so a test can check that each of its triangles faces away
 * from the solid's own vertex centroid, an oracle that never reads the inside
 * point the builder was handed.
 */

export type StructureSlot = Extract<MaterialSlot, "walls" | "trim" | "metal">;
export const STRUCTURE_SLOTS: readonly StructureSlot[] = ["walls", "trim", "metal"];

/** A convex solid's triangles in a slot's geometry. */
export interface SolidRange {
  readonly slot: StructureSlot;
  readonly start: number;
  readonly end: number;
}

/** Faces of an axis-aligned bar: −x, +x, −y, +y, −z, +z. */
export interface BarFaces {
  readonly x0?: boolean;
  readonly x1?: boolean;
  readonly y0?: boolean;
  readonly y1?: boolean;
  readonly z0?: boolean;
  readonly z1?: boolean;
}

export const ALL_FACES: BarFaces = { x0: true, x1: true, y0: true, y1: true, z0: true, z1: true };

type P = Vector3Like;

const v = (x: number, y: number, z: number): P => ({ x, y, z });

/** Longest stretch along x that one part spans, so bending along a curved run follows the curve. */
export const BEND_SEGMENT_M = 2.5;

export class StructureBuilder {
  readonly builders: Record<StructureSlot, MeshBuilder> = { walls: new MeshBuilder(), trim: new MeshBuilder(), metal: new MeshBuilder() };
  readonly solids: SolidRange[] = [];
  private slot: StructureSlot = "walls";

  /** Selects the slot and colour for what follows. */
  use(slot: StructureSlot, hex: number): this {
    this.slot = slot;
    this.builders[slot].color(hex);
    return this;
  }

  /** Vertex AO by model height for what follows in every slot (piers: darker toward the foot). */
  ao(ramp: { floor: number; heightM: number } | undefined): this {
    for (const b of Object.values(this.builders)) b.ao(ramp);
    return this;
  }

  get current(): MeshBuilder {
    return this.builders[this.slot];
  }

  get triangleCount(): number {
    let n = 0;
    for (const b of Object.values(this.builders)) n += b.triangleCount;
    return n;
  }

  /** A planar quad a-b-c-d (in order around it), facing away from `inside`. Not a solid. */
  quad(a: P, b: P, c: P, d: P, inside: P): this {
    this.current.quad(a, b, c, d, inside);
    return this;
  }

  triangle(a: P, b: P, c: P, inside: P): this {
    this.current.triangle(a, b, c, inside);
    return this;
  }

  /**
   * A convex hexahedron from its bottom ring (c0–c3) and top ring (c4–c7), each in order around it,
   * c4 over c0. `faces` picks which of bottom, top and the four sides (c0c1, c1c2, c2c3, c3c0) to draw.
   */
  hexa(c: readonly P[], faces: { bottom?: boolean; top?: boolean; sides?: readonly boolean[] } = {}): this {
    const inside = centroid(c);
    const b = this.current;
    const start = b.triangleCount;
    const [c0, c1, c2, c3, c4, c5, c6, c7] = c as [P, P, P, P, P, P, P, P];
    if (faces.bottom) b.quad(c0, c1, c2, c3, inside);
    if (faces.top !== false) b.quad(c4, c5, c6, c7, inside);
    const sides = faces.sides ?? [true, true, true, true];
    const ring: [P, P, P, P][] = [
      [c0, c1, c5, c4],
      [c1, c2, c6, c5],
      [c2, c3, c7, c6],
      [c3, c0, c4, c7],
    ];
    ring.forEach((q, i) => {
      if (sides[i] !== false) b.quad(q[0], q[1], q[2], q[3], inside);
    });
    this.record(start);
    return this;
  }

  /**
   * An axis-aligned bar, split along x into pieces no longer than BEND_SEGMENT_M (each its own solid),
   * drawing the faces asked for (the x ends only on the first and last piece).
   */
  bar(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, faces: BarFaces = ALL_FACES): this {
    const pieces = Math.max(1, Math.ceil((x1 - x0) / BEND_SEGMENT_M - 1e-9));
    for (let i = 0; i < pieces; i++) {
      const a = x0 + ((x1 - x0) * i) / pieces;
      const e = x0 + ((x1 - x0) * (i + 1)) / pieces;
      // Bottom ring counter-clockwise seen from above: (a, z0), (e, z0), (e, z1), (a, z1); sides then face −z, +x, +z, −x.
      this.hexa([v(a, y0, z0), v(e, y0, z0), v(e, y0, z1), v(a, y0, z1), v(a, y1, z0), v(e, y1, z0), v(e, y1, z1), v(a, y1, z1)], {
        bottom: faces.y0 === true,
        top: faces.y1 !== false,
        sides: [faces.z0 !== false, i === pieces - 1 && faces.x1 !== false, faces.z1 !== false, i === 0 && faces.x0 !== false],
      });
    }
    return this;
  }

  /**
   * A straight member from p0 to p1 with a w × h cross-section: w along `side` (a unit vector square to
   * the member), h along the third axis. Its four long faces, and its ends when asked.
   */
  beam(p0: P, p1: P, w: number, h: number, side: P, ends = false): this {
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const dz = p1.z - p0.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const ax = dx / len;
    const ay = dy / len;
    const az = dz / len;
    // Third axis: axis × side.
    const tx = ay * side.z - az * side.y;
    const ty = az * side.x - ax * side.z;
    const tz = ax * side.y - ay * side.x;
    const hw = w / 2;
    const hh = h / 2;
    const corner = (p: P, a: number, b: number): P => v(p.x + side.x * a + tx * b, p.y + side.y * a + ty * b, p.z + side.z * a + tz * b);
    const ring0 = [corner(p0, -hw, -hh), corner(p0, hw, -hh), corner(p0, hw, hh), corner(p0, -hw, hh)];
    const ring1 = [corner(p1, -hw, -hh), corner(p1, hw, -hh), corner(p1, hw, hh), corner(p1, -hw, hh)];
    return this.hexa([...ring0, ...ring1], { bottom: ends, top: ends });
  }

  /**
   * A convex frustum between two rings of plan points (x, z pairs, counter-clockwise seen from above)
   * at heights y0 and y1: its sides, its top, and its bottom when asked.
   */
  frustum(ring0: readonly (readonly [number, number])[], ring1: readonly (readonly [number, number])[], y0: number, y1: number, top = true, bottom = false): this {
    const n = ring0.length;
    const pts0 = ring0.map(([x, z]) => v(x, y0, z));
    const pts1 = ring1.map(([x, z]) => v(x, y1, z));
    const inside = centroid([...pts0, ...pts1]);
    const b = this.current;
    const start = b.triangleCount;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      b.quad(pts0[i] as P, pts0[j] as P, pts1[j] as P, pts1[i] as P, inside);
    }
    if (top) for (let i = 1; i + 1 < n; i++) b.triangle(pts1[0] as P, pts1[i] as P, pts1[i + 1] as P, inside);
    if (bottom) for (let i = 1; i + 1 < n; i++) b.triangle(pts0[0] as P, pts0[i] as P, pts0[i + 1] as P, inside);
    this.record(start);
    return this;
  }

  /** The slots that received triangles, as geometries (the caller owns them). */
  build(): Partial<Record<StructureSlot, BufferGeometry>> {
    const out: Partial<Record<StructureSlot, BufferGeometry>> = {};
    for (const slot of STRUCTURE_SLOTS) {
      const b = this.builders[slot];
      if (b.triangleCount > 0) out[slot] = b.build();
    }
    return out;
  }

  private record(start: number): void {
    const end = this.current.triangleCount;
    if (end > start) this.solids.push({ slot: this.slot, start, end });
  }
}

function centroid(points: readonly P[]): P {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const n = points.length || 1;
  return v(x / n, y / n, z / n);
}
