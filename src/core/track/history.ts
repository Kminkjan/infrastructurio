import { type Diff, invertDiff, isEmptyDiff } from "./authored";
import type { Accepted, Rejection, Validation } from "./validate";

/**
 * Undo/redo over construction diffs (simulation model §14), depth 100.
 *
 * History holds construction diffs only; trains, time, the operator and ID
 * allocators never enter it, so undo cannot revive a stale ID. Each undo or
 * redo is validated like any edit, and a failure is reported as
 * `undo-blocked` wrapping the inner reason.
 *
 * In D2 every change to the track goes through history, so undoing and
 * redoing in sequence always restores a state that was valid: `undo-blocked`
 * becomes reachable from commands once trains can hold track (D10,
 * `track-in-use`), or when a loaded history no longer fits its track.
 */

export const HISTORY_DEPTH = 100;

export interface History {
  /** Oldest first; the last entry is undone next. */
  readonly undo: readonly Diff[];
  /** Oldest first; the last entry is redone next. */
  readonly redo: readonly Diff[];
}

const NO_DIFFS: readonly Diff[] = Object.freeze([]);
export const EMPTY_HISTORY: History = Object.freeze({ undo: NO_DIFFS, redo: NO_DIFFS });

function pushCapped(stack: readonly Diff[], diff: Diff): readonly Diff[] {
  const kept = stack.length >= HISTORY_DEPTH ? stack.slice(stack.length - HISTORY_DEPTH + 1) : stack.slice();
  kept.push(diff);
  return Object.freeze(kept);
}

/**
 * Records a new edit: pushes it (dropping the oldest beyond the depth) and
 * clears redo. An empty diff (an all-reused build) records nothing.
 */
export function recordEdit(history: History, diff: Diff): History {
  if (isEmptyDiff(diff)) return history;
  return Object.freeze({ undo: pushCapped(history.undo, diff), redo: NO_DIFFS });
}

export type HistoryStep =
  | { readonly ok: true; readonly accepted: Accepted; readonly next: History }
  | Rejection;

/**
 * Plans one undo or redo: picks the diff (the inverse of the last edit for
 * undo), validates it with `validateDiff`, and returns the history that
 * follows if it is committed. Pure; the caller commits.
 */
export function stepHistory(
  history: History,
  direction: "undo" | "redo",
  validateDiff: (diff: Diff) => Validation,
): HistoryStep {
  const stack = direction === "undo" ? history.undo : history.redo;
  const top = stack[stack.length - 1];
  if (top === undefined) {
    return direction === "undo"
      ? { ok: false, reason: { code: "undo-empty", message: "Nothing to undo; build or demolish track first.", refs: [] }, highlight: [] }
      : {
          ok: false,
          reason: { code: "redo-empty", message: "Nothing to redo; redo works only after an undo, until the next edit.", refs: [] },
          highlight: [],
        };
  }

  const verdict = validateDiff(direction === "undo" ? invertDiff(top) : top);
  if (!verdict.ok) {
    const inner = verdict.reason;
    return {
      ok: false,
      reason: {
        code: "undo-blocked",
        message: `Can't ${direction} the last edit: ${inner.message} Clear that conflict first; then ${direction} again.`,
        refs: inner.refs,
        cause: inner,
      },
      highlight: verdict.highlight,
    };
  }

  // Store what was actually applied, so the stacks stay exact inverses.
  const rest = Object.freeze(stack.slice(0, -1));
  const next: History =
    direction === "undo"
      ? { undo: rest, redo: pushCapped(history.redo, invertDiff(verdict.diff)) }
      : { undo: pushCapped(history.undo, verdict.diff), redo: rest };
  return { ok: true, accepted: verdict, next: Object.freeze(next) };
}
