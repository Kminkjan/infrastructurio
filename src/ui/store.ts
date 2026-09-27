/**
 * The HUD store (architecture "UI (HUD)"): immutable snapshots that React
 * reads through `useSyncExternalStore`. `src/app` is the only writer; it
 * publishes on change, never per frame, and `getSnapshot` returns the same
 * object until a value actually changes (React requires this).
 *
 * The shapes mirror the track tool's tooltip without importing it: the ui
 * layer depends on react and its own store only.
 */

export type HudTool = "select" | "track";

export type HudGradeLevel = "green" | "amber" | "red";

export interface HudTooltip {
  readonly counts: string;
  readonly metrics: {
    readonly length: string;
    readonly grade: string;
    readonly gradeLevel: HudGradeLevel;
    readonly minRadius: string;
    readonly endHeight: string;
  } | null;
  readonly note: string | null;
  readonly invalid: { readonly reason: string; readonly fix: string | null } | null;
  readonly precision: string | null;
  readonly hint: string;
}

export interface HudToast {
  /** Increments per toast, so the same text twice still restarts it. */
  readonly id: number;
  readonly text: string;
  readonly tone: "info" | "warn";
}

export interface HudState {
  readonly tool: HudTool;
  readonly tooltip: HudTooltip | null;
  readonly toast: HudToast | null;
  /** The aria-live status line (the tooltip text and tool announcements). */
  readonly status: string;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export interface HudStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): HudState;
  /** Merges `patch`; publishes only when some value changed. */
  set(patch: Partial<HudState>): void;
}

export const INITIAL_HUD_STATE: HudState = Object.freeze({
  tool: "select",
  tooltip: null,
  toast: null,
  status: "",
  canUndo: false,
  canRedo: false,
});

export function createHudStore(initial: HudState = INITIAL_HUD_STATE): HudStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    set(patch) {
      const next: Record<string, unknown> = { ...state };
      let changed = false;
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === next[key]) continue;
        next[key] = value;
        changed = true;
      }
      if (!changed) return;
      state = Object.freeze(next as unknown as HudState);
      for (const listener of listeners) listener();
    },
  };
}

/** What the HUD may ask the app to do; the app turns these into tool state or gateway commands. */
export interface HudActions {
  selectTool(tool: HudTool): void;
  undo(): void;
  redo(): void;
}
