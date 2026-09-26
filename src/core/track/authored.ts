import { type Piece, type PieceKey, type Structure, pieceFromKey } from "../geometry/piece";

/**
 * Authored track: the only stored truth about the network (simulation model
 * §10). Everything else — nodes, sections, the view — is derived from it.
 *
 * Pieces are held by canonical key. The Map's insertion order depends on edit
 * order, so nothing may read it in that order: consumers sort by key.
 * Signals, platforms and depots join this state in D6/D7.
 */

/** A piece as history and saves record it: geometry by key, plus its structure. */
export interface PieceRecord {
  readonly key: PieceKey;
  readonly structure: Structure;
}

/** One construction edit. Both lists are sorted by key. */
export interface Diff {
  readonly added: readonly PieceRecord[];
  readonly removed: readonly PieceRecord[];
}

export interface AuthoredState {
  /** The network revision: bumped by every edit that changes the pieces, never rolled back. */
  readonly rev: number;
  readonly pieces: ReadonlyMap<PieceKey, Piece>;
}

const NO_RECORDS: readonly PieceRecord[] = Object.freeze([]);
export const EMPTY_DIFF: Diff = Object.freeze({ added: NO_RECORDS, removed: NO_RECORDS });

export function emptyAuthored(): AuthoredState {
  return Object.freeze({ rev: 0, pieces: new Map<PieceKey, Piece>() });
}

export function recordOf(piece: Piece): PieceRecord {
  return Object.freeze({ key: piece.key, structure: piece.structure });
}

function sortedRecords(records: readonly PieceRecord[]): readonly PieceRecord[] {
  if (records.length === 0) return NO_RECORDS;
  return Object.freeze(
    [...records].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map((r) => Object.freeze({ key: r.key, structure: r.structure })),
  );
}

/** A frozen diff with both lists sorted by key. */
export function makeDiff(added: readonly PieceRecord[], removed: readonly PieceRecord[]): Diff {
  if (added.length === 0 && removed.length === 0) return EMPTY_DIFF;
  return Object.freeze({ added: sortedRecords(added), removed: sortedRecords(removed) });
}

export function isEmptyDiff(diff: Diff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0;
}

export function invertDiff(diff: Diff): Diff {
  return isEmptyDiff(diff) ? EMPTY_DIFF : Object.freeze({ added: diff.removed, removed: diff.added });
}

function resolveRecord(record: PieceRecord): Piece {
  const piece = pieceFromKey(record.key, record.structure);
  if (!piece || piece.key !== record.key) throw new Error(`record ${record.key} is not a canonical piece key`);
  return piece;
}

/**
 * Applies a validated diff. Pure: returns a new state (rev + 1) and leaves
 * `state` untouched; an empty diff returns `state` itself. Throws when the
 * diff does not fit the state, which only a bypassed validator can cause.
 */
export function applyDiff(state: AuthoredState, diff: Diff): AuthoredState {
  if (isEmptyDiff(diff)) return state;
  const pieces = new Map(state.pieces);
  for (const r of diff.removed) {
    if (!pieces.delete(r.key)) throw new Error(`applyDiff: ${r.key} is not present`);
  }
  for (const r of diff.added) {
    if (pieces.has(r.key)) throw new Error(`applyDiff: ${r.key} is already present`);
    pieces.set(r.key, resolveRecord(r));
  }
  return Object.freeze({ rev: state.rev + 1, pieces });
}

/** Every piece as a record, sorted by key: the canonical form for hashing and saves. */
export function authoredRecords(state: AuthoredState): readonly PieceRecord[] {
  return sortedRecords([...state.pieces.values()].map(recordOf));
}

/**
 * Rebuilds a state from records, as a load does. Never re-validates (saves
 * never do); throws only on keys that are malformed, non-canonical or repeated.
 */
export function authoredFromRecords(records: readonly PieceRecord[], rev = 0): AuthoredState {
  if (!Number.isSafeInteger(rev) || rev < 0) throw new RangeError(`rev must be a safe integer >= 0, got ${rev}`);
  const pieces = new Map<PieceKey, Piece>();
  for (const r of sortedRecords(records)) {
    if (pieces.has(r.key)) throw new Error(`records repeat ${r.key}`);
    pieces.set(r.key, resolveRecord(r));
  }
  return Object.freeze({ rev, pieces });
}
