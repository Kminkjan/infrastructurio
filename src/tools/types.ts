import type {
  Command,
  Drag,
  Heading,
  NetworkView,
  NodeRef,
  PieceKey,
  PieceSpec,
  PlanPointMm,
  RadiusClassM,
  Result,
  Structure,
  TrackPlan,
} from "../core/sim/api";

/**
 * The tool contract (architecture "Tools"): a tool is a pure reducer
 * `(state, event, ctx) → [state, effects]`. Events arrive already interpreted
 * by `InputRouter` in `src/app` (picks, modifiers, resolved directions); tools
 * never raycast, read the DOM or execute commands. Effects are plain data the
 * app interprets: execute through the single command gateway, ghost, snap
 * ring, tooltip, highlights, announcements and camera requests.
 *
 * No three, no DOM, no clock and no randomness here (boundary test), so the
 * same inputs always give the same outputs and reducers unit-test in Node.
 */

/** A CSS pixel position in the viewport (origin top-left, y down). */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * What the pointer or the keyboard cursor is on, as sim identities.
 * - `endpoint`: an existing buffer end; a drag from it continues the track.
 * - `track`: existing track, at a through node or mid-piece; a new track
 *   leaving here would form a turnout (D5), so the tool shows the turnout icon.
 * - `node`: a free lattice node at terrain height.
 */
export type PickKind = "endpoint" | "track" | "node";

export interface ToolPick {
  readonly kind: PickKind;
  /** The node a drag would start or end at: the existing node, or the lattice node at terrain height. */
  readonly node: NodeRef;
  /**
   * The drag target on the sim plan, integer mm: the pointer's ground point
   * for a free node (the planner snaps it), the exact node position otherwise.
   */
  readonly pointMm: PlanPointMm;
  /** Track only: the piece under the pointer. */
  readonly pieceKey?: PieceKey;
}

/**
 * What a track-family tool builds (architecture "Tools": Bridge and Tunnel are the track tool with the
 * structure forced; Track uses Auto, where the core infers each piece's structure).
 */
export type StructureMode = "auto" | Exclude<Structure, "ground">;

export type ToolEvent =
  /** The tool took over; `structure` picks the Track (auto, the default), Bridge or Tunnel mode. */
  | { readonly type: "activate"; readonly structure?: StructureMode }
  | { readonly type: "deactivate" }
  /** The pointer moved; `pick` is null off the map. */
  | { readonly type: "pointer-move"; readonly pick: ToolPick | null; readonly screen: ScreenPoint }
  | { readonly type: "pointer-down"; readonly pick: ToolPick | null; readonly screen: ScreenPoint }
  | { readonly type: "pointer-up"; readonly pick: ToolPick | null; readonly screen: ScreenPoint }
  | { readonly type: "pointer-leave" }
  /**
   * An arrow key moved the keyboard lattice cursor one step along `heading`
   * (the router resolves screen directions through the camera yaw). `origin`
   * is where the cursor starts when it has no position yet (the node at the
   * viewport centre).
   */
  | { readonly type: "cursor-step"; readonly heading: Heading; readonly origin: NodeRef }
  /** Enter: starts a track at the cursor, or commits the current plan. */
  | { readonly type: "enter" }
  | { readonly type: "escape" }
  /** One elevation step up (+1) or down (−1): PgUp/PgDn, `]`/`[`, Shift+wheel. */
  | { readonly type: "height"; readonly delta: 1 | -1 }
  /** Precision mode held (Ctrl, or ⌥ on macOS) or released. */
  | { readonly type: "precision"; readonly held: boolean }
  /** Precision only: the next larger (+1) or smaller (−1) radius class (wheel). */
  | { readonly type: "radius-step"; readonly delta: 1 | -1 }
  /** Precision only: turn the end heading 30° counter-clockwise (+1, E) or clockwise (−1, Q). */
  | { readonly type: "end-heading-step"; readonly delta: 1 | -1 }
  /** The network changed under the tool (a commit, undo or redo): re-plan against the new revision. */
  | { readonly type: "refresh" };

export type GhostStatus = "new" | "reused";

export interface GhostPiece {
  readonly spec: PieceSpec;
  readonly status: GhostStatus;
  /**
   * The piece's structure as it would be built: a new piece's from the preview's `diff.added` (the core's
   * resolved structure, so Auto shows what inference chose), a reused piece's from the network, and the
   * forced structure (or ground) when the preview rejected the plan.
   */
  readonly structure: Structure;
}

/** The planned track as the ghost draws it; `valid` false draws every piece red and dashed. */
export interface GhostModel {
  readonly pieces: readonly GhostPiece[];
  readonly valid: boolean;
}

/** The hover snap ring: filled on an endpoint, hollow on a free node, a turnout icon on track. */
export interface SnapModel {
  readonly kind: PickKind;
  readonly node: NodeRef;
  /** True when the keyboard cursor, not the pointer, placed it. */
  readonly cursor: boolean;
}

export type GradeLevel = "green" | "amber" | "red";

export interface TooltipMetrics {
  readonly length: string;
  readonly grade: string;
  readonly gradeLevel: GradeLevel;
  readonly minRadius: string;
  readonly endHeight: string;
}

/**
 * The construction tooltip (issue #67 "Presentation"): line 1 the counts,
 * line 2 the metrics, line 3 the controls hint; an invalid plan adds "Can't
 * build: <reason>" and the fix hint; precision mode adds the live label.
 */
export interface TooltipModel {
  readonly counts: string;
  /** What the plan builds when it is not all ground: "Structure: bridge", "Structure: 2 bridge, 3 ground"; else null. */
  readonly structure: string | null;
  readonly metrics: TooltipMetrics | null;
  /** The planner's note when nothing fits (for example "Drag farther to lay track"). */
  readonly note: string | null;
  readonly invalid: { readonly reason: string; readonly fix: string | null } | null;
  /** Precision mode: the planner's live label with the precision controls. */
  readonly precision: string | null;
  readonly hint: string;
  /** Every line as plain text, in display order (the aria-live announcement). */
  readonly lines: readonly string[];
  /** The keyboard cursor's node when it placed the plan's end; null follows the pointer. */
  readonly anchor: NodeRef | null;
}

export type ToolEffect =
  | { readonly type: "execute"; readonly command: Command }
  | { readonly type: "ghost"; readonly ghost: GhostModel | null }
  | { readonly type: "snap"; readonly snap: SnapModel | null }
  | { readonly type: "tooltip"; readonly tooltip: TooltipModel | null }
  /** Existing pieces the current rejection names (drawn red); empty clears them. */
  | { readonly type: "highlight"; readonly keys: readonly PieceKey[] }
  /** Text for the aria-live status line. */
  | { readonly type: "announce"; readonly text: string }
  /** Keep this plan point in view (the keyboard cursor moved). */
  | { readonly type: "camera"; readonly focus: PlanPointMm }
  /** The tool has nothing left to step back from: return to Select. */
  | { readonly type: "exit" };

export interface ToolSettings {
  /** One elevation step, integer mm (PgUp/PgDn, `[` `]`, Shift+wheel). */
  readonly heightStepMm: number;
  /** The largest radius the planner may choose outside precision mode; undefined leaves the planner default (360 m). */
  readonly radiusCapM: RadiusClassM | undefined;
}

/** Read-only context: pure functions of the current network revision and the terrain. */
export interface ToolCtx {
  readonly network: NetworkView;
  planTrack(drag: Drag): TrackPlan;
  /** The memoized `sim.preview` (LRU of 16 keyed by network revision + command key). */
  preview(cmd: Command): Result;
  /**
   * Ground height at a lattice node in integer mm (the terrain, or the water
   * surface over a lower bed: the planner's `groundMmAt`); undefined off the map.
   */
  groundZmm(q: number, r: number): number | undefined;
  readonly settings: ToolSettings;
}

export type Reduced<S> = readonly [S, readonly ToolEffect[]];
