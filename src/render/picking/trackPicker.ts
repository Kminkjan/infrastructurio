import { Vector3 } from "three";
import { samplePiece } from "../../core/geometry/sample";
import { type NetworkNode, type NetworkPiece, type NetworkView, nearestNode, toWorld } from "../../core/sim/api";
import { type IsoView, worldToScreen } from "../camera/isoMath";
import { simToWorld } from "../coords";

/**
 * Construction picking (architecture "Picking"), in the documented order
 * minus the parts later slices add (handles, proxy layers): existing nodes
 * within 14 px on screen, then track centrelines within 10 px, then the
 * lattice node nearest the terrain hit (the analytic heightfield march, done
 * by the caller). Distances are measured on screen from each node's and
 * centreline's real height, so elevated track picks where it is drawn.
 * Picks leave as sim identities (nodes and pieces of the view), never three
 * objects.
 */

export const NODE_PICK_RADIUS_PX = 14;
export const TRACK_PICK_RADIUS_PX = 10;
/**
 * Only nodes and pieces within this plan distance of the terrain hit are
 * tested. At the iso pitch a point h metres up is drawn about 1.41·h metres
 * of ground away from its foot, so 60 m covers track up to about 40 m high.
 */
export const PICK_SEARCH_RADIUS_M = 60;
/** Height above the track height that picking aims at (about the rail tops). */
const PICK_LIFT_M = 0.3;
const CENTRELINE_SAGITTA_M = 0.1;

export type ScreenPick =
  | { readonly kind: "node"; readonly node: NetworkNode }
  | { readonly kind: "piece"; readonly piece: NetworkPiece; readonly node: NetworkNode }
  | { readonly kind: "ground"; readonly xM: number; readonly yM: number; readonly q: number; readonly r: number };

interface PickIndex {
  /** Per node: sim x, y, z (m). */
  readonly nodeXyz: Float64Array;
  /** Per piece: the centreline as sim x, y, z triples, and its plan bounds. */
  readonly lines: readonly { readonly points: Float64Array; readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }[];
}

const indexes = new WeakMap<NetworkView, PickIndex>();

function indexOf(network: NetworkView): PickIndex {
  let index = indexes.get(network);
  if (index) return index;
  const nodeXyz = new Float64Array(network.nodes.length * 3);
  network.nodes.forEach((n, i) => {
    const p = toWorld(n);
    nodeXyz[i * 3] = p.x;
    nodeXyz[i * 3 + 1] = p.y;
    nodeXyz[i * 3 + 2] = n.zMm / 1000 + PICK_LIFT_M;
  });
  const lines = network.pieces.map((piece) => {
    const samples = samplePiece(piece, CENTRELINE_SAGITTA_M);
    const length = samples[samples.length - 1]?.sM ?? 0;
    const points = new Float64Array(samples.length * 3);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    samples.forEach((s, i) => {
      const f = length > 0 ? s.sM / length : 0;
      points[i * 3] = s.x;
      points[i * 3 + 1] = s.y;
      points[i * 3 + 2] = (piece.z0Mm + (piece.z1Mm - piece.z0Mm) * f) / 1000 + PICK_LIFT_M;
      minX = Math.min(minX, s.x);
      minY = Math.min(minY, s.y);
      maxX = Math.max(maxX, s.x);
      maxY = Math.max(maxY, s.y);
    });
    return { points, minX, minY, maxX, maxY };
  });
  index = { nodeXyz, lines };
  indexes.set(network, index);
  return index;
}

const scratchWorld = new Vector3();
const screenA = { x: 0, y: 0 };
const screenB = { x: 0, y: 0 };

function project(view: IsoView, x: number, y: number, z: number, out: { x: number; y: number }): { x: number; y: number } {
  return worldToScreen(view, simToWorld(x, y, z, scratchWorld), out);
}

/** Distance from point p to segment ab, all on screen. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/**
 * Picks at CSS pixel (sx, sy). `ground` is the terrain hit on the sim plan
 * (metres) or null when the ray misses the map; with no hit nothing is
 * picked.
 */
export function pickTrack(network: NetworkView, view: IsoView, sx: number, sy: number, ground: { readonly x: number; readonly y: number } | null): ScreenPick | null {
  if (!ground) return null;
  const index = indexOf(network);
  const r = PICK_SEARCH_RADIUS_M;

  let bestNode = -1;
  let bestNodePx = NODE_PICK_RADIUS_PX;
  for (let i = 0; i < network.nodes.length; i++) {
    const x = index.nodeXyz[i * 3] ?? 0;
    const y = index.nodeXyz[i * 3 + 1] ?? 0;
    if (Math.abs(x - ground.x) > r || Math.abs(y - ground.y) > r) continue;
    const s = project(view, x, y, index.nodeXyz[i * 3 + 2] ?? 0, screenA);
    const d = Math.hypot(s.x - sx, s.y - sy);
    if (d <= bestNodePx) {
      bestNodePx = d;
      bestNode = i;
    }
  }
  const node = network.nodes[bestNode];
  if (node) return { kind: "node", node };

  let bestPiece = -1;
  let bestPiecePx = TRACK_PICK_RADIUS_PX;
  for (let i = 0; i < index.lines.length; i++) {
    const line = index.lines[i];
    if (!line || line.maxX < ground.x - r || line.minX > ground.x + r || line.maxY < ground.y - r || line.minY > ground.y + r) continue;
    const pts = line.points;
    project(view, pts[0] ?? 0, pts[1] ?? 0, pts[2] ?? 0, screenA);
    for (let k = 3; k < pts.length; k += 3) {
      project(view, pts[k] ?? 0, pts[k + 1] ?? 0, pts[k + 2] ?? 0, screenB);
      const d = segmentDistance(sx, sy, screenA.x, screenA.y, screenB.x, screenB.y);
      if (d <= bestPiecePx) {
        bestPiecePx = d;
        bestPiece = i;
      }
      screenA.x = screenB.x;
      screenA.y = screenB.y;
    }
  }
  const piece = network.pieces[bestPiece];
  if (piece) {
    // The piece's nearer end on screen: where a turnout would leave it.
    const [a, b] = piece.nodes.map((id) => network.nodes[id]);
    if (a && b) {
      const sa = project(view, index.nodeXyz[a.id * 3] ?? 0, index.nodeXyz[a.id * 3 + 1] ?? 0, index.nodeXyz[a.id * 3 + 2] ?? 0, screenA);
      const da = Math.hypot(sa.x - sx, sa.y - sy);
      const sb = project(view, index.nodeXyz[b.id * 3] ?? 0, index.nodeXyz[b.id * 3 + 1] ?? 0, index.nodeXyz[b.id * 3 + 2] ?? 0, screenB);
      const db = Math.hypot(sb.x - sx, sb.y - sy);
      return { kind: "piece", piece, node: da <= db ? a : b };
    }
  }

  const q = nearestNode(ground);
  return { kind: "ground", xM: ground.x, yM: ground.y, q: q.q, r: q.r };
}
