import { type Command, type Result, formatKey } from "../core/sim/api";

/**
 * The preview memo (architecture "Tools"): `sim.preview` runs only for a
 * command it has not seen at the current network revision. Entries are keyed
 * by network revision + canonical command key, so a commit (a new revision)
 * never serves a stale verdict, and the last 16 keys stay warm, so dragging
 * back over the same nodes costs nothing.
 *
 * Pure bookkeeping: timing the misses (preview p95) is the app's job, which
 * wraps the `preview` it passes in.
 */

export const PREVIEW_MEMO_CAPACITY = 16;

/**
 * A command's canonical key: its type, then its contents in order. Pieces are
 * written with `formatKey` exactly as the planner resolved them, so the same
 * plan always gives the same key and any different plan a different one.
 */
export function commandKey(cmd: Command): string {
  switch (cmd.type) {
    case "build-track":
      return `build:${cmd.structure}:${cmd.pieces.map(formatKey).join(";")}`;
    case "demolish":
      return `demolish:${cmd.pieces.join(";")}`;
    case "undo":
    case "redo":
      return cmd.type;
  }
}

export interface PreviewMemoStats {
  readonly hits: number;
  readonly misses: number;
  readonly size: number;
}

export interface PreviewMemo {
  /** The verdict for `cmd` at the current revision, from the cache or one `preview` call. */
  preview(cmd: Command): Result;
  stats(): PreviewMemoStats;
  clear(): void;
}

export function createPreviewMemo(
  preview: (cmd: Command) => Result,
  revision: () => number,
  capacity: number = PREVIEW_MEMO_CAPACITY,
): PreviewMemo {
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
  // A Map iterates in insertion order: re-inserting on a hit makes the first key the least recent.
  const entries = new Map<string, Result>();
  let hits = 0;
  let misses = 0;
  return {
    preview(cmd) {
      const key = `${revision()}|${commandKey(cmd)}`;
      const cached = entries.get(key);
      if (cached !== undefined) {
        hits += 1;
        entries.delete(key);
        entries.set(key, cached);
        return cached;
      }
      misses += 1;
      const result = preview(cmd);
      entries.set(key, result);
      if (entries.size > capacity) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
      return result;
    },
    stats: () => ({ hits, misses, size: entries.size }),
    clear() {
      entries.clear();
    },
  };
}
