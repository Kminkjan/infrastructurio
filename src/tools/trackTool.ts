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
  type TrackPlan,
  canonicalKey,
  rotateHeading,
  stepOf,
} from "../core/sim/api";
import { buildTooltip, formatCounts, formatHeight, splitReason } from "./format";
import { pickAtNode } from "./picks";
import { commandKey } from "./previewMemo";
import type { GhostModel, Reduced, ScreenPoint, ToolCtx, ToolEffect, ToolEvent, ToolPick } from "./types";

/**
 * The track tool (issue #67 "Tool and input"), a pure reducer:
 *
 *   Idle → Pressed → Dragging (pointer moved > 4 px) → release: Commit
 *                  ↘ Anchored (released in place: click-click) → click: Commit
 *   Commit → chain: stays Anchored at the new end, leaving with the end heading.
 *
 * Esc steps back one level: Dragging → Anchored, Pressed or Anchored → Idle,
 * Idle → exit to Select. The keyboard cursor (arrows) moves the target one
 * lattice step; Enter starts at the cursor and then commits.
 *
 * Every re-plan goes through `planTrack`; `preview` (memoized in the app)
 * runs only when the published view changes, that is when the snapped
 * command key, the network revision or the displayed values change. The
 * command a commit executes is exactly the one the ghost last showed.
 *
 * Height: the end sits `heightSteps` elevation steps above the terrain at
 * the end node (ground-following), so a drag across the land lays track on
 * the ground and ]/[ lift or lower the end. Anchoring on existing track
 * starts at that track's height above ground; chaining keeps the steps. A
 * plan that magnetism joined to an existing port takes the port's height,
 * and after it commits the chain ends (Idle): leaving a joined port would
 * need a turnout (D5).
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
}

export function initialTrackState(): TrackToolState {
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
      return present({ ...initialTrackState(), precision: s.precision, radiusM: s.radiusM }, ctx, out);

    case "deactivate":
      out.push({ type: "ghost", ghost: null }, { type: "tooltip", tooltip: null }, { type: "snap", snap: null }, { type: "highlight", keys: [] });
      return { ...initialTrackState(), precision: s.precision, radiusM: s.radiusM };

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

    case "refresh":
      return present({ ...s, viewKey: null }, ctx, out);
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
  if (plan.snapped) {
    // Joined an existing port: chaining on from it would need a turnout (D5), so the chain ends here.
    out.push({ type: "announce", text: `Built and joined the track at (${plan.snapped.q}, ${plan.snapped.r}). ${formatCounts(cur.verdict.counts)}.` });
    return { ...cur, phase: "idle", anchor: null, heightSteps: 0, endHeading: undefined, plan: null, command: null, verdict: null, viewKey: null };
  }
  out.push({ type: "announce", text: `Built. ${formatCounts(cur.verdict.counts)}.` });
  // The app executes, then sends `refresh`, which re-plans from the new end against the new revision.
  return {
    ...cur,
    anchor: { node: plan.end.node, heading: plan.end.heading },
    endHeading: undefined,
    plan: null,
    command: null,
    verdict: null,
    viewKey: null,
  };
}

/**
 * Re-plans when a plan is due and publishes whatever changed: the snap ring,
 * then the ghost, tooltip, highlights and announcement. Nothing is emitted
 * for a view that has not changed.
 */
function present(s: TrackToolState, ctx: ToolCtx, out: ToolEffect[]): TrackToolState {
  const target = s.target;
  const snapKey = target ? `${target.kind}:${target.node.q},${target.node.r},${target.node.zMm}:${s.cursor ? "k" : "p"}` : null;
  if (snapKey !== s.snapKey) {
    out.push({ type: "snap", snap: target ? { kind: target.kind, node: target.node, cursor: s.cursor } : null });
  }

  const anchor = s.anchor;
  if (!anchor || !target || (s.phase !== "anchored" && s.phase !== "dragging")) {
    if (s.viewKey !== null) {
      out.push({ type: "ghost", ghost: null }, { type: "tooltip", tooltip: null }, { type: "highlight", keys: [] });
    }
    return { ...s, snapKey, plan: null, command: null, verdict: null, viewKey: null };
  }

  const plan = planFor(s, anchor, target, ctx);
  const end = plan.end;
  const ground = end ? ctx.groundZmm(end.node.q, end.node.r) : undefined;
  const endHeightMm = end ? end.node.zMm - (ground ?? end.node.zMm) : 0;
  const command: Command | null = plan.fit === "none" ? null : { type: "build-track", pieces: plan.pieces, structure: "auto" };
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
  const tooltip = buildTooltip({ plan, endHeightMm, rejection, precision: s.precision, anchor: tipAnchor });
  out.push(
    { type: "ghost", ghost: command ? ghostOf(plan, verdict, ctx.network) : null },
    { type: "tooltip", tooltip },
    { type: "highlight", keys: verdict && !verdict.ok ? existingKeys(ctx.network, verdict.highlight) : [] },
    { type: "announce", text: tooltip.lines.join(". ") },
  );
  return { ...s, snapKey, plan, command, verdict, viewKey };
}

/**
 * The drag for the current state, planned. The end height follows the ground
 * at the plan's end node (plus the height steps), which is known only after
 * planning, so a plan whose end differs from the first guess is planned once
 * more with the corrected height. A magnetism snap, or ending on an existing
 * endpoint, takes that node's height so the track joins it.
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
    return groundOr(end.q, end.r) + lift;
  };
  const first = wanted(target.node, null);
  const plan = ctx.planTrack(drag(first - from.zMm));
  if (!plan.end) return plan;
  const want = wanted(plan.end.node, plan.snapped);
  return want === plan.end.node.zMm ? plan : ctx.planTrack(drag(want - from.zMm));
}

const keySets = new WeakMap<NetworkView, ReadonlySet<PieceKey>>();

function pieceKeys(network: NetworkView): ReadonlySet<PieceKey> {
  let keys = keySets.get(network);
  if (!keys) {
    keys = new Set(network.pieces.map((p) => p.key));
    keySets.set(network, keys);
  }
  return keys;
}

function ghostOf(plan: TrackPlan, verdict: Result | null, network: NetworkView): GhostModel {
  const existing = pieceKeys(network);
  return {
    pieces: plan.pieces.map((spec) => {
      const key = canonicalKey(spec);
      return { spec, status: key !== undefined && existing.has(key) ? "reused" : "new" };
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
