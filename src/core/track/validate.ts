import { type ClearanceIndex, MIN_HEIGHT_SEPARATION_MM, createClearanceIndex } from "../geometry/clearance";
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
import type { GroundQuery } from "./ground";
import {
  ABUTMENT_DIP_MM,
  ABUTMENT_ZONE_MM,
  GROUND_BAND_MM,
  PORTAL_ZONE_MM,
  type PieceGround,
  STRUCTURE_CODES,
  type StructureFault,
  TUNNEL_COVER_MM,
  TUNNEL_MIN_PEAK_COVER_MM,
  WATER_CLEARANCE_MM,
  type Clearances,
  clearances,
  isAbutment,
  isPortal,
  pieceGround,
  structureFault,
  structureFor,
} from "./structure";

/**
 * The single construction validator (simulation model §9). `preview` and
 * `execute` both call `validate`; it never mutates.
 *
 * Rules run in the fixed order of RULE_ORDER and the first failure returns
 * exactly one reason plus highlight keys. Inside a family, codes are tried in
 * catalogue order and, for each code, pieces in command order. Entities
 * (D6/D7) and the operational track-in-use check (D10) are ordered
 * placeholders that pass today, so later items slot in without reordering any
 * outcome. Grade (rule 3) and terrain/structure (rule 4) arrived in D4.
 *
 * The grade, terrain and structure rules judge the pieces a command adds; a
 * reused piece keeps its structure and was judged when it was built. Rule 4
 * judges against the effective ground (`ground.ts`, D4 feel-check fixes
 * 2026-09-28): the terrain as the committed track's earthworks shape it. Under
 * structure `auto` each added piece gets the structure inferred from the
 * terrain under it (`structure.ts`), and a run inferred as tunnel that never
 * reaches 10 m of cover becomes a cutting (owner decision 2026-09-28, "Needs
 * 10 m somewhere"), before rule 4 checks it; a forced structure applies to every
 * added piece (no tool forces one since the Straight line tool replaced the
 * Bridge and Tunnel tools).
 *
 * Messages read "<what is wrong>; <how to fix it>." and carry numbers.
 */

/**
 * Reason codes implemented so far: D2's eleven, then D4's seven (appended).
 * Later slices append; shipped codes are never renamed.
 */
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
  "grade-too-steep",
  "needs-bridge",
  "needs-tunnel",
  "bridge-below-ground",
  "bridge-too-low-over-water",
  "tunnel-too-shallow",
  "vertical-clearance",
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
/** The steepest grade a piece may have, ‰ (rule 3): |Δz| · 1000 ≤ 35 · lengthMm, compared exactly. */
export const MAX_GRADE_PERMILLE = 35;

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
  | { readonly kind: "build"; readonly specs: readonly PieceSpec[]; readonly structure: StructureChoice }
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
  /**
   * The effective ground (`ground.ts`: the terrain as the committed track's earthworks shape it), which rule 4 and
   * the planner judge against since the D4 feel-check fixes (2026-09-28). The world always passes it; a bare context
   * (unit tests) judges against the natural terrain.
   */
  readonly ground?: GroundQuery;
}

/**
 * Checks a command's structure choice (a programmer contract, like the rest of
 * the command's shape): ground, bridge, tunnel or auto. `auto` is resolved
 * per added piece by inference from the terrain (D4, `structure.ts`).
 */
export function structureChoice(choice: StructureChoice): StructureChoice {
  if (choice === "ground" || choice === "bridge" || choice === "tunnel" || choice === "auto") return choice;
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
  /**
   * Unique pieces this proposal adds, in command order. Under `auto`, rule 4
   * replaces each with the same piece carrying its inferred structure.
   */
  readonly added: Piece[];
  /** Build only: the command's structure choice; null when the pieces carry their own (history diffs). */
  readonly choice: StructureChoice | null;
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
    // Under auto the pieces resolve as ground until rule 4 infers their structures.
    const provisional: Structure = proposal.structure === "auto" ? "ground" : proposal.structure;
    proposal.specs.forEach((spec, index) => {
      const from: unknown = typeof spec === "object" && spec !== null ? spec.from : undefined;
      const res = resolvePiece(spec, provisional);
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
    return { specs, added, choice: proposal.structure, removed: [], unknown: [], reused, limitCount };
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
    return { specs: [], added: [], choice: null, removed, unknown, reused: 0, limitCount: 0 };
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
  return { specs: [], added, choice: null, removed, unknown, reused: 0, limitCount: added.length };
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

const NO_INDICES: ReadonlySet<number> = new Set();

/** Metres to 0.1 m, rounded half up, trailing zero trimmed ("6.5", "12"). */
function metres(mm: number): string {
  const tenths = Math.round(mm / 100);
  return tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1);
}

/** Metres to 0.1 m rounded up, so a suggested change always suffices. */
function metresUp(mm: number): string {
  const tenths = Math.ceil(mm / 100 - 1e-9);
  return tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1);
}

/** How a message names an added piece: "piece 3" by its first spec in the command, else by key. */
function pieceLabel(p: Prepared, key: PieceKey): { readonly noun: string; readonly refs: readonly Ref[] } {
  const index = p.specs.findIndex((s) => s.piece?.key === key);
  const pieceRef: Ref = { kind: "piece", key };
  return index < 0 ? { noun: `piece ${key}`, refs: [pieceRef] } : { noun: `piece ${index + 1}`, refs: [{ kind: "spec", index }, pieceRef] };
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Whether a piece is steeper than 35‰, as the exact rational: |num| > 35 · den. */
function tooSteep(piece: Piece): boolean {
  return Math.abs(piece.gradePermille.num) > MAX_GRADE_PERMILLE * piece.gradePermille.den;
}

/** The node a spec's piece ends on when travelled from the spec's `from`. */
function travelEnd(piece: Piece, from: NodeRef): NodeRef {
  const [a, b] = piece.ends;
  return a.node.q === from.q && a.node.r === from.r && a.node.zMm === from.zMm ? b.node : a.node;
}

/**
 * Rule 3: every added piece at most 35‰ (|Δz| · 1000 ≤ 35 · lengthMm, exact).
 * The message quotes the climb that is too steep and the length it needs at
 * 35‰. That climb is the run of the command's chained pieces around the first
 * steep one that rise (or fall) with it, when the run as a whole is steeper
 * than 35‰ (a drag whose end is too high for its length); otherwise the steep
 * piece alone (a local step, for example to an existing node's height).
 */
function grade(_ctx: TrackContext, p: Prepared): Rejection | null {
  const offender = p.added.find(tooSteep);
  if (!offender) return null;
  const label = pieceLabel(p, offender.key);
  const j = p.specs.findIndex((s) => s.piece?.key === offender.key);
  const riseOf = (k: number): number => {
    const s = p.specs[k];
    return s?.piece && isNodeRef(s.from) ? travelEnd(s.piece, s.from).zMm - s.from.zMm : 0;
  };
  const joins = (k: number): boolean => {
    const a = p.specs[k];
    const b = p.specs[k + 1];
    if (!a?.piece || !b?.piece || !isNodeRef(a.from) || !isNodeRef(b.from)) return false;
    const end = travelEnd(a.piece, a.from);
    return end.q === b.from.q && end.r === b.from.r && end.zMm === b.from.zMm;
  };
  let rise = offender.ends[1].node.zMm - offender.ends[0].node.zMm;
  let length = offender.lengthMm;
  let many = false;
  if (j >= 0) {
    const sign = Math.sign(riseOf(j));
    let lo = j;
    let hi = j;
    while (lo > 0 && joins(lo - 1) && Math.sign(riseOf(lo - 1)) === sign) lo -= 1;
    while (hi < p.specs.length - 1 && joins(hi) && Math.sign(riseOf(hi + 1)) === sign) hi += 1;
    let runRise = 0;
    let runLength = 0;
    for (let k = lo; k <= hi; k++) {
      runRise += riseOf(k);
      runLength += p.specs[k]?.piece?.lengthMm ?? 0;
    }
    if (Math.abs(runRise) * 1000 > MAX_GRADE_PERMILLE * runLength && hi > lo) {
      rise = runRise;
      length = runLength;
      many = true;
    } else {
      rise = riseOf(j);
    }
  }
  const x = Math.abs(rise);
  const neededMm = divFloor(x * 1000 + MAX_GRADE_PERMILLE - 1, MAX_GRADE_PERMILLE);
  const percent = ((x * 100) / length).toFixed(2);
  const [verb, infinitive] = rise >= 0 ? ["climbs", "climb"] : ["falls", "descend"];
  const who = many ? "The track" : capitalized(label.noun);
  return reject(
    "grade-too-steep",
    `${who} ${verb} ${metres(x)} m over ${metres(length)} m (${percent} %), steeper than the 3.5 % maximum; it needs ${metresUp(neededMm)} m to ${infinitive} ${metres(x)} m, so lengthen the drag or change the end height.`,
    label.refs,
    [offender.key],
  );
}

function structureMessage(fault: StructureFault, noun: string): string {
  const who = capitalized(noun);
  switch (fault.code) {
    case "needs-bridge":
      return fault.overWater
        ? `${who} crosses water on the ground; use a bridge or keep the track off the water.`
        : `${who} runs ${metres(fault.aboveMm)} m above the terrain, more than the ${metres(GROUND_BAND_MM)} m an embankment takes; use a bridge or lower the track.`;
    case "needs-tunnel":
      return fault.underWater
        ? `${who} runs under water, below the bed; use a tunnel or raise the track over the water on a bridge.`
        : `${who} runs ${metres(fault.belowMm)} m below the terrain, deeper than the ${metres(GROUND_BAND_MM)} m a cutting takes; use a tunnel or raise the track.`;
    case "bridge-below-ground":
      return Number.isFinite(fault.abutmentMm)
        ? `Bridge ${noun} dips ${metres(fault.belowMm)} m below the terrain ${fault.abutmentMm === 0 ? "at an abutment" : `${metres(fault.abutmentMm)} m from an abutment`}, more than the ${metres(ABUTMENT_DIP_MM)} m a deck may sit in the bank; raise the deck or build on the ground.`
        : `Bridge ${noun} dips ${metres(fault.belowMm)} m below the terrain with no abutment within ${metres(ABUTMENT_ZONE_MM)} m (only there may a deck sit up to ${metres(ABUTMENT_DIP_MM)} m in the bank); raise the deck or build on the ground.`;
    case "bridge-too-low-over-water":
      return `Bridge ${noun} runs ${metresUp(fault.missingMm)} m too low over the water, which needs the deck ${metres(WATER_CLEARANCE_MM)} m above it; raise the deck by ${metresUp(fault.missingMm)} m.`;
    case "tunnel-too-shallow":
      if (fault.shallowOnly) {
        return `Tunnel ${noun} lies at most ${metres(Math.max(0, fault.coverMm))} m below the terrain, no deeper than a cutting; go deeper or build a cutting.`;
      }
      return `Tunnel ${noun} has ${metres(Math.max(0, fault.coverMm))} m of cover ${
        Number.isFinite(fault.portalMm) ? `${metres(fault.portalMm)} m from the nearest portal` : `with no portal within ${metres(PORTAL_ZONE_MM)} m`
      }, but needs ${metres(TUNNEL_COVER_MM)} m beyond ${metres(PORTAL_ZONE_MM)} m of a portal; go deeper or build a cutting.`;
  }
}

/**
 * Under `auto`, after the per-piece inference: the runs of added pieces inferred as tunnel that never reach 10 m of
 * cover become ground, cuttings up to 10 m deep (owner decision 2026-09-28, "Needs 10 m somewhere"; `structure.ts`).
 * A run is a maximal set of added tunnel pieces joined node to node, so the outcome does not depend on the command's
 * order. It stays a tunnel when it joins a committed tunnel (the extension of a tunnel is a tunnel), runs under water
 * anywhere, or has a piece more than 8 m above the terrain (which the ground rule would reject). Replaces the pieces
 * in `p.added` and returns the indices made ground, whose ground rule then takes cuttings to 10 m.
 */
function shallowTunnelRuns(ctx: TrackContext, p: Prepared, extents: readonly (Clearances | undefined)[]): ReadonlySet<number> {
  const made = new Set<number>();
  const byNode = new Map<string, number[]>();
  p.added.forEach((piece, i) => {
    if (piece.structure !== "tunnel") return;
    for (const end of piece.ends) {
      const k = nodeKey(end.node);
      const list = byNode.get(k);
      if (list) list.push(i);
      else byNode.set(k, [i]);
    }
  });
  if (byNode.size === 0) return made;
  const removed = new Set(p.removed.map((r) => r.key));
  const seen = new Set<number>();
  for (let start = 0; start < p.added.length; start++) {
    if (p.added[start]?.structure !== "tunnel" || seen.has(start)) continue;
    const run: number[] = [];
    const nodes = new Set<string>();
    const stack = [start];
    seen.add(start);
    for (let i = stack.pop(); i !== undefined; i = stack.pop()) {
      run.push(i);
      for (const end of p.added[i]?.ends ?? []) {
        const k = nodeKey(end.node);
        nodes.add(k);
        for (const j of byNode.get(k) ?? []) {
          if (seen.has(j)) continue;
          seen.add(j);
          stack.push(j);
        }
      }
    }
    let keep = false;
    let peakMm = Number.NEGATIVE_INFINITY;
    for (const i of run) {
      const c = extents[i];
      if (!c) {
        keep = true;
        break;
      }
      if (c.underWater || c.overWater || c.aboveMm > GROUND_BAND_MM) {
        keep = true;
        break;
      }
      if (c.belowMm > peakMm) peakMm = c.belowMm;
    }
    if (keep || peakMm >= TUNNEL_MIN_PEAK_COVER_MM) continue;
    const joinsTunnel = [...nodes].some((k) =>
      (ctx.index.nodes.get(k) ?? []).some((e) => !removed.has(e.key) && ctx.authored.pieces.get(e.key)?.structure === "tunnel"),
    );
    if (joinsTunnel) continue;
    for (const i of run) {
      const piece = p.added[i];
      if (!piece) continue;
      p.added[i] = Object.freeze({ ...piece, structure: "ground" });
      made.add(i);
    }
  }
  return made;
}

/**
 * Rule 4: under `auto`, first give every added piece its inferred structure,
 * and make the tunnel runs that never reach 10 m of cover ground
 * (`shallowTunnelRuns`); then check each added piece against its structure's
 * rules (`structure.ts`): codes in catalogue order, pieces in command order.
 * A history apply keeps the pieces' structures and allows ground pieces 10 m.
 */
function terrainStructure(ctx: TrackContext, p: Prepared): Rejection | null {
  if (p.added.length === 0) return null;
  const { terrain } = ctx;
  const ground = ctx.ground ?? null;
  // The committed nodes this command joins: the earthworks of the pieces ending there count as clipped (`ground.ts`).
  let clip: Set<string> | null = null;
  if (ground) {
    for (const piece of p.added) {
      for (const end of piece.ends) {
        const k = nodeKey(end.node);
        if (!ctx.index.nodes.has(k)) continue;
        clip ??= new Set();
        clip.add(k);
      }
    }
  }
  const grounds: PieceGround[] = p.added.map((piece) => pieceGround(terrain, piece, ground, clip));
  const choice = p.choice;
  // Under auto, each added piece's clearances, which inference and the 10 m rule both read.
  const extents: (Clearances | undefined)[] = [];
  if (choice !== null) {
    p.added.forEach((piece, i) => {
      const g = grounds[i];
      let structure: Structure = piece.structure;
      if (choice !== "auto") structure = choice;
      else if (g) {
        const c = clearances(g, piece.ends[0].node.zMm, piece.ends[1].node.zMm);
        extents[i] = c;
        structure = structureFor(c);
      }
      if (structure !== piece.structure) p.added[i] = Object.freeze({ ...piece, structure });
    });
  }
  const deepCuts = choice === "auto" ? shallowTunnelRuns(ctx, p, extents) : NO_INDICES;
  // A history apply (undo, redo; `choice` null) re-adds pieces a command committed, with their structures. A ground
  // piece deeper than the band came from a shallow tunnel run under `auto`, which the build allowed 10 m, so the
  // apply allows every ground piece 10 m too. It cannot re-derive the runs: the pieces around them may have changed
  // since (a tunnel built on from a cutting's end would have kept the run a tunnel), and a state restored by undo or
  // redo was valid. The other ground rules (water, 8 m above) are the runs' own exclusions and still apply.
  const cutBandOf = (i: number, structure: Structure): number =>
    deepCuts.has(i) || (choice === null && structure === "ground") ? TUNNEL_MIN_PEAK_COVER_MM : GROUND_BAND_MM;
  const removed = new Set(p.removed.map((r) => r.key));
  // The added pieces by node, built only when a portal or abutment walk first needs them.
  let addedAt: Map<string, Piece[]> | null = null;
  const addedAtNode = (k: string): readonly Piece[] => {
    if (!addedAt) {
      addedAt = new Map();
      for (const piece of p.added) {
        for (const end of piece.ends) {
          const nk = nodeKey(end.node);
          const list = addedAt.get(nk);
          if (list) list.push(piece);
          else addedAt.set(nk, [piece]);
        }
      }
    }
    return addedAt.get(k) ?? [];
  };
  /** The pieces at a node after this edit, other than `except`. */
  const others = (node: NodeRef, except: PieceKey): Piece[] => {
    const k = nodeKey(node);
    const out: Piece[] = [];
    for (const e of ctx.index.nodes.get(k) ?? []) {
      if (e.key === except || removed.has(e.key)) continue;
      const piece = ctx.authored.pieces.get(e.key);
      if (piece) out.push(piece);
    }
    for (const piece of addedAtNode(k)) if (piece.key !== except) out.push(piece);
    return out;
  };
  /**
   * Distance along the track from `node` (leaving `from`) to the nearest support of `from`'s structure, through
   * pieces of that structure: a portal for a tunnel (the 10 m zone), an abutment for a bridge (the 15 m zone).
   */
  const reachFrom = (node: NodeRef, from: Piece, acc: number): number => {
    const bridge = from.structure === "bridge";
    if (acc > (bridge ? ABUTMENT_ZONE_MM : PORTAL_ZONE_MM)) return Number.POSITIVE_INFINITY;
    if (bridge ? isAbutment(terrain, node, ground, clip) : isPortal(terrain, node, ground, clip)) return acc;
    const next = others(node, from.key);
    const only = next.length === 1 ? next[0] : undefined;
    if (!only || only.structure !== from.structure) return Number.POSITIVE_INFINITY;
    const [a, b] = only.ends;
    const far = a.node.q === node.q && a.node.r === node.r && a.node.zMm === node.zMm ? b.node : a.node;
    return reachFrom(far, only, acc + only.lengthMm);
  };
  const waterMm = terrain.waterLevelDm * 100;
  const faults = p.added.map((piece, i) => {
    const g = grounds[i];
    if (!g) return null;
    return structureFault(
      g,
      piece.ends[0].node.zMm,
      piece.ends[1].node.zMm,
      piece.lengthMm,
      piece.structure,
      waterMm,
      (end) => reachFrom(piece.ends[end].node, piece, 0),
      cutBandOf(i, piece.structure),
    );
  });
  for (const code of STRUCTURE_CODES) {
    const i = faults.findIndex((f) => f?.code === code);
    const fault = faults[i];
    const piece = p.added[i];
    if (i < 0 || !fault || !piece) continue;
    const label = pieceLabel(p, piece.key);
    return reject(code, structureMessage(fault, label.noun), label.refs, [piece.key]);
  }
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

/**
 * Rule 6. Two centrelines closer than 4.0 m in plan while less than 6.5 m
 * apart in height clash: `vertical-clearance` where they cross in plan (a
 * grade-separated crossing or stacked track without the height), else
 * `tracks-too-close`. The pair is the first new piece's closest partner
 * (`findConflict`); the missing height is 6.5 m less the smallest height gap
 * the check measured between them, so raising or lowering one track by it
 * clears that pair.
 */
function clearance(ctx: TrackContext, p: Prepared): Rejection | null {
  if (p.added.length === 0) return null;
  const hit = ctx.index.clearance.findConflict(p.added, new Set(p.removed.map((r) => r.key)));
  if (!hit) return null;
  const refs: Ref[] = [
    { kind: "piece", key: hit.piece },
    { kind: "piece", key: hit.other },
  ];
  if (hit.crossing) {
    const missing = MIN_HEIGHT_SEPARATION_MM - hit.heightGapMm;
    return reject(
      "vertical-clearance",
      `Tracks ${hit.piece} and ${hit.other} cross with ${metres(Math.max(0, hit.heightGapMm))} m of height between them, but need ${metres(MIN_HEIGHT_SEPARATION_MM)} m; raise or lower one by ${metresUp(missing)} m.`,
      refs,
      [hit.piece, hit.other],
    );
  }
  return reject(
    "tracks-too-close",
    `Tracks ${hit.piece} and ${hit.other} come ${hit.distanceM.toFixed(2)} m apart, but need 4.0 m (or 6.5 m of height difference); move the tracks apart.`,
    refs,
    [hit.piece, hit.other],
  );
}

type Rule = (ctx: TrackContext, p: Prepared) => Rejection | null;

/** One entry per RULE_ORDER family, in that order (a test holds them equal). */
export const RULES: readonly (readonly [RuleFamily, Rule])[] = Object.freeze([
  ["structural", structural],
  ["geometry", geometry],
  ["grade", grade],
  ["terrain-structure", terrainStructure],
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
