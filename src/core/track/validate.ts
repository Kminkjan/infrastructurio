import { type ClearanceIndex, createClearanceIndex } from "../geometry/clearance";
import {
  type NodeRef,
  type Piece,
  type PieceKey,
  type PieceSpec,
  type SpecFailure,
  type SpecFailureCode,
  type Structure,
  isNodeRef,
  nodeKey,
  pieceFromKey,
  resolvePiece,
} from "../geometry/piece";
import { type Heading, opposite } from "../lattice";
import { type Terrain, offsetOfNode, terrainBoundsM } from "../terrain";
import { divFloor } from "../util/int";
import { type AuthoredState, type Diff, type PieceRecord, makeDiff, recordOf } from "./authored";

/**
 * The single construction validator (simulation model §9). `preview` and
 * `execute` both call `validate`; it never mutates.
 *
 * Rules run in the fixed order of RULE_ORDER and the first failure returns
 * exactly one reason plus highlight keys. Inside a family, codes are tried in
 * catalogue order and, for each code, pieces in command order. Grade and
 * terrain/structure (D4), entities (D6/D7) and the operational track-in-use
 * check (D10) are ordered placeholders that pass today, so later items slot in
 * without reordering any outcome.
 *
 * Messages read "<what is wrong>; <how to fix it>." and carry numbers.
 */

/** Reason codes implemented so far (D2). Later slices append; shipped codes are never renamed. */
export const REASON_CODES = Object.freeze([
  "out-of-bounds",
  "limit-reached",
  "unknown-target",
  "radius-too-tight",
  "turn-too-sharp",
  "no-fit",
  "kinked-join",
  "tracks-too-close",
  "undo-empty",
  "redo-empty",
  "undo-blocked",
] as const);
export type ReasonCode = (typeof REASON_CODES)[number];

export const RULE_ORDER = Object.freeze([
  "structural",
  "geometry",
  "grade",
  "terrain-structure",
  "node-topology",
  "clearance",
  "entities",
  "operational",
] as const);
export type RuleFamily = (typeof RULE_ORDER)[number];

export const MAX_PIECES = 5000;

/** What a reason points at: a committed or proposed piece, a node, or a command's spec by index. */
export type Ref =
  | { readonly kind: "piece"; readonly key: PieceKey }
  | { readonly kind: "node"; readonly node: NodeRef }
  | { readonly kind: "spec"; readonly index: number };

export interface Reason {
  readonly code: ReasonCode;
  readonly message: string;
  readonly refs: readonly Ref[];
  /** For `undo-blocked`: the reason the undo or redo diff failed. */
  readonly cause?: Reason;
}

export interface Rejection {
  readonly ok: false;
  readonly reason: Reason;
  readonly highlight: readonly PieceKey[];
}

export interface Counts {
  /** Pieces this command adds. */
  readonly new: number;
  /** Pieces a build names that already exist (their keys were found). */
  readonly reused: number;
}

export interface Accepted {
  readonly ok: true;
  readonly diff: Diff;
  readonly counts: Counts;
}

export type Validation = Accepted | Rejection;

export type StructureChoice = Structure | "auto";

export type Proposal =
  | { readonly kind: "build"; readonly specs: readonly PieceSpec[]; readonly structure: Structure }
  | { readonly kind: "demolish"; readonly keys: readonly PieceKey[] }
  | { readonly kind: "apply"; readonly diff: Diff };

/** A piece touching a node, with its heading pointing away from the node into the piece. */
export interface NodeEntry {
  readonly key: PieceKey;
  readonly outward: Heading;
}

/** Incremental lookups over the committed pieces; only commits change them. */
export interface TrackIndex {
  readonly nodes: Map<string, NodeEntry[]>;
  /**
   * The heights of the committed nodes at each lattice position, keyed "q,r":
   * ascending and distinct (a bridge over a track holds two). The planner pins
   * its node heights to them.
   */
  readonly heights: Map<string, number[]>;
  readonly clearance: ClearanceIndex;
}

export interface TrackContext {
  readonly terrain: Terrain;
  readonly authored: AuthoredState;
  readonly index: TrackIndex;
}

/**
 * Maps the command's structure choice to a stored structure. D2 resolves
 * `auto` to ground; D4 adds inference from terrain height and water.
 */
export function resolveStructure(choice: StructureChoice): Structure {
  if (choice === "ground" || choice === "bridge" || choice === "tunnel") return choice;
  if (choice === "auto") return "ground";
  throw new TypeError(`unknown structure ${String(choice)}`);
}

export function createTrackIndex(pieces: Iterable<Piece> = []): TrackIndex {
  const index: TrackIndex = { nodes: new Map(), heights: new Map(), clearance: createClearanceIndex() };
  for (const p of pieces) indexAdd(index, p);
  return index;
}

const NO_HEIGHTS: readonly number[] = Object.freeze([]);

/** The committed node heights at lattice position (q, r), ascending; empty where no track is. */
export function heightsAt(index: TrackIndex, q: number, r: number): readonly number[] {
  return index.heights.get(`${q},${r}`) ?? NO_HEIGHTS;
}

function addHeight(index: TrackIndex, n: NodeRef): void {
  const k = `${n.q},${n.r}`;
  const list = index.heights.get(k);
  if (!list) {
    index.heights.set(k, [n.zMm]);
    return;
  }
  let i = 0;
  while (i < list.length && (list[i] ?? 0) < n.zMm) i++;
  if (list[i] !== n.zMm) list.splice(i, 0, n.zMm);
}

function removeHeight(index: TrackIndex, n: NodeRef): void {
  const k = `${n.q},${n.r}`;
  const rest = (index.heights.get(k) ?? []).filter((z) => z !== n.zMm);
  if (rest.length > 0) index.heights.set(k, rest);
  else index.heights.delete(k);
}

export function indexAdd(index: TrackIndex, piece: Piece): void {
  for (const end of piece.ends) {
    const k = nodeKey(end.node);
    const list = index.nodes.get(k);
    const entry = { key: piece.key, outward: end.outward };
    if (list) list.push(entry);
    else {
      index.nodes.set(k, [entry]);
      addHeight(index, end.node);
    }
  }
  index.clearance.insert(piece);
}

export function indexRemove(index: TrackIndex, piece: Piece): void {
  for (const end of piece.ends) {
    const k = nodeKey(end.node);
    const rest = (index.nodes.get(k) ?? []).filter((e) => e.key !== piece.key);
    if (rest.length > 0) index.nodes.set(k, rest);
    else {
      index.nodes.delete(k);
      removeHeight(index, end.node);
    }
  }
  index.clearance.remove(piece.key);
}

interface SpecOutcome {
  readonly index: number;
  readonly from: unknown;
  readonly piece?: Piece;
  readonly failure?: SpecFailure;
}

interface Prepared {
  /** Build only: one outcome per spec, in command order. */
  readonly specs: readonly SpecOutcome[];
  /** Unique pieces this proposal adds, in command order. */
  readonly added: readonly Piece[];
  /** Committed pieces this proposal removes. */
  readonly removed: readonly Piece[];
  /** Targets that name no committed piece. */
  readonly unknown: readonly string[];
  readonly reused: number;
  /** Pieces the limit counts: new keys plus specs that did not resolve. */
  readonly limitCount: number;
}

function prepare(ctx: TrackContext, proposal: Proposal): Prepared {
  const pieces = ctx.authored.pieces;
  if (proposal.kind === "build") {
    const specs: SpecOutcome[] = [];
    const added: Piece[] = [];
    const seen = new Set<PieceKey>();
    let reused = 0;
    let limitCount = 0;
    proposal.specs.forEach((spec, index) => {
      const from: unknown = typeof spec === "object" && spec !== null ? spec.from : undefined;
      const res = resolvePiece(spec, proposal.structure);
      if (!res.ok) {
        specs.push({ index, from, failure: res.failure });
        limitCount += 1;
        return;
      }
      specs.push({ index, from, piece: res.piece });
      // A piece named twice in one command counts once.
      if (seen.has(res.piece.key)) return;
      seen.add(res.piece.key);
      if (pieces.has(res.piece.key)) reused += 1;
      else {
        added.push(res.piece);
        limitCount += 1;
      }
    });
    return { specs, added, removed: [], unknown: [], reused, limitCount };
  }

  if (proposal.kind === "demolish") {
    const removed: Piece[] = [];
    const unknown: string[] = [];
    const seen = new Set<PieceKey>();
    for (const key of proposal.keys) {
      // Accept a key written from either end; the committed map holds the canonical one.
      const existing = pieces.get(key) ?? lookupCanonical(pieces, key);
      if (!existing) unknown.push(String(key));
      else if (!seen.has(existing.key)) {
        seen.add(existing.key);
        removed.push(existing);
      }
    }
    return { specs: [], added: [], removed, unknown, reused: 0, limitCount: 0 };
  }

  const removed: Piece[] = [];
  const unknown: string[] = [];
  for (const r of proposal.diff.removed) {
    const existing = pieces.get(r.key);
    if (existing) removed.push(existing);
    else unknown.push(r.key);
  }
  const removedKeys = new Set(removed.map((p) => p.key));
  const added: Piece[] = [];
  for (const r of proposal.diff.added) {
    // Already present (only possible for a history loaded out of step): nothing to add.
    if (pieces.has(r.key) && !removedKeys.has(r.key)) continue;
    const piece = pieceFromKey(r.key, r.structure);
    if (!piece || piece.key !== r.key) throw new Error(`history holds a non-canonical key ${r.key}`);
    added.push(piece);
  }
  return { specs: [], added, removed, unknown, reused: 0, limitCount: added.length };
}

function lookupCanonical(pieces: ReadonlyMap<PieceKey, Piece>, key: unknown): Piece | undefined {
  const canonical = pieceFromKey(key)?.key;
  return canonical === undefined ? undefined : pieces.get(canonical);
}

function reject(code: ReasonCode, message: string, refs: readonly Ref[], highlight: readonly PieceKey[] = []): Rejection {
  return { ok: false, reason: { code, message, refs }, highlight };
}

/** Millimetres as metres for messages: whole mm, trailing zeros trimmed. */
function formatMetres(mm: number): string {
  const sign = mm < 0 ? "-" : "";
  const abs = Math.abs(mm);
  const whole = divFloor(abs, 1000);
  const frac = String(abs - whole * 1000).padStart(3, "0").replace(/0+$/, "");
  return `${sign}${whole}${frac ? `.${frac}` : ""}`;
}

function describeNode(n: NodeRef): string {
  return `(${n.q}, ${n.r}) at ${formatMetres(n.zMm)} m`;
}

function nodeOnMap(terrain: Terrain, n: NodeRef): boolean {
  return offsetOfNode(terrain, n) !== undefined;
}

/** Tolerance for float curve bounds touching the map edge. */
const BOUNDS_EPS_M = 1e-6;

/** Both end nodes on the map, and the drawn centreline inside the map's extent. */
function pieceOnMap(terrain: Terrain, p: Piece): boolean {
  if (!nodeOnMap(terrain, p.ends[0].node) || !nodeOnMap(terrain, p.ends[1].node)) return false;
  const m = terrainBoundsM(terrain);
  const b = p.boundsM;
  return (
    b.minX >= m.minX - BOUNDS_EPS_M &&
    b.maxX <= m.maxX + BOUNDS_EPS_M &&
    b.minY >= m.minY - BOUNDS_EPS_M &&
    b.maxY <= m.maxY + BOUNDS_EPS_M
  );
}

function outOfBoundsMessage(terrain: Terrain, what: string): string {
  return `${what} leaves the ${terrain.columns} × ${terrain.rows}-node map; keep the track inside the map.`;
}

function structural(ctx: TrackContext, p: Prepared): Rejection | null {
  const { terrain } = ctx;
  for (const s of p.specs) {
    if (s.failure?.code === "out-of-bounds") return reject("out-of-bounds", s.failure.message, [{ kind: "spec", index: s.index }]);
    if (s.piece) {
      if (!pieceOnMap(terrain, s.piece)) {
        return reject(
          "out-of-bounds",
          outOfBoundsMessage(terrain, `Piece ${s.index + 1} (from ${describeNode(isNodeRef(s.from) ? s.from : s.piece.spec.from)})`),
          [{ kind: "spec", index: s.index }, { kind: "piece", key: s.piece.key }],
          [s.piece.key],
        );
      }
    } else if (isNodeRef(s.from) && !nodeOnMap(terrain, s.from)) {
      return reject("out-of-bounds", outOfBoundsMessage(terrain, `Piece ${s.index + 1} (from ${describeNode(s.from)})`), [
        { kind: "spec", index: s.index },
      ]);
    }
  }
  if (p.specs.length === 0) {
    for (const piece of p.added) {
      if (!pieceOnMap(terrain, piece)) {
        return reject("out-of-bounds", outOfBoundsMessage(terrain, `Piece ${piece.key}`), [{ kind: "piece", key: piece.key }], [piece.key]);
      }
    }
  }

  const after = ctx.authored.pieces.size - p.removed.length + p.limitCount;
  if (p.limitCount > 0 && after > MAX_PIECES) {
    const free = Math.max(0, MAX_PIECES - (ctx.authored.pieces.size - p.removed.length));
    return reject(
      "limit-reached",
      `This needs ${p.limitCount} new pieces but only ${free} of the ${MAX_PIECES} are left; demolish unused track first.`,
      [],
    );
  }

  const missing = p.unknown[0];
  if (missing !== undefined) {
    return reject("unknown-target", `No piece ${missing} exists (it may have been removed); refresh the target and try again.`, [
      { kind: "piece", key: missing },
    ]);
  }
  return null;
}

const GEOMETRY_ORDER: readonly SpecFailureCode[] = ["radius-too-tight", "turn-too-sharp", "no-fit"];

function geometry(_ctx: TrackContext, p: Prepared): Rejection | null {
  for (const code of GEOMETRY_ORDER) {
    const s = p.specs.find((o) => o.failure?.code === code);
    if (s?.failure) return reject(code, s.failure.message, [{ kind: "spec", index: s.index }]);
  }
  return null;
}

function passes(): Rejection | null {
  return null;
}

/** Why the pieces at one node do not form plain track, or null when they do. */
function joinProblem(n: NodeRef, entries: readonly NodeEntry[]): string | null {
  if (entries.length <= 1) return null;
  const [a, b] = entries;
  if (entries.length === 2 && a && b) {
    if (b.outward === opposite(a.outward)) return null;
    if (b.outward === a.outward) {
      return `Two pieces leave node ${describeNode(n)} in the same direction, and junctions are not buildable yet; end the track at a free node or adjust the end heading.`;
    }
    const steps = (((b.outward - opposite(a.outward)) % 12) + 12) % 12;
    const kink = Math.min(steps, 12 - steps) * 30;
    return `Pieces meet at node ${describeNode(n)} with a ${kink}° kink instead of running straight through; adjust the end heading so the track continues straight.`;
  }
  return `${entries.length} pieces meet at node ${describeNode(n)}, but only plain track (two pieces running straight through) is buildable yet; move a piece to another node.`;
}

/**
 * Node topology for D2: a node holds one piece (buffer) or two with opposite
 * outward headings (through). A second piece on the same side (a turnout,
 * D5) and any other join are rejected as `kinked-join`, the only D2
 * topology code; D5 replaces the same-side case with real turnouts.
 */
function nodeTopology(ctx: TrackContext, p: Prepared): Rejection | null {
  if (p.added.length === 0) return null;
  const removed = new Set(p.removed.map((r) => r.key));
  const addedAt = new Map<string, NodeEntry[]>();
  for (const piece of p.added) {
    for (const end of piece.ends) {
      const k = nodeKey(end.node);
      addedAt.set(k, [...(addedAt.get(k) ?? []), { key: piece.key, outward: end.outward }]);
    }
  }
  const checked = new Set<string>();
  for (const piece of p.added) {
    for (const end of piece.ends) {
      const k = nodeKey(end.node);
      if (checked.has(k)) continue;
      checked.add(k);
      const entries = [...(ctx.index.nodes.get(k) ?? []).filter((e) => !removed.has(e.key)), ...(addedAt.get(k) ?? [])].sort(
        (x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0),
      );
      const problem = joinProblem(end.node, entries);
      if (problem) {
        const keys = entries.map((e) => e.key);
        return reject(
          "kinked-join",
          problem,
          [{ kind: "node", node: end.node }, ...keys.map((key): Ref => ({ kind: "piece", key }))],
          keys,
        );
      }
    }
  }
  return null;
}

function clearance(ctx: TrackContext, p: Prepared): Rejection | null {
  if (p.added.length === 0) return null;
  const hit = ctx.index.clearance.findConflict(p.added, new Set(p.removed.map((r) => r.key)));
  if (!hit) return null;
  return reject(
    "tracks-too-close",
    `Tracks ${hit.piece} and ${hit.other} come ${hit.distanceM.toFixed(2)} m apart, but need 4.0 m (or 6.5 m of height difference); move the tracks apart.`,
    [
      { kind: "piece", key: hit.piece },
      { kind: "piece", key: hit.other },
    ],
    [hit.piece, hit.other],
  );
}

type Rule = (ctx: TrackContext, p: Prepared) => Rejection | null;

/** One entry per RULE_ORDER family, in that order (a test holds them equal). */
export const RULES: readonly (readonly [RuleFamily, Rule])[] = Object.freeze([
  ["structural", structural],
  ["geometry", geometry],
  ["grade", passes], // D4: grade-too-steep
  ["terrain-structure", passes], // D4: needs-bridge, needs-tunnel, bridge and tunnel rules
  ["node-topology", nodeTopology],
  ["clearance", clearance],
  ["entities", passes], // D6/D7: signals, platforms, depots
  ["operational", passes], // D10: track-in-use
]);

/** Validates a proposal against the committed track; never mutates `ctx`. */
export function validate(ctx: TrackContext, proposal: Proposal): Validation {
  const prepared = prepare(ctx, proposal);
  for (const [, rule] of RULES) {
    const failure = rule(ctx, prepared);
    if (failure) return failure;
  }
  const added: PieceRecord[] = prepared.added.map(recordOf);
  const removed: PieceRecord[] = prepared.removed.map(recordOf);
  return {
    ok: true,
    diff: makeDiff(added, removed),
    counts: { new: prepared.added.length, reused: prepared.reused },
  };
}
