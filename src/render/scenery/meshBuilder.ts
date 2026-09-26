import { BufferAttribute, BufferGeometry, Color, Matrix4, Vector3, type Vector3Like } from "three";

/**
 * Low-level builder for procedural assets (ADR 0013 "procedural first"): flat,
 * non-indexed triangles with face normals, palette colours written through
 * `THREE.Color` (linear), an optional vertex alpha (the foliage mask), and
 * baked vertex AO that darkens toward the ground.
 *
 * Orientation is decided, not hoped for: every triangle is given a point inside
 * the part it belongs to and is wound to face away from it, so `FrontSide`
 * always sees the outside. The builder records each part's inside point, its
 * kind and its bottom cap, so tests can check that claim for every generated
 * asset, and check convex parts and roofs by oracles that never read the
 * inside point (a wrong one would otherwise pass unseen).
 *
 * Model space: +Y up, metres, origin at ground contact, forward +X.
 */

/** Vertex AO by model height: `floor` at y = 0, rising smoothly to 1 at `heightM`. */
export interface AoRamp {
  readonly floor: number;
  readonly heightM: number;
}

/** How a part was made; box, prism, cone and blob are convex. */
export type MeshPartKind = "triangle" | "quad" | "box" | "prism" | "cone" | "blob";

/** A recorded part: triangles [start, end) and the point they face away from. */
export interface MeshPart {
  readonly start: number;
  readonly end: number;
  readonly inside: Vector3;
  readonly kind: MeshPartKind;
  /** First triangle of the part's bottom cap, which faces down by design (a soffit); `end` when it has none. */
  readonly soffitStart: number;
}

type P = Vector3Like;

const scratchA = new Vector3();
const scratchB = new Vector3();
const scratchC = new Vector3();
const scratchInside = new Vector3();
const edge1 = new Vector3();
const edge2 = new Vector3();
const faceNormal = new Vector3();
const centroid = new Vector3();

export class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly current = new Color(1, 1, 1);
  private alpha = 1;
  private ramp: AoRamp | undefined;
  private matrix: Matrix4 | undefined;
  private readonly partList: MeshPart[] = [];

  /** `withAlpha` writes RGBA colours (the foliage crown/trunk mask); otherwise RGB. */
  constructor(private readonly withAlpha = false) {}

  get triangleCount(): number {
    return this.positions.length / 9;
  }

  get parts(): readonly MeshPart[] {
    return this.partList;
  }

  /** Sets the colour of what follows from a palette value (sRGB hex). */
  color(hex: number, alpha = 1): this {
    this.current.setHex(hex);
    this.alpha = alpha;
    return this;
  }

  /** Sets the colour from a linear `Color` (for blended palette pairs). */
  colorLinear(c: Color, alpha = 1): this {
    this.current.copy(c);
    this.alpha = alpha;
    return this;
  }

  /**
   * A neutral brightness instead of a colour, for parts whose hue comes from
   * the instance colour (tree crowns): the vertex carries only shading.
   */
  neutral(brightness: number, alpha = 1): this {
    this.current.setRGB(brightness, brightness, brightness);
    this.alpha = alpha;
    return this;
  }

  ao(ramp: AoRamp | undefined): this {
    this.ramp = ramp;
    return this;
  }

  /** Transforms everything added until the next call (undefined for identity). */
  transform(m: Matrix4 | undefined): this {
    this.matrix = m;
    return this;
  }

  /** One triangle, wound to face away from `inside`. */
  triangle(a: P, b: P, c: P, inside: P): this {
    const start = this.triangleCount;
    this.addTriangle(a, b, c, inside);
    this.record(start, inside, "triangle");
    return this;
  }

  /** A planar quad a-b-c-d (in order around it), wound to face away from `inside`. */
  quad(a: P, b: P, c: P, d: P, inside: P): this {
    const start = this.triangleCount;
    this.addTriangle(a, b, c, inside);
    this.addTriangle(a, c, d, inside);
    this.record(start, inside, "quad");
    return this;
  }

  /** An axis-aligned box from y0 to y1, `sx` × `sz` around (x, z); no bottom unless asked. */
  box(o: { x: number; z: number; y0: number; y1: number; sx: number; sz: number; bottom?: boolean; top?: boolean }): this {
    const x0 = o.x - o.sx / 2;
    const x1 = o.x + o.sx / 2;
    const z0 = o.z - o.sz / 2;
    const z1 = o.z + o.sz / 2;
    const inside = { x: o.x, y: (o.y0 + o.y1) / 2, z: o.z };
    const start = this.triangleCount;
    const v = (x: number, y: number, z: number) => ({ x, y, z });
    this.addQuad(v(x1, o.y0, z1), v(x1, o.y0, z0), v(x1, o.y1, z0), v(x1, o.y1, z1), inside);
    this.addQuad(v(x0, o.y0, z0), v(x0, o.y0, z1), v(x0, o.y1, z1), v(x0, o.y1, z0), inside);
    this.addQuad(v(x0, o.y0, z1), v(x1, o.y0, z1), v(x1, o.y1, z1), v(x0, o.y1, z1), inside);
    this.addQuad(v(x1, o.y0, z0), v(x0, o.y0, z0), v(x0, o.y1, z0), v(x1, o.y1, z0), inside);
    if (o.top !== false) this.addQuad(v(x0, o.y1, z1), v(x1, o.y1, z1), v(x1, o.y1, z0), v(x0, o.y1, z0), inside);
    const soffit = this.triangleCount;
    if (o.bottom === true) this.addQuad(v(x0, o.y0, z0), v(x1, o.y0, z0), v(x1, o.y0, z1), v(x0, o.y0, z1), inside);
    this.record(start, inside, "box", soffit);
    return this;
  }

  /**
   * A vertical n-sided prism (or frustum with `radiusTop`) from y0 to y1.
   * Caps are fans; `phase` turns the ring (radians).
   */
  prism(o: {
    x: number;
    z: number;
    y0: number;
    y1: number;
    radius: number;
    radiusTop?: number;
    sides: number;
    phase?: number;
    top?: boolean;
    bottom?: boolean;
  }): this {
    const start = this.triangleCount;
    const inside = { x: o.x, y: (o.y0 + o.y1) / 2, z: o.z };
    const bottom = ring(o.x, o.z, o.y0, o.radius, o.sides, o.phase ?? 0);
    const top = ring(o.x, o.z, o.y1, o.radiusTop ?? o.radius, o.sides, o.phase ?? 0);
    for (let i = 0; i < o.sides; i++) {
      const j = (i + 1) % o.sides;
      this.addQuad(bottom[i] as P, bottom[j] as P, top[j] as P, top[i] as P, inside);
    }
    if (o.top !== false) for (let i = 1; i + 1 < o.sides; i++) this.addTriangle(top[0] as P, top[i] as P, top[i + 1] as P, inside);
    const soffit = this.triangleCount;
    if (o.bottom === true) for (let i = 1; i + 1 < o.sides; i++) this.addTriangle(bottom[0] as P, bottom[i] as P, bottom[i + 1] as P, inside);
    this.record(start, inside, "prism", soffit);
    return this;
  }

  /** An n-sided cone from a ring at y0 to an apex at y1, with an optional base cap. */
  cone(o: { x: number; z: number; y0: number; y1: number; radius: number; sides: number; phase?: number; bottom?: boolean; apexX?: number; apexZ?: number }): this {
    const start = this.triangleCount;
    const inside = { x: o.x, y: o.y0 + (o.y1 - o.y0) / 4, z: o.z };
    const base = ring(o.x, o.z, o.y0, o.radius, o.sides, o.phase ?? 0);
    const apex = { x: o.apexX ?? o.x, y: o.y1, z: o.apexZ ?? o.z };
    for (let i = 0; i < o.sides; i++) this.addTriangle(base[i] as P, base[(i + 1) % o.sides] as P, apex, inside);
    const soffit = this.triangleCount;
    if (o.bottom === true) for (let i = 1; i + 1 < o.sides; i++) this.addTriangle(base[0] as P, base[i] as P, base[i + 1] as P, inside);
    this.record(start, inside, "cone", soffit);
    return this;
  }

  /**
   * A faceted blob for tree crowns: an octahedron (8 triangles) or an
   * icosahedron (20) scaled to radii (rx, ry, rz) around (x, y, z), with each
   * vertex nudged by `jitter` (a deterministic function of its index).
   */
  blob(o: { x: number; y: number; z: number; rx: number; ry: number; rz: number; shape: "octahedron" | "icosahedron"; jitter?: (i: number) => number }): this {
    const start = this.triangleCount;
    const [verts, faces] = o.shape === "octahedron" ? OCTAHEDRON : ICOSAHEDRON;
    const inside = { x: o.x, y: o.y, z: o.z };
    const pts = verts.map(([vx, vy, vz], i) => {
      const k = 1 + (o.jitter ? o.jitter(i) : 0);
      return { x: o.x + vx * o.rx * k, y: o.y + vy * o.ry * k, z: o.z + vz * o.rz * k };
    });
    for (const [a, b, c] of faces) this.addTriangle(pts[a] as P, pts[b] as P, pts[c] as P, inside);
    this.record(start, inside, "blob");
    return this;
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute("normal", new BufferAttribute(new Float32Array(this.normals), 3));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(this.colors), this.withAlpha ? 4 : 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private addQuad(a: P, b: P, c: P, d: P, inside: P): void {
    this.addTriangle(a, b, c, inside);
    this.addTriangle(a, c, d, inside);
  }

  private addTriangle(a: P, b: P, c: P, inside: P): void {
    const pa = this.apply(a, scratchA);
    let pb = this.apply(b, scratchB);
    let pc = this.apply(c, scratchC);
    const pin = this.apply(inside, scratchInside);
    faceNormal.crossVectors(edge1.subVectors(pb, pa), edge2.subVectors(pc, pa));
    if (faceNormal.lengthSq() === 0) return;
    centroid.copy(pa).add(pb).add(pc).divideScalar(3);
    if (faceNormal.dot(centroid.sub(pin)) < 0) {
      // Facing the inside: swap b and c so the front side looks outward.
      const swap = pb;
      pb = pc;
      pc = swap;
      faceNormal.negate();
    }
    faceNormal.normalize();
    for (const p of [pa, pb, pc]) {
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(faceNormal.x, faceNormal.y, faceNormal.z);
      const k = this.aoAt(p.y);
      this.colors.push(this.current.r * k, this.current.g * k, this.current.b * k);
      if (this.withAlpha) this.colors.push(this.alpha);
    }
  }

  private apply(p: P, out: Vector3): Vector3 {
    out.set(p.x, p.y, p.z);
    if (this.matrix) out.applyMatrix4(this.matrix);
    return out;
  }

  private aoAt(y: number): number {
    const r = this.ramp;
    if (!r) return 1;
    const t = Math.min(1, Math.max(0, y / r.heightM));
    return r.floor + (1 - r.floor) * t * t * (3 - 2 * t);
  }

  private record(start: number, inside: P, kind: MeshPartKind, soffitStart = this.triangleCount): void {
    const end = this.triangleCount;
    if (end > start) this.partList.push({ start, end, inside: this.apply(inside, new Vector3()).clone(), kind, soffitStart });
  }
}

/** Ring of `sides` points at height y: x = r·cos θ, z = −r·sin θ, counter-clockwise seen from above. */
function ring(x: number, z: number, y: number, r: number, sides: number, phase: number): P[] {
  const out: P[] = [];
  for (let i = 0; i < sides; i++) {
    const a = phase + (i * 2 * Math.PI) / sides;
    out.push({ x: x + r * Math.cos(a), y, z: z - r * Math.sin(a) });
  }
  return out;
}

type Tri = readonly [number, number, number];

const OCTAHEDRON: [readonly Tri[], readonly Tri[]] = [
  [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ],
  [
    [0, 2, 4],
    [4, 2, 1],
    [1, 2, 5],
    [5, 2, 0],
    [4, 3, 0],
    [1, 3, 4],
    [5, 3, 1],
    [0, 3, 5],
  ],
];

const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_SCALE = 1 / Math.hypot(1, PHI);
const ICO_VERTICES = [
  [-1, PHI, 0],
  [1, PHI, 0],
  [-1, -PHI, 0],
  [1, -PHI, 0],
  [0, -1, PHI],
  [0, 1, PHI],
  [0, -1, -PHI],
  [0, 1, -PHI],
  [PHI, 0, -1],
  [PHI, 0, 1],
  [-PHI, 0, -1],
  [-PHI, 0, 1],
] as const;
const ICOSAHEDRON: [readonly Tri[], readonly Tri[]] = [
  ICO_VERTICES.map(([x, y, z]) => [x * ICO_SCALE, y * ICO_SCALE, z * ICO_SCALE] as const),
  [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ],
];
