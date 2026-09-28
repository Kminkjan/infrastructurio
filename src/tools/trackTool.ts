import {
  type Command,
  type Drag,
  type Heading,
  type NetworkView,
  type NodeRef,
  type PieceKey,
  RADIUS_CLASSES_M,
  type RadiusClassM,
  type Result,
  type Structure,
  type TrackPlan,
  canonicalKey,
  opposite,
  rotateHeading,
  stepOf,
} from "../core/sim/api";
import { buildTooltip, formatCounts, formatHeight, formatStructures, splitReason } from "./format";
import { nodesAt, pickAtNode } from "./picks";
import { commandKey } from "./previewMemo";
import type { GhostModel, Reduced, ScreenPoint, StructureMode, ToolCtx, ToolEffect, ToolEvent, ToolPick } from "./types";

/**
 * The track tool (issue #67 "Tool and input"), a pure reducer:
 *
 *   Idle → Pressed → Dragging (pointer moved > 4 px) → release: Commit
 *                  ↘ Anchored (released in place: click-click) → click: Commit
 *   Commit → chain: stays Anchored at the new end, leaving with the end heading.
 *
 * Esc steps back one level: Dragging → Anchored, Pressed or Anchored → Idle,
 * Idle → exit to Select. The keyboard cursor (arrows) moves the target one
 * lattice step; Enter starts at the cursor and then commits. Every
 * activation starts with precision off; the app sends `precision` when the
 * modifier is actually held.
 *
 * Every re-plan goes through `planTrack`; `preview` (memoized in the app)
 * runs only when the published view changes, that is when the snapped
 * command key, the network revision or the displayed values change. The
 * command a commit executes is exactly the one the ghost last showed.
 *
 * Height: track follows the ground (owner decision 2026-09-27, for D3). The
 * end sits `heightSteps` elevation steps above the ground at the end node
 * (`ctx.groundZmm`, the planner's own ground), and the planner lays every
 * inner node on the ground plus an offset it ramps from the start's to the
 * end's, so with no steps a drag lays the whole track on the ground, hills
 * included, and ]/[ lift or lower the end. Anchoring on existing track
 * starts at that track's height above ground; chaining keeps the steps. A
 * plan that magnetism joined to an existing port takes the port's height. A
 * plan that joins an existing buffer end (by magnetism, or in precision mode
 * by ending on it) ends the chain when it commits (Idle): leaving a joined
 * port would need a turnout (D5). A plan that reaches a buffer end along its
 * own track (reused pieces) leaves it outward, so the chain goes on. A plan
 * ending on an existing node within half a step of that node's height takes
 * its height too (outside precision mode).
 *
 * After a commit the app executes and sends `refresh`; that re-plan's
 * announcement leads with the build result, so a screen reader hears both.
 * An undo or redo sends `refresh` too: when the node a chain leaves from is
 * no longer in the network (the undo removed the track that ended there), the
 * chain ends and the tool returns to Idle.
 */

/** Movement beyond this many CSS px turns a press into a drag. */
export const DRAG_THRESHOLD_PX = 4;
/** The radius class precision mode starts with; the wheel steps through the classes. */
export const DEFAULT_PRECISION_RADIUS_M: RadiusClassM = 180;

export type TrackPhase = "idle" | "pressed" | "dragging" | "anchored";

export interface Anchor {
  readonly node: NodeRef;
  /** The heading new track must leave with: a chained end's, or an endpoint's continuation. */
  readonly heading: Heading | undefined;
}

export interface TrackToolState {
  readonly phase: TrackPhase;
  /** What the pointer or the keyboard cursor is on; null off the map or outside the canvas. */
  readonly target: ToolPick | null;
  /** True when the keyboard cursor placed `target`. */
  readonly cursor: boolean;
  readonly anchor: Anchor | null;
  /** The pending press (Pressed, or a click in Anchored). */
  readonly press: { readonly screen: ScreenPoint; readonly pick: ToolPick | null } | null;
  /** Elevation steps of the end above the terrain. */
  readonly heightSteps: number;
  readonly precision: boolean;
  readonly radiusM: RadiusClassM;
  /** Precision only: the explicit end heading; undefined lets the planner choose. */
  readonly endHeading: Heading | undefined;
  /** Set by Esc during a press: the coming release must not commit or anchor. */
  readonly ignoreRelease: boolean;
  /** The plan, command and verdict the ghost and tooltip show. */
  readonly plan: TrackPlan | null;
  readonly command: Command | null;
  readonly verdict: Result | null;
  /** Keys of what was last published, so unchanged views emit nothing. */
  readonly viewKey: string | null;
  readonly snapKey: string | null;
  /** A commit's "Built…" text, waiting to lead the announcement of the re-plan that follows it. */
  readonly built: string | null;
  /** D4: Track builds with structure auto; the Bridge and Tunnel tools force one. */
  readonly structure: StructureMode;
}

export function initialTrackState(structure: StructureMode = "auto"): TrackToolState {
  return {
    phase: "idle",
    target: null,
    cursor: false,
    anchor: null,
    press: null,
    heightSteps: 0,
    precision: false,
    radiusM: DEFAULT_PRECISION_RADIUS_M,
    endHeading: undefined,
    ignoreRelease: false,
    plan: null,
    command: null,
    verdict: null,
    viewKey: null,
    snapKey: null,
    built: null,
    structure,
  };
}

export function reduceTrackTool(state: TrackToolState, event: ToolEvent, ctx: ToolCtx): Reduced<TrackToolState> {
  const out: ToolEffect[] = [];
  const next = step(state, event, ctx, out);
  return [next, out];
}

function step(s: TrackToolState, e: ToolEvent, ctx: ToolCtx, out: ToolEffect[]): TrackToolState {
  switch (e.type) {
    case "activate":
      // Precision starts off: the modifier may have been released while the tool was inactive.
      return present({ ...initialTrackState(e.structure ?? "auto"), radiusM: s.radiusM }, ctx, out);

    case "deactivate":
      out.push({ type: "ghost", ghost: null }, { type: "tooltip", tooltip: null }, { type: "snap", snap: null }, { type: "highlight", keys: [] });
      return { ...initialTrackState(), radiusM: s.radiusM };

    case "pointer-move": {
      let n: TrackToolState = { ...s, target: e.pick, cursor: false };
      if (s.phase === "pressed" && s.press && distance(e.screen, s.press.screen) > DRAG_THRESHOLD_PX) {
        n = s.press.pick ? startAt({ ...n, phase: "dragging" }, s.press.pick, ctx) : { ...n, phase: "idle", press: null };
      }
      return present(n, ctx, out);
    }

    case "pointer-down": {
      const n: TrackToolState = { ...s, target: e.pick, cursor: false, ignoreRelease: false };
      if (s.phase === "idle") return e.pick ? present({ ...n, phase: "pressed", press: { screen: e.screen, pick: e.pick } }, ctx, out) : present(n, ctx, out);
      if (s.phase === "anchored") return present({ ...n, press: { screen: e.screen, pick: e.pick } }, ctx, out);
      return present(n, ctx, out);
    }

    case "pointer-up": {
      const n: TrackToolState = { ...s, target: e.pick, cursor: false };
      if (s.ignoreRelease) return present({ ...n, ignoreRelease: false, press: null }, ctx, out);
      if (s.phase === "pressed") {
        const pick = s.press?.pick ?? null;
        if (!pick) return present({ ...n, phase: "idle", press: null }, ctx, out);
        const anchored = startAt({ ...n, phase: "anchored", press: null }, pick, ctx);
        out.push({ type: "announce", text: startedText(pick) });
        return present(anchored, ctx, out);
      }
      if (s.phase === "dragging" || (s.phase === "anchored" && s.press)) return commit({ ...n, press: null }, ctx, out);
      return present(n, ctx, out);
    }

    case "pointer-leave":
      return present({ ...s, target: null, cursor: false }, ctx, out);

    case "cursor-step": {
      const base = s.target?.node ?? e.origin;
      const d = stepOf(e.heading);
      const pick = pickAtNode(ctx.network, ctx.groundZmm, base.q + d.q, base.r + d.r);
      if (!pick) {
        out.push({ type: "announce", text: "The cursor is at the edge of the map." });
        return s;
      }
      out.push({ type: "camera", focus: pick.pointMm });
      const n = present({ ...s, target: pick, cursor: true }, ctx, out);
      if (n.phase === "idle") out.push({ type: "announce", text: cursorText(pick) });
      return n;
    }

    case "enter":
      if (s.phase === "idle") {
        if (!s.target) {
          out.push({ type: "announce", text: "Move the cursor with the arrow keys, then press Enter to start a track." });
          return s;
        }
        const pick = s.target;
        const anchored = startAt({ ...s, phase: "anchored" }, pick, ctx);
        out.push({ type: "announce", text: startedText(pick) });
        return present(anchored, ctx, out);
      }
      if (s.phase === "anchored") return commit(s, ctx, out);
      return s;

    case "escape":
      switch (s.phase) {
        case "dragging":
          return present({ ...s, phase: "anchored", press: null, ignoreRelease: true }, ctx, out);
        case "pressed":
          return present({ ...s, phase: "idle", press: null, anchor: null, ignoreRelease: true }, ctx, out);
        case "anchored": {
          out.push({ type: "announce", text: "Track cancelled." });
          const held = s.press !== null;
          return present(
            { ...s, phase: "idle", press: null, anchor: null, heightSteps: 0, endHeading: undefined, ignoreRelease: held },
            ctx,
            out,
          );
        }
        case "idle":
          out.push({ type: "exit" });
          return s;
      }
      return s;

    case "height": {
      if (s.phase !== "anchored" && s.phase !== "dragging") {
        out.push({ type: "announce", text: "Start a track first; the height keys raise or lower its end." });
        return s;
      }
      const n = present({ ...s, heightSteps: s.heightSteps + e.delta }, ctx, out);
      if (!n.plan || n.plan.fit === "none") out.push({ type: "announce", text: `End height ${formatHeight(n.heightSteps * ctx.settings.heightStepMm)} above the ground.` });
      return n;
    }

    case "precision":
      if (s.precision === e.held) return s;
      return present({ ...s, precision: e.held }, ctx, out);

    case "radius-step": {
      if (!s.precision) return s;
      const i = RADIUS_CLASSES_M.indexOf(s.radiusM);
      const radiusM = RADIUS_CLASSES_M[Math.min(RADIUS_CLASSES_M.length - 1, Math.max(0, i + e.delta))] ?? s.radiusM;
      if (radiusM === s.radiusM) return s;
      const n = present({ ...s, radiusM }, ctx, out);
      if (!n.plan || n.plan.fit === "none") out.push({ type: "announce", text: `Radius ${radiusM} m.` });
      return n;
    }

    case "end-heading-step": {
      if (!s.precision || (s.phase !== "anchored" && s.phase !== "dragging")) return s;
      const base = s.endHeading ?? s.plan?.end?.heading ?? s.anchor?.heading ?? 0;
      return present({ ...s, endHeading: rotateHeading(base, e.delta) }, ctx, out);
    }

    case "refresh": {
      const anchor = s.anchor;
      if (anchor?.heading !== undefined && !nodeExists(ctx.network, anchor.node)) {
        // The chain's end is gone (an undo removed it, or the build did not land): nothing to continue from.
        clearView(out);
        out.push({ type: "announce", text: "Track ended: the end it continued from is gone." });
        return present(
          { ...s, phase: "idle", press: null, anchor: null, heightSteps: 0, endHeading: undefined, ignoreRelease: s.press !== null, built: null, viewKey: null },
          ctx,
          out,
        );
      }
      return present({ ...s, built: null, viewKey: null }, ctx, out, s.built);
    }
  }
}

/**
 * Anchors at a pick: its node (an existing node keeps its height) and its
 * height above ground in steps. No start heading is forced: on an existing
 * buffer end the planner itself picks continuing the track or running back
 * over it, whichever is nearer the drag direction; elsewhere it follows the
 * drag. Only a chained start carries the previous plan's end heading.
 */
function startAt(s: TrackToolState, pick: ToolPick, ctx: ToolCtx): TrackToolState {
  const ground = ctx.groundZmm(pick.node.q, pick.node.r);
  const stepMm = ctx.settings.heightStepMm;
  const heightSteps = ground === undefined ? 0 : Math.round((pick.node.zMm - ground) / stepMm);
  return {
    ...s,
    anchor: { node: pick.node, heading: undefined },
    heightSteps,
    endHeading: undefined,
    viewKey: null,
  };
}

/** Commits the current plan when the preview accepted it, then chains from its end. */
function commit(s: TrackToolState, ctx: ToolCtx, out: ToolEffect[]): TrackToolState {
  const cur = present({ ...s, phase: "anchored" }, ctx, out);
  const plan = cur.plan;
  if (!plan || !plan.end || !cur.command) {
    out.push({ type: "announce", text: plan?.note ?? "Nothing to build here." });
    return cur;
  }
  if (!cur.verdict || !cur.verdict.ok) {
    const reason = cur.verdict && !cur.verdict.ok ? splitReason(cur.verdict.reason).reason : "the plan was not checked";
    out.push({ type: "announce", text: `Can't build: ${reason}.` });
    return cur;
  }
  out.push({ type: "execute", command: cur.command });
  const end = plan.end;
  if (joinsBuffer(ctx.network, end.node, end.heading)) {
    // Joined an existing buffer end (magnetism, or a precision plan ending on it): chaining on from it
    // would need a turnout (D5), so the chain ends here, and Idle shows no plan.
    clearView(out);
    out.push({ type: "announce", text: `Built and joined the track at (${end.node.q}, ${end.node.r}). ${formatCounts(cur.verdict.counts)}.` });
    return { ...cur, phase: "idle", anchor: null, heightSteps: 0, endHeading: undefined, plan: null, command: null, verdict: null, viewKey: null };
  }
  const built = `Built. ${formatCounts(cur.verdict.counts)}.`;
  out.push({ type: "announce", text: built });
  // The app executes, then sends `refresh`, which re-plans from the new end against the new revision
  // and leads its announcement with `built`.
  return {
    ...cur,
    anchor: { node: end.node, heading: end.heading },
    endHeading: undefined,
    plan: null,
    command: null,
    verdict: null,
    viewKey: null,
    built,
  };
}

/** Clears the ghost, tooltip and highlights (the snap ring stays with the target). */
function clearView(out: ToolEffect[]): void {
  out.push({ type: "ghost", ghost: null }, { type: "tooltip", tooltip: null }, { type: "highlight", keys: [] });
}

/** Whether the network has a node at exactly (q, r, zMm). */
function nodeExists(network: NetworkView, node: NodeRef): boolean {
  return nodesAt(network, node.q, node.r).some((n) => n.zMm === node.zMm);
}

/**
 * Whether a plan ending at `node` with `heading` joins an existing buffer end
 * there: it does unless it arrived along the buffer's own track (reused
 * pieces), in which case it leaves the buffer outward, along `opposite(axis)`.
 */
function joinsBuffer(network: NetworkView, node: NodeRef, heading: Heading): boolean {
  const buffer = nodesAt(network, node.q, node.r).find((n) => n.zMm === node.zMm && n.kind === "buffer");
  return buffer !== undefined && heading !== opposite(buffer.axis);
}

/**
 * Re-plans when a plan is due and publishes whatever changed: the snap ring,
 * then the ghost, tooltip, highlights and announcement (led by `lead` when
 * given). Nothing is emitted for a view that has not changed.
 */
function present(s: TrackToolState, ctx: ToolCtx, out: ToolEffect[], lead: string | null = null): TrackToolState {
  const target = s.target;
  const snapKey = target ? `${target.kind}:${target.node.q},${target.node.r},${target.node.zMm}:${s.cursor ? "k" : "p"}` : null;
  if (snapKey !== s.snapKey) {
    out.push({ type: "snap", snap: target ? { kind: target.kind, node: target.node, cursor: s.cursor } : null });
  }

  const anchor = s.anchor;
  if (!anchor || !target || (s.phase !== "anchored" && s.phase !== "dragging")) {
    if (s.viewKey !== null) clearView(out);
    return { ...s, snapKey, plan: null, command: null, verdict: null, viewKey: null };
  }

  const plan = planFor(s, anchor, target, ctx);
  const end = plan.end;
  const ground = end ? ctx.groundZmm(end.node.q, end.node.r) : undefined;
  const endHeightMm = end ? end.node.zMm - (ground ?? end.node.zMm) : 0;
  const command: Command | null = plan.fit === "none" ? null : { type: "build-track", pieces: plan.pieces, structure: s.structure };
  const tipAnchor = s.cursor ? target.node : null;
  const viewKey = [
    ctx.network.rev,
    command ? commandKey(command) : `none:${plan.note ?? ""}`,
    s.precision ? plan.label : "",
    endHeightMm,
    tipAnchor ? `${tipAnchor.q},${tipAnchor.r}` : "",
  ].join("|");
  if (viewKey === s.viewKey) return { ...s, snapKey, plan, command };

  const verdict = command ? ctx.preview(command) : null;
  const rejection = verdict && !verdict.ok ? verdict.reason : null;
  const ghost = command ? ghostOf(plan, verdict, ctx.network, s.structure) : null;
  const structure = ghost ? formatStructures(s.structure, ghost.pieces.map((p) => p.structure)) : null;
  const tooltip = buildTooltip({ plan, endHeightMm, rejection, precision: s.precision, anchor: tipAnchor, structure });
  out.push(
    { type: "ghost", ghost },
    { type: "tooltip", tooltip },
    { type: "highlight", keys: verdict && !verdict.ok ? existingKeys(ctx.network, verdict.highlight) : [] },
    { type: "announce", text: lead === null ? tooltip.lines.join(". ") : `${lead} ${tooltip.lines.join(". ")}` },
  );
  return { ...s, snapKey, plan, command, verdict, viewKey };
}

/**
 * The drag for the current state, planned. The tool sets only the end
 * height; the planner lays the inner nodes on the ground plus a ramped offset.
 * The end follows the ground at the plan's end node (plus the height steps),
 * which is known only after planning, so a plan whose end differs from the
 * first guess is planned once more with the corrected height. A magnetism
 * snap, or ending on an existing endpoint, takes that node's height so the
 * track joins it.
 */
function planFor(s: TrackToolState, anchor: Anchor, target: ToolPick, ctx: ToolCtx): TrackPlan {
  const stepMm = ctx.settings.heightStepMm;
  const lift = s.heightSteps * stepMm;
  const from = anchor.node;
  const groundOr = (q: number, r: number): number => ctx.groundZmm(q, r) ?? from.zMm;
  const drag = (dzMm: number): Drag => ({
    from,
    ...(anchor.heading === undefined ? {} : { fromHeading: anchor.heading }),
    to: target.pointMm,
    dzMm,
    magnetism: !s.precision,
    ...(ctx.settings.radiusCapM === undefined ? {} : { radiusCapM: ctx.settings.radiusCapM }),
    ...(s.precision ? { precision: { radiusM: s.radiusM, ...(s.endHeading === undefined ? {} : { endHeading: s.endHeading }) } } : {}),
  });
  const wanted = (end: NodeRef, snapped: NodeRef | null): number => {
    if (snapped) return snapped.zMm;
    if (target.kind === "endpoint" && end.q === target.node.q && end.r === target.node.r) return target.node.zMm;
    const free = groundOr(end.q, end.r) + lift;
    // Vertical magnetism (off in precision, like the planner's): ending on existing track within
    // half a step of its height takes that height, so the plan meets the node instead of passing it.
    if (!s.precision) {
      for (const node of nodesAt(ctx.network, end.q, end.r)) if (Math.abs(node.zMm - free) * 2 <= stepMm) return node.zMm;
    }
    return free;
  };
  const first = wanted(target.node, null);
  const plan = ctx.planTrack(drag(first - from.zMm));
  if (!plan.end) return plan;
  const want = wanted(plan.end.node, plan.snapped);
  return want === plan.end.node.zMm ? plan : ctx.planTrack(drag(want - from.zMm));
}

const keySets = new WeakMap<NetworkView, ReadonlyMap<PieceKey, Structure>>();

/** The network's pieces by key, with their structures. */
function pieceKeys(network: NetworkView): ReadonlyMap<PieceKey, Structure> {
  let keys = keySets.get(network);
  if (!keys) {
    keys = new Map(network.pieces.map((p) => [p.key, p.structure]));
    keySets.set(network, keys);
  }
  return keys;
}

/**
 * The ghost: each piece new or reused, with its structure as it would be built (a new piece's from the
 * preview's `diff.added`, a reused piece's from the network, else the forced structure or ground).
 */
function ghostOf(plan: TrackPlan, verdict: Result | null, network: NetworkView, mode: StructureMode): GhostModel {
  const existing = pieceKeys(network);
  const added = verdict?.ok ? new Map(verdict.diff.added.map((r) => [r.key, r.structure])) : undefined;
  const fallback: Structure = mode === "auto" ? "ground" : mode;
  return {
    pieces: plan.pieces.map((spec) => {
      const key = canonicalKey(spec);
      const reused = key === undefined ? undefined : existing.get(key);
      const structure = reused ?? (key === undefined ? undefined : added?.get(key)) ?? fallback;
      return { spec, status: reused !== undefined ? "reused" : "new", structure };
    }),
    valid: verdict !== null && verdict.ok,
  };
}

function existingKeys(network: NetworkView, keys: readonly PieceKey[]): readonly PieceKey[] {
  const existing = pieceKeys(network);
  return keys.filter((k) => existing.has(k));
}

function distance(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function describePick(pick: ToolPick): string {
  const at = `(${pick.node.q}, ${pick.node.r})`;
  if (pick.kind === "endpoint") return `the track end at ${at}`;
  if (pick.kind === "track") return `the track at ${at}`;
  return `node ${at}`;
}

function startedText(pick: ToolPick): string {
  return `Track started at ${describePick(pick)}. Move to plan it, click or press Enter to lay it, Esc to cancel.`;
}

function cursorText(pick: ToolPick): string {
  return `Cursor on ${describePick(pick)}. Press Enter to start a track here.`;
}
