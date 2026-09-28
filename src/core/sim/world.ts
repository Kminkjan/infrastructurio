import type { PieceKey, PieceSpec } from "../geometry/piece";
import { type Network, derive } from "../network/derive";
import type { Terrain } from "../terrain";
import {
  type AuthoredState,
  type Diff,
  type PieceRecord,
  applyDiff,
  authoredFromRecords,
  emptyAuthored,
  isEmptyDiff,
} from "../track/authored";
import { EffectiveGround, type GroundView } from "../track/ground";
import { EMPTY_HISTORY, type History, recordEdit, stepHistory } from "../track/history";
import { type Drag, type TrackPlan, planTrack } from "../track/planner";
import {
  type Accepted,
  type Counts,
  type Reason,
  type Rejection,
  type StructureChoice,
  type TrackContext,
  type TrackIndex,
  createTrackIndex,
  indexAdd,
  indexRemove,
  structureChoice,
  validate,
} from "../track/validate";
import { deepFreeze } from "../util/freeze";

/**
 * The stateful world behind the `Sim` façade: authored track, its indexes,
 * history and the cached network view.
 *
 * `preview` and `execute` are the same `run`, differing only in `commit`:
 * validation and the result are computed identically, and only a commit
 * touches state. Preview therefore never mutates and consumes no IDs (the
 * revision it reports is the one a commit would produce).
 */

/**
 * Commands carry resolved pieces, never drag input, so planner tuning never
 * breaks a replay.
 *
 * A command's shape (its `type`, a build's `structure`, the `pieces` arrays)
 * is a programmer contract: tools assemble it from typed values, so a bad
 * shape is a bug and `run` throws a TypeError before anything is evaluated.
 * Only the contents are player-reachable (the specs a drag resolved to, the
 * keys a pick named: off the map, malformed or stale), and those are always
 * rejected with a reason, never thrown.
 *
 * A build's `structure` applies to the pieces it adds (a reused piece keeps
 * its own): `auto` infers each one's from the terrain under it (D4, rule 4 in
 * `track/validate.ts`), and ground, bridge or tunnel forces it (the Bridge and
 * Tunnel tools). The inferred structures are in the result's `diff.added`.
 */
export type Command =
  | { readonly type: "build-track"; readonly pieces: readonly PieceSpec[]; readonly structure: StructureChoice }
  | { readonly type: "demolish"; readonly pieces: readonly PieceKey[] }
  | { readonly type: "undo" }
  | { readonly type: "redo" };

export type Result =
  | { readonly ok: true; readonly networkRev: number; readonly diff: Diff; readonly counts: Counts }
  | { readonly ok: false; readonly reason: Reason; readonly highlight: readonly PieceKey[] };

/** The derived network at one revision; the same frozen object until the revision changes. */
export interface NetworkView extends Network {
  readonly rev: number;
}

/**
 * Starting state for a world, as a load would supply it (D12 builds
 * `loadSim` on this). Loads never re-validate: the records and history are
 * taken as they are.
 */
export interface WorldInit {
  readonly records: readonly PieceRecord[];
  readonly history?: History;
  readonly rev?: number;
}

export interface World {
  readonly terrain: Terrain;
  run(cmd: Command, commit: boolean): Result;
  /** Reads the authored state, never changes it. */
  plan(drag: Drag): TrackPlan;
  network(): NetworkView;
  /** The revision's earthworks (`track/ground.ts`): the same object until an edit changes the track. */
  ground(): GroundView;
  /** The effective ground at a lattice node in integer mm (the water surface over a lower bed); undefined off the map. */
  groundMm(q: number, r: number): number | undefined;
}

export function createWorld(terrain: Terrain, init?: WorldInit): World {
  let authored: AuthoredState = init ? authoredFromRecords(init.records, init.rev ?? 0) : emptyAuthored();
  let history: History = init?.history ?? EMPTY_HISTORY;
  const index: TrackIndex = createTrackIndex(authored.pieces.values());
  // The effective ground (D4 feel-check fixes, 2026-09-28): the committed track's earthworks, which the planner,
  // validation and the renderer read, kept in step with each commit.
  const ground = new EffectiveGround(terrain, authored.pieces.values(), { nodes: index.nodes, pieces: authored.pieces });
  let view: NetworkView | undefined;

  function commitDiff(diff: Diff): void {
    const before = authored;
    authored = applyDiff(authored, diff);
    for (const r of diff.removed) {
      const piece = before.pieces.get(r.key);
      if (piece) indexRemove(index, piece);
    }
    const added = [];
    const removed = [];
    for (const r of diff.removed) {
      const piece = before.pieces.get(r.key);
      if (piece) removed.push(piece);
    }
    for (const r of diff.added) {
      const piece = authored.pieces.get(r.key);
      if (piece) {
        indexAdd(index, piece);
        added.push(piece);
      }
    }
    ground.apply(removed, added, { nodes: index.nodes, pieces: authored.pieces });
  }

  function run(cmd: Command, commit: boolean): Result {
    assertCommandShape(cmd);
    const ctx: TrackContext = { terrain, authored, index, ground };
    let accepted: Accepted;
    let next: History;
    switch (cmd.type) {
      case "build-track":
      case "demolish": {
        const verdict =
          cmd.type === "build-track"
            ? validate(ctx, { kind: "build", specs: cmd.pieces, structure: structureChoice(cmd.structure) })
            : validate(ctx, { kind: "demolish", keys: cmd.pieces });
        if (!verdict.ok) return rejected(verdict);
        accepted = verdict;
        next = recordEdit(history, verdict.diff);
        break;
      }
      case "undo":
      case "redo": {
        const step = stepHistory(history, cmd.type, (diff) => validate(ctx, { kind: "apply", diff }));
        if (!step.ok) return rejected(step);
        accepted = step.accepted;
        next = step.next;
        break;
      }
      default:
        throw new TypeError(`unknown command type ${String((cmd as { type?: unknown }).type)}`);
    }

    const changed = !isEmptyDiff(accepted.diff);
    const result: Result = deepFreeze({
      ok: true,
      networkRev: changed ? authored.rev + 1 : authored.rev,
      diff: accepted.diff,
      counts: accepted.counts,
    });
    if (commit) {
      if (changed) commitDiff(accepted.diff);
      history = next;
    }
    return result;
  }

  function network(): NetworkView {
    if (!view || view.rev !== authored.rev) view = deepFreeze({ rev: authored.rev, ...derive(authored) });
    return view;
  }

  return Object.freeze({
    terrain,
    run,
    plan: (drag: Drag) => planTrack({ terrain, authored, index, ground }, drag),
    network,
    ground: () => ground.view(authored.rev),
    groundMm: (q: number, r: number) => ground.nodeMm(q, r),
  });
}

/** Throws a TypeError naming the fault when a command breaks the shape contract (see `Command`). */
function assertCommandShape(cmd: Command): void {
  if (typeof cmd !== "object" || cmd === null) throw new TypeError(`a command must be an object, not ${String(cmd)}`);
  switch (cmd.type) {
    case "build-track":
      if (!Array.isArray(cmd.pieces)) throw new TypeError(`build-track needs a pieces array, not ${String(cmd.pieces)}`);
      structureChoice(cmd.structure);
      return;
    case "demolish":
      if (!Array.isArray(cmd.pieces)) throw new TypeError(`demolish needs a pieces array of keys, not ${String(cmd.pieces)}`);
      return;
    case "undo":
    case "redo":
      return;
    default:
      throw new TypeError(`unknown command type ${String((cmd as { type?: unknown }).type)}`);
  }
}

function rejected(r: Rejection): Result {
  return deepFreeze({ ok: false, reason: r.reason, highlight: r.highlight });
}
