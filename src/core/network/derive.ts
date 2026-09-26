import { type NodeRef, type PieceKey, type PieceKind, type Structure, compareNodes, nodeKey } from "../geometry/piece";
import type { RenderPrim } from "../geometry/templates";
import { type Heading, opposite } from "../lattice";
import type { AuthoredState } from "../track/authored";

/**
 * The derived network (simulation model §10): a pure function of the
 * authored pieces. Pieces are sorted by key before any ID is assigned, nodes
 * by (q, r, z), and every walk starts from the smallest ID, so the result is
 * identical for any insertion order. IDs hold for one network revision only:
 * never persist them or put them in commands.
 *
 * D2 knows two node kinds, as validation allows only these: through (one
 * port on each side of the node's axis) and buffer (one port). Sections are
 * maximal chains between buffers; a closed loop is one section. D5 adds
 * switches and diamonds, later slices split sections at signals, platforms
 * and depots.
 */

export interface NetworkPiece {
  readonly id: number;
  readonly key: PieceKey;
  readonly kind: PieceKind;
  readonly structure: Structure;
  readonly lengthMm: number;
  readonly z0Mm: number;
  readonly z1Mm: number;
  readonly speedLimitMms: number;
  readonly prims: readonly RenderPrim[];
  /** Node IDs of [from, to]. */
  readonly nodes: readonly [number, number];
  readonly section: number;
}

/** A piece end attached to a node. */
export interface Port {
  readonly piece: number;
  readonly end: 0 | 1;
}

export interface NetworkNode {
  readonly id: number;
  readonly q: number;
  readonly r: number;
  readonly zMm: number;
  /** through = ports (1, 1); buffer = ports (1, 0). */
  readonly kind: "through" | "buffer";
  /**
   * Outward heading of side A. Side A is the populated side of a buffer, and
   * the side whose outward heading is 0–5 at a through node.
   */
  readonly axis: Heading;
  readonly ports: { readonly a: readonly Port[]; readonly b: readonly Port[] };
}

export interface Section {
  readonly id: number;
  /** Piece IDs in travel order. */
  readonly pieces: readonly number[];
  /** Per piece: true when travelled from → to. */
  readonly forward: readonly boolean[];
  /** Node IDs where the section starts and ends (equal for a closed loop). */
  readonly nodes: readonly [number, number];
  readonly lengthMm: number;
  readonly closed: boolean;
}

export interface Network {
  readonly pieces: readonly NetworkPiece[];
  readonly nodes: readonly NetworkNode[];
  readonly sections: readonly Section[];
}

interface Attachment {
  readonly piece: number;
  readonly end: 0 | 1;
  readonly outward: Heading;
}

export function derive(authored: AuthoredState): Network {
  const keys = [...authored.pieces.keys()].sort();
  const pieces = keys.map((k) => {
    const p = authored.pieces.get(k);
    if (!p) throw new Error(`derive: missing ${k}`);
    return p;
  });

  const byNode = new Map<string, { node: NodeRef; attached: Attachment[] }>();
  pieces.forEach((p, id) => {
    p.ends.forEach((end, e) => {
      const k = nodeKey(end.node);
      let slot = byNode.get(k);
      if (!slot) {
        slot = { node: end.node, attached: [] };
        byNode.set(k, slot);
      }
      slot.attached.push({ piece: id, end: e === 0 ? 0 : 1, outward: end.outward });
    });
  });

  const slots = [...byNode.values()].sort((a, b) => compareNodes(a.node, b.node));
  const nodeIdOf = new Map<string, number>();
  const nodes: NetworkNode[] = slots.map((slot, id) => {
    nodeIdOf.set(nodeKey(slot.node), id);
    return classify(id, slot.node, slot.attached);
  });

  const pieceNodes: [number, number][] = pieces.map((p) => [
    nodeIdOf.get(nodeKey(p.ends[0].node)) ?? -1,
    nodeIdOf.get(nodeKey(p.ends[1].node)) ?? -1,
  ]);
  const sections = walkSections(pieces.map((p) => p.lengthMm), pieceNodes, nodes);
  const sectionOf = new Array<number>(pieces.length).fill(-1);
  for (const s of sections) for (const pid of s.pieces) sectionOf[pid] = s.id;

  return {
    pieces: pieces.map((p, id) => ({
      id,
      key: p.key,
      kind: p.kind,
      structure: p.structure,
      lengthMm: p.lengthMm,
      z0Mm: p.ends[0].node.zMm,
      z1Mm: p.ends[1].node.zMm,
      speedLimitMms: p.speedLimitMms,
      prims: p.prims,
      nodes: pieceNodes[id] ?? [-1, -1],
      section: sectionOf[id] ?? -1,
    })),
    nodes,
    sections,
  };
}

function classify(id: number, node: NodeRef, attached: readonly Attachment[]): NetworkNode {
  const [first, second] = attached;
  const port = (x: Attachment): Port => ({ piece: x.piece, end: x.end });
  const base = { id, q: node.q, r: node.r, zMm: node.zMm };
  if (attached.length === 1 && first) {
    return { ...base, kind: "buffer", axis: first.outward, ports: { a: [port(first)], b: [] } };
  }
  if (attached.length === 2 && first && second && second.outward === opposite(first.outward)) {
    const [a, b] = first.outward < 6 ? [first, second] : [second, first];
    return { ...base, kind: "through", axis: a.outward, ports: { a: [port(a)], b: [port(b)] } };
  }
  throw new Error(`derive: node ${nodeKey(node)} has ${attached.length} pieces that are not plain track (junctions arrive in D5)`);
}

function walkSections(lengths: readonly number[], pieceNodes: readonly [number, number][], nodes: readonly NetworkNode[]): Section[] {
  const visited = new Array<boolean>(lengths.length).fill(false);
  const sections: Section[] = [];

  /** The piece end continuing through the node at `pid`'s end `end`, or null at a buffer. */
  const across = (pid: number, end: 0 | 1): Port | null => {
    const node = nodes[pieceNodes[pid]?.[end] ?? -1];
    if (!node || node.kind === "buffer") return null;
    const [a] = node.ports.a;
    const [b] = node.ports.b;
    if (!a || !b) return null;
    return a.piece === pid && a.end === end ? b : a;
  };

  const walk = (startPiece: number, startEnd: 0 | 1, closedStart: boolean): void => {
    const ids: number[] = [];
    const forward: boolean[] = [];
    let lengthMm = 0;
    let pid = startPiece;
    let enter: 0 | 1 = startEnd;
    let endNode = -1;
    for (;;) {
      visited[pid] = true;
      ids.push(pid);
      forward.push(enter === 0);
      lengthMm += lengths[pid] ?? 0;
      const exit: 0 | 1 = enter === 0 ? 1 : 0;
      const next = across(pid, exit);
      if (next === null || (closedStart && next.piece === startPiece)) {
        endNode = pieceNodes[pid]?.[exit] ?? -1;
        break;
      }
      pid = next.piece;
      enter = next.end;
    }
    const startNode = pieceNodes[startPiece]?.[startEnd] ?? -1;
    sections.push({ id: sections.length, pieces: ids, forward, nodes: [startNode, endNode], lengthMm, closed: closedStart });
  };

  for (const node of nodes) {
    const [port] = node.ports.a;
    if (node.kind === "buffer" && port && !visited[port.piece]) walk(port.piece, port.end, false);
  }
  for (let pid = 0; pid < lengths.length; pid++) if (!visited[pid]) walk(pid, 0, true);
  return sections;
}
