import { Vector3 } from "three";
import { samplePiece } from "../../core/geometry/sample";
import { type NetworkNode, type NetworkPiece, type NetworkView, nearestNode, toWorld } from "../../core/sim/api";
import { type IsoView, worldToScreen } from "../camera/isoMath";
import { simToWorld } from "../coords";
import { TRACK_RAIL_TOP_M } from "../track/trackGeometry";
import { DEFAULT_PICK_VISIBILITY, type PickVisibility } from "./layers";

/**
 * Construction picking (architecture "Picking"), in the documented order
 * minus the parts later slices add (handles): existing nodes within 14 px on
 * screen, pieces whose proxies the ray crosses (D4: decks and tunnel bores,
 * raycast by the caller in the pick scene), track centrelines within 10 px,
 * then the lattice node nearest the terrain hit (the analytic heightfield
 * march, done by the caller). Distances are measured on screen from each
 * node's and centreline's real height, so elevated track picks where it is
 * drawn. Picks leave as sim identities (nodes and pieces of the view), never
 * three objects.
 *
 * **Occlusion aids (D4).** Bridge pieces (and nodes only they touch) are
 * candidates unless H hides the decks; tunnel pieces only under U's
 * underground x-ray. **Stacked hits:** candidates are grouped into levels by
 * height, a new level wherever the next is LEVEL_BAND_M lower. On a view ray
 * higher always means nearer the camera (the pitch is positive), so the
 * highest level is the one drawn in front. Within a level the D3 rule holds
 * (the nearest node within 14 px, else the nearest piece); the terrain pick
 * comes last. The default pick is the front level, and C steps through the
 * levels to what lies behind it: the track under a bridge, then the ground.
 */

export const NODE_PICK_RADIUS_PX = 14;
export const TRACK_PICK_RADIUS_PX = 10;
/**
 * Only nodes and pieces within this plan distance of the terrain hit are
 * tested. At the iso pitch a point h metres up is drawn about 1.41·h metres
 * of ground away from its foot, so 60 m covers track up to about 40 m high.
 */
export const PICK_SEARCH_RADIUS_M = 60;
/**
 * Height above the track height that picking aims at: just under the drawn
 * rail tops (0.4 m), so it follows the render lift and picks track where it
 * is drawn. Sim heights are never lifted.
 */
export const PICK_LIFT_M = TRACK_RAIL_TOP_M - 0.05;
const CENTRELINE_SAGITTA_M = 0.1;
/** Candidates more than this much lower than a level's highest start the next level (grade-separated track is 6.5 m apart). */
export const LEVEL_BAND_M = 3;

/** A proxy hit from the pick scene: a piece key and the height (m) of that piece's centreline there. */
export interface ProxyHit {
  readonly key: string;
  readonly zM: number;
}

export interface PickOptions {
  /** What the occlusion aids let the pick land on (default: decks yes, tunnels no). */
  readonly visibility?: PickVisibility;
  /** Proxy hits under the pixel (DECK and TUNNEL layers), from the caller's raycast of the pick scene. */
  readonly proxies?: readonly ProxyHit[];
}

export type ScreenPick =
  | { readonly kind: "node"; readonly node: NetworkNode }
  | { readonly kind: "piece"; readonly piece: NetworkPiece; readonly node: NetworkNode }
  | { readonly kind: "ground"; readonly xM: number; readonly yM: number; readonly q: number; readonly r: number };

interface PickIndex {
  /** Per node: sim x, y, z (m). */
  readonly nodeXyz: Float64Array;
  /** Per piece: the centreline as sim x, y, z triples, and its plan bounds. */
  readonly lines: readonly { readonly points: Float64Array; readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }[];
  /** Per node: the structures of the pieces touching it, as bits (1 ground, 2 bridge, 4 tunnel). */
  readonly nodeStructures: Uint8Array;
  readonly pieceByKey: ReadonlyMap<string, NetworkPiece>;
}

const indexes = new WeakMap<NetworkView, PickIndex>();

const STRUCTURE_BIT = { ground: 1, bridge: 2, tunnel: 4 } as const;

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
  const nodeStructures = new Uint8Array(network.nodes.length);
  for (const piece of network.pieces) for (const id of piece.nodes) nodeStructures[id] = (nodeStructures[id] ?? 0) | STRUCTURE_BIT[piece.structure];
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
  index = { nodeXyz, lines, nodeStructures, pieceByKey: new Map(network.pieces.map((p) => [p.key, p])) };
  indexes.set(network, index);
  return index;
}

const scratchWorld = new Vector3();
const screenA = { x: 0, y: 0 };
const screenB = { x: 0, y: 0 };

function project(view: IsoView, x: number, y: number, z: number, out: { x: number; y: number }): { x: number; y: number } {
  return worldToScreen(view, simToWorld(x, y, z, scratchWorld), out);
}

/** Distance from point p to segment ab, all on screen, and the segment parameter of the nearest point. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number, out: { t: number }): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  out.t = t;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** A candidate under the pixel: a node or a piece, with its height and screen distance. */
interface Candidate {
  readonly kind: "node" | "piece";
  readonly index: number;
  readonly zM: number;
  readonly px: number;
}

function allowed(bits: number, v: PickVisibility): boolean {
  return (bits & STRUCTURE_BIT.ground) !== 0 || (v.decks && (bits & STRUCTURE_BIT.bridge) !== 0) || (v.tunnels && (bits & STRUCTURE_BIT.tunnel) !== 0);
}

const segment = { t: 0 };

/**
 * Every pick at CSS pixel (sx, sy), front first: one per level of stacked track (see the module note), then
 * the terrain pick. `ground` is the terrain hit on the sim plan (metres), or null when the ray misses the map;
 * with no hit nothing is picked.
 */
export function pickTrackStack(
  network: NetworkView,
  view: IsoView,
  sx: number,
  sy: number,
  ground: { readonly x: number; readonly y: number } | null,
  options: PickOptions = {},
): ScreenPick[] {
  if (!ground) return [];
  const index = indexOf(network);
  const visibility = options.visibility ?? DEFAULT_PICK_VISIBILITY;
  const r = PICK_SEARCH_RADIUS_M;
  const candidates: Candidate[] = [];

  for (let i = 0; i < network.nodes.length; i++) {
    const x = index.nodeXyz[i * 3] ?? 0;
    const y = index.nodeXyz[i * 3 + 1] ?? 0;
    if (Math.abs(x - ground.x) > r || Math.abs(y - ground.y) > r) continue;
    if (!allowed(index.nodeStructures[i] ?? 0, visibility)) continue;
    const z = index.nodeXyz[i * 3 + 2] ?? 0;
    const s = project(view, x, y, z, screenA);
    const d = Math.hypot(s.x - sx, s.y - sy);
    if (d <= NODE_PICK_RADIUS_PX) candidates.push({ kind: "node", index: i, zM: z, px: d });
  }

  for (let i = 0; i < index.lines.length; i++) {
    const line = index.lines[i];
    const piece = network.pieces[i];
    if (!line || !piece || !allowed(STRUCTURE_BIT[piece.structure], visibility)) continue;
    if (line.maxX < ground.x - r || line.minX > ground.x + r || line.maxY < ground.y - r || line.minY > ground.y + r) continue;
    const pts = line.points;
    let best = TRACK_PICK_RADIUS_PX;
    let bestZ = Number.NaN;
    project(view, pts[0] ?? 0, pts[1] ?? 0, pts[2] ?? 0, screenA);
    for (let k = 3; k < pts.length; k += 3) {
      project(view, pts[k] ?? 0, pts[k + 1] ?? 0, pts[k + 2] ?? 0, screenB);
      const d = segmentDistance(sx, sy, screenA.x, screenA.y, screenB.x, screenB.y, segment);
      if (d <= best) {
        best = d;
        bestZ = (pts[k - 1] ?? 0) + ((pts[k + 2] ?? 0) - (pts[k - 1] ?? 0)) * segment.t;
      }
      screenA.x = screenB.x;
      screenA.y = screenB.y;
    }
    if (!Number.isNaN(bestZ)) candidates.push({ kind: "piece", index: i, zM: bestZ, px: best });
  }

  for (const hit of options.proxies ?? []) {
    const piece = index.pieceByKey.get(hit.key);
    if (!piece || !allowed(STRUCTURE_BIT[piece.structure], visibility)) continue;
    candidates.push({ kind: "piece", index: piece.id, zM: hit.zM + PICK_LIFT_M, px: 0 });
  }

  // Levels by height, highest (nearest the camera) first; within a level nodes beat pieces, nearer beats farther.
  candidates.sort((a, b) => b.zM - a.zM);
  const picks: ScreenPick[] = [];
  let i = 0;
  while (i < candidates.length) {
    const top = candidates[i]?.zM ?? 0;
    let bestNode: Candidate | undefined;
    let bestPiece: Candidate | undefined;
    while (i < candidates.length && (candidates[i]?.zM ?? 0) >= top - LEVEL_BAND_M) {
      const c = candidates[i] as Candidate;
      if (c.kind === "node" && (!bestNode || c.px < bestNode.px)) bestNode = c;
      if (c.kind === "piece" && (!bestPiece || c.px < bestPiece.px)) bestPiece = c;
      i++;
    }
    const pick = bestNode ? nodePick(network, bestNode.index) : bestPiece ? piecePick(network, index, view, sx, sy, bestPiece.index) : undefined;
    if (pick) picks.push(pick);
  }

  const q = nearestNode(ground);
  picks.push({ kind: "ground", xM: ground.x, yM: ground.y, q: q.q, r: q.r });
  return picks;
}

function nodePick(network: NetworkView, i: number): ScreenPick | undefined {
  const node = network.nodes[i];
  return node ? { kind: "node", node } : undefined;
}

/** A piece pick with its nearer end on screen: where a turnout would leave it. */
function piecePick(network: NetworkView, index: PickIndex, view: IsoView, sx: number, sy: number, i: number): ScreenPick | undefined {
  const piece = network.pieces[i];
  if (!piece) return undefined;
  const [a, b] = piece.nodes.map((id) => network.nodes[id]);
  if (!a || !b) return undefined;
  const sa = project(view, index.nodeXyz[a.id * 3] ?? 0, index.nodeXyz[a.id * 3 + 1] ?? 0, index.nodeXyz[a.id * 3 + 2] ?? 0, screenA);
  const da = Math.hypot(sa.x - sx, sa.y - sy);
  const sb = project(view, index.nodeXyz[b.id * 3] ?? 0, index.nodeXyz[b.id * 3 + 1] ?? 0, index.nodeXyz[b.id * 3 + 2] ?? 0, screenB);
  const db = Math.hypot(sb.x - sx, sb.y - sy);
  return { kind: "piece", piece, node: da <= db ? a : b };
}

/**
 * Picks at CSS pixel (sx, sy): the front of `pickTrackStack`. `ground` is the terrain hit on the sim plan
 * (metres) or null when the ray misses the map; with no hit nothing is picked.
 */
export function pickTrack(
  network: NetworkView,
  view: IsoView,
  sx: number,
  sy: number,
  ground: { readonly x: number; readonly y: number } | null,
  options: PickOptions = {},
): ScreenPick | null {
  return pickTrackStack(network, view, sx, sy, ground, options)[0] ?? null;
}
