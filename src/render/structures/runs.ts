import { type GroundQuery, type NetworkNode, type NetworkPiece, type NetworkView, type Structure, type Terrain, isPortal } from "../../core/sim/api";

/**
 * Structure runs (issue #68 "Render"): the network's bridge and tunnel pieces
 * grouped into maximal chains of one structure, read from the network view only
 * (render never decides connectivity, it follows `derive`'s sections). A run is
 * what the renderer builds as one structure: a bridge run gets a span layout
 * (`layout.ts`), a tunnel run gets a portal at each end that opens to daylight.
 *
 * Sections walk plain track between buffers (and whole loops); a run is a
 * maximal stretch of one section whose pieces share a structure. Each end says
 * what lies beyond it: the structure of the piece that continues there, or a
 * buffer. Junctions (D5) split sections at switches; the end kind then reads the
 * node's other pieces, preferring ground, so a run ending at a switch still gets
 * an abutment or a portal.
 */

export type RunStructure = Exclude<Structure, "ground">;
/** What lies beyond a run's end. */
export type RunEnd = Structure | "buffer";

export interface RunPiece {
  readonly piece: NetworkPiece;
  /** True when the run travels the piece from → to (its canonical direction). */
  readonly forward: boolean;
}

export interface StructureRun {
  readonly structure: RunStructure;
  /** The pieces in travel order. */
  readonly pieces: readonly RunPiece[];
  /** The first and last node in travel order (the same node for a closed loop). */
  readonly nodes: readonly [NetworkNode, NetworkNode];
  /** What lies beyond each end; null for a closed loop, which has no ends. */
  readonly ends: readonly [RunEnd | null, RunEnd | null];
  readonly closed: boolean;
  /** Identity: the structure and the sorted piece keys. */
  readonly key: string;
}

/** Every bridge and tunnel run of the network, in section order. */
export function structureRuns(network: NetworkView): StructureRun[] {
  const runs: StructureRun[] = [];
  for (const section of network.sections) {
    const n = section.pieces.length;
    const pieces: RunPiece[] = [];
    for (let i = 0; i < n; i++) {
      const piece = network.pieces[section.pieces[i] ?? -1];
      if (piece) pieces.push({ piece, forward: section.forward[i] ?? true });
    }
    if (pieces.length === 0) continue;
    const structureAt = (i: number): Structure => (pieces[((i % pieces.length) + pieces.length) % pieces.length] as RunPiece).piece.structure;
    // A closed loop starts at a change of structure, so no run wraps around its seam.
    let start = 0;
    if (section.closed) {
      start = -1;
      for (let i = 0; i < pieces.length; i++) {
        if (structureAt(i) !== structureAt(i - 1)) {
          start = i;
          break;
        }
      }
      if (start < 0) {
        // One structure all the way round.
        const s = structureAt(0);
        if (s !== "ground") {
          const node = nodeAt(network, pieces[0] as RunPiece, 0);
          if (node) runs.push(makeRun(s, pieces, [node, node], [null, null], true));
        }
        continue;
      }
    }
    const ordered = start === 0 ? pieces : [...pieces.slice(start), ...pieces.slice(0, start)];
    let i = 0;
    while (i < ordered.length) {
      const s = (ordered[i] as RunPiece).piece.structure;
      let j = i;
      while (j + 1 < ordered.length && (ordered[j + 1] as RunPiece).piece.structure === s) j++;
      if (s !== "ground") {
        const chain = ordered.slice(i, j + 1);
        const first = chain[0] as RunPiece;
        const last = chain[chain.length - 1] as RunPiece;
        const a = nodeAt(network, first, 0);
        const b = nodeAt(network, last, 1);
        if (a && b) {
          const own = new Set(chain.map((p) => p.piece.id));
          runs.push(makeRun(s, chain, [a, b], [endKind(network, a, own), endKind(network, b, own)], false));
        }
      }
      i = j + 1;
    }
  }
  return runs;
}

function makeRun(
  structure: RunStructure,
  pieces: readonly RunPiece[],
  nodes: readonly [NetworkNode, NetworkNode],
  ends: readonly [RunEnd | null, RunEnd | null],
  closed: boolean,
): StructureRun {
  const keys = pieces.map((p) => p.piece.key).sort();
  return { structure, pieces, nodes, ends, closed, key: `${structure}:${keys.join(";")}` };
}

/** The node where a run piece starts (`end` 0) or ends (1) in travel order. */
function nodeAt(network: NetworkView, p: RunPiece, end: 0 | 1): NetworkNode | undefined {
  const [from, to] = p.piece.nodes;
  const id = (end === 0) === p.forward ? from : to;
  return network.nodes[id];
}

/** What lies beyond a run's end node: another piece's structure (ground first), or a buffer. */
function endKind(network: NetworkView, node: NetworkNode, own: ReadonlySet<number>): RunEnd {
  let best: RunEnd = "buffer";
  for (const port of [...node.ports.a, ...node.ports.b]) {
    if (own.has(port.piece)) continue;
    const s = network.pieces[port.piece]?.structure;
    if (s === "ground") return "ground";
    if (s === "bridge" || (s === "tunnel" && best === "buffer")) best = s;
  }
  return best;
}

/**
 * Whether a tunnel run's end opens to daylight: into ground or a bridge (a
 * transition), or at a buffer the core counts as a portal (`isPortal`: the
 * track within the ±8 m band of the ground there, GROUND_BAND_MM, over the
 * core's effective ground when `ground` is given, else the natural terrain).
 * A deeper dead end inside a hill gets no portal. Until the D4 second
 * feel-check fixes (2026-09-28) the renderer opened one under up to 12 m of
 * natural cover: 28 of the 30 buffer portals in the committed population lay
 * in that 8–12 m gap, fully buried.
 */
export function isPortalEnd(terrain: Terrain, run: StructureRun, end: 0 | 1, ground: GroundQuery | null = null): boolean {
  if (run.structure !== "tunnel" || run.closed) return false;
  const kind = run.ends[end];
  if (kind === "ground" || kind === "bridge") return true;
  if (kind !== "buffer") return false;
  return isPortal(terrain, run.nodes[end], ground);
}
