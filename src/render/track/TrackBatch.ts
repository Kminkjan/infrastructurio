import { BatchedMesh, BufferAttribute, BufferGeometry, Group, type Material, Mesh, type Object3D } from "three";
import type { TrackMeshData } from "./trackGeometry";

/**
 * One track layer (ballast, sleepers or rails) as a set of per-piece meshes
 * keyed by canonical piece key (architecture "Track", ADR 0013). Two
 * implementations sit behind it:
 * - `BatchedTrackBatch`: one `BatchedMesh`, one draw call through
 *   `WEBGL_multi_draw`;
 * - `ChunkedTrackBatch`: the fallback when multi-draw is missing (three would
 *   otherwise issue one draw per piece): pieces merged into one mesh per
 *   128 m chunk, rebuilt when the chunk's membership changes.
 *
 * `add`/`remove` record changes; `flush` applies what is deferred (chunk
 * rebuilds, bounds) once per batch of edits.
 */
export interface TrackBatch {
  readonly object: Object3D;
  readonly kind: "batched" | "chunked";
  readonly size: number;
  has(key: string): boolean;
  add(key: string, data: TrackMeshData): void;
  remove(key: string): void;
  flush(): void;
  dispose(): void;
}

/** Plan edge of a fallback chunk, metres. */
export const TRACK_CHUNK_M = 128;

function toGeometry(data: TrackMeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(data.positions, 3));
  g.setAttribute("normal", new BufferAttribute(data.normals, 3));
  g.setAttribute("color", new BufferAttribute(data.colors, 3));
  if (data.stripe) g.setAttribute("trackStripe", new BufferAttribute(data.stripe, 1));
  g.setIndex(new BufferAttribute(data.indices, 1));
  return g;
}

const INITIAL_INSTANCES = 256;
const INITIAL_VERTICES = 16_384;

export class BatchedTrackBatch implements TrackBatch {
  readonly kind = "batched";
  readonly mesh: BatchedMesh;
  private readonly ids = new Map<string, number>();
  private dirty = false;

  constructor(material: Material, name: string) {
    this.mesh = new BatchedMesh(INITIAL_INSTANCES, INITIAL_VERTICES, INITIAL_VERTICES * 2, material);
    this.mesh.name = name;
    // Opaque pieces: sorting buys nothing; per-piece culling keeps off-screen track out of the draw.
    this.mesh.sortObjects = false;
    this.mesh.perObjectFrustumCulled = true;
    this.mesh.receiveShadow = true;
    // An empty batch has no attributes yet: keep it out of the render until the first piece.
    this.mesh.visible = false;
  }

  get object(): Object3D {
    return this.mesh;
  }

  get size(): number {
    return this.ids.size;
  }

  has(key: string): boolean {
    return this.ids.has(key);
  }

  add(key: string, data: TrackMeshData): void {
    if (this.ids.has(key) || data.vertexCount === 0) return;
    const mesh = this.mesh;
    // Reclaim the space removed pieces left behind before growing.
    if (mesh.unusedVertexCount < data.vertexCount || mesh.unusedIndexCount < data.indexCount) mesh.optimize();
    this.ensureSpace(data.vertexCount, data.indexCount);
    if (mesh.instanceCount >= mesh.maxInstanceCount) mesh.setInstanceCount(mesh.maxInstanceCount * 2);
    const geometry = toGeometry(data);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const geometryId = mesh.addGeometry(geometry);
    mesh.addInstance(geometryId);
    geometry.dispose();
    this.ids.set(key, geometryId);
    this.dirty = true;
  }

  remove(key: string): void {
    const geometryId = this.ids.get(key);
    if (geometryId === undefined) return;
    this.mesh.deleteGeometry(geometryId);
    this.ids.delete(key);
    this.dirty = true;
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.mesh.visible = this.ids.size > 0;
    // Stale bounds would cull or mis-pick the batch (render guide "GPU resources").
    if (this.ids.size > 0) {
      this.mesh.computeBoundingBox();
      this.mesh.computeBoundingSphere();
    }
  }

  dispose(): void {
    this.mesh.dispose();
    this.ids.clear();
  }

  /** Grows the shared buffers (doubling) until `vertices` and `indices` more fit. */
  private ensureSpace(vertices: number, indices: number): void {
    const mesh = this.mesh;
    if (mesh.unusedVertexCount >= vertices && mesh.unusedIndexCount >= indices) return;
    const range = { vertices: 0, indices: 0 };
    capacityOf(mesh, range);
    let maxV = range.vertices;
    let maxI = range.indices;
    const needV = maxV - mesh.unusedVertexCount + vertices;
    const needI = maxI - mesh.unusedIndexCount + indices;
    while (maxV < needV) maxV *= 2;
    while (maxI < needI) maxI *= 2;
    mesh.setGeometrySize(maxV, maxI);
  }
}

/** The batch's current buffer capacity (three keeps it private; the unused counts are relative to it). */
function capacityOf(mesh: BatchedMesh, out: { vertices: number; indices: number }): void {
  const internals = mesh as unknown as { _maxVertexCount: number; _maxIndexCount: number };
  out.vertices = internals._maxVertexCount;
  out.indices = internals._maxIndexCount;
}

interface Chunk {
  readonly pieces: Map<string, TrackMeshData>;
  mesh: Mesh | undefined;
  dirty: boolean;
}

export class ChunkedTrackBatch implements TrackBatch {
  readonly kind = "chunked";
  readonly group = new Group();
  private readonly chunkOf = new Map<string, string>();
  private readonly chunks = new Map<string, Chunk>();

  constructor(
    private readonly material: Material,
    name: string,
  ) {
    this.group.name = name;
  }

  get object(): Object3D {
    return this.group;
  }

  get size(): number {
    return this.chunkOf.size;
  }

  has(key: string): boolean {
    return this.chunkOf.has(key);
  }

  add(key: string, data: TrackMeshData): void {
    if (this.chunkOf.has(key) || data.vertexCount === 0) return;
    const id = `${Math.floor(data.anchorX / TRACK_CHUNK_M)},${Math.floor(data.anchorY / TRACK_CHUNK_M)}`;
    let chunk = this.chunks.get(id);
    if (!chunk) {
      chunk = { pieces: new Map(), mesh: undefined, dirty: false };
      this.chunks.set(id, chunk);
    }
    chunk.pieces.set(key, data);
    chunk.dirty = true;
    this.chunkOf.set(key, id);
  }

  remove(key: string): void {
    const id = this.chunkOf.get(key);
    if (id === undefined) return;
    this.chunkOf.delete(key);
    const chunk = this.chunks.get(id);
    if (!chunk) return;
    chunk.pieces.delete(key);
    chunk.dirty = true;
  }

  flush(): void {
    for (const [id, chunk] of this.chunks) {
      if (!chunk.dirty) continue;
      chunk.dirty = false;
      if (chunk.mesh) {
        this.group.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
        chunk.mesh = undefined;
      }
      if (chunk.pieces.size === 0) {
        this.chunks.delete(id);
        continue;
      }
      const mesh = new Mesh(mergeChunk([...chunk.pieces.values()]), this.material);
      mesh.name = `${this.group.name} ${id}`;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      chunk.mesh = mesh;
    }
  }

  dispose(): void {
    for (const chunk of this.chunks.values()) chunk.mesh?.geometry.dispose();
    this.chunks.clear();
    this.chunkOf.clear();
    this.group.clear();
  }
}

/** Concatenates a chunk's piece meshes into one indexed geometry. */
export function mergeChunk(parts: readonly TrackMeshData[]): BufferGeometry {
  let vertices = 0;
  let indices = 0;
  let stripe = false;
  for (const p of parts) {
    vertices += p.vertexCount;
    indices += p.indexCount;
    stripe ||= p.stripe !== null;
  }
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const colors = new Float32Array(vertices * 3);
  const stripes = stripe ? new Float32Array(vertices) : null;
  const index = new Uint32Array(indices);
  let v = 0;
  let i = 0;
  for (const p of parts) {
    positions.set(p.positions, v * 3);
    normals.set(p.normals, v * 3);
    colors.set(p.colors, v * 3);
    if (stripes && p.stripe) stripes.set(p.stripe, v);
    for (let k = 0; k < p.indexCount; k++) index[i + k] = (p.indices[k] ?? 0) + v;
    v += p.vertexCount;
    i += p.indexCount;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(positions, 3));
  g.setAttribute("normal", new BufferAttribute(normals, 3));
  g.setAttribute("color", new BufferAttribute(colors, 3));
  if (stripes) g.setAttribute("trackStripe", new BufferAttribute(stripes, 1));
  g.setIndex(new BufferAttribute(index, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** A layer's batch: `BatchedMesh` when the GPU has multi-draw, the chunk-merged fallback otherwise. */
export function createTrackBatch(material: Material, name: string, multiDraw: boolean): TrackBatch {
  return multiDraw ? new BatchedTrackBatch(material, name) : new ChunkedTrackBatch(material, name);
}
