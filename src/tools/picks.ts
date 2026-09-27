import { type NetworkNode, type NetworkView, type PlanPointMm, toWorld } from "../core/sim/api";
import type { ToolPick } from "./types";

/**
 * Picks as the tools see them, built from the network view: pure functions
 * of one network revision. `src/app` uses them to turn render's screen picks
 * into tool picks, and the track tool uses them for the keyboard cursor.
 */

const indexes = new WeakMap<NetworkView, ReadonlyMap<string, readonly NetworkNode[]>>();

/** Existing nodes at lattice position (q, r), highest first (a bridge over a track has two). */
export function nodesAt(network: NetworkView, q: number, r: number): readonly NetworkNode[] {
  let index = indexes.get(network);
  if (!index) {
    const map = new Map<string, NetworkNode[]>();
    for (const node of network.nodes) {
      const key = `${node.q},${node.r}`;
      const list = map.get(key);
      if (list) list.push(node);
      else map.set(key, [node]);
    }
    for (const list of map.values()) list.sort((a, b) => b.zMm - a.zMm);
    index = map;
    indexes.set(network, index);
  }
  return index.get(`${q},${r}`) ?? [];
}

/** A lattice node's plan position in integer mm (for drag targets, never for keys). */
export function planPointOfNode(q: number, r: number): PlanPointMm {
  const w = toWorld({ q, r });
  return { xMm: Math.round(w.x * 1000), yMm: Math.round(w.y * 1000) };
}

/** An existing node as a pick: a buffer is an endpoint, anything else is track. */
export function pickOfNetworkNode(network: NetworkView, node: NetworkNode): ToolPick {
  const at = { q: node.q, r: node.r, zMm: node.zMm };
  const pointMm = planPointOfNode(node.q, node.r);
  if (node.kind === "buffer") return { kind: "endpoint", node: at, pointMm };
  const port = node.ports.a[0] ?? node.ports.b[0];
  const piece = port === undefined ? undefined : network.pieces[port.piece];
  return piece === undefined ? { kind: "track", node: at, pointMm } : { kind: "track", node: at, pointMm, pieceKey: piece.key };
}

/**
 * The pick at a lattice node: the highest existing node there, or a free node
 * at terrain height. Null off the map.
 */
export function pickAtNode(
  network: NetworkView,
  groundZmm: (q: number, r: number) => number | undefined,
  q: number,
  r: number,
): ToolPick | null {
  const existing = nodesAt(network, q, r)[0];
  if (existing) return pickOfNetworkNode(network, existing);
  const zMm = groundZmm(q, r);
  if (zMm === undefined) return null;
  return { kind: "node", node: { q, r, zMm }, pointMm: planPointOfNode(q, r) };
}
