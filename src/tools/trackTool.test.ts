import { describe, expect, it } from "vitest";
import { type Drag, type Sim, createSim, generateTerrain, heightDmAt, opposite } from "../core/sim/api";
import { HINT_LINE } from "./format";
import { pickAtNode } from "./picks";
import { createPreviewMemo } from "./previewMemo";
import { DRAG_THRESHOLD_PX, type TrackToolState, initialTrackState, reduceTrackTool } from "./trackTool";
import type { GhostModel, ToolCtx, ToolEffect, ToolEvent, ToolPick, TooltipModel } from "./types";

const TERRAIN = { seed: "d3-tool", columns: 60, rows: 52 } as const;
const STEP_MM = 1000;

/**
 * A scripted session: the real sim (stub planner), the memo, and an app loop
 * that executes and refreshes. `flat` reports the ground at height 0
 * everywhere, so plans that cross existing track keep its keys; otherwise the
 * seeded terrain's heights apply (the sim itself validates against its own
 * terrain either way, which D2 checks only for bounds).
 */
function session({ flat = false }: { flat?: boolean } = {}) {
  const sim: Sim = createSim({ terrain: TERRAIN });
  const terrain = generateTerrain(TERRAIN);
  const counts = { previews: 0 };
  const drags: Drag[] = [];
  const memo = createPreviewMemo(
    (cmd) => {
      counts.previews += 1;
      return sim.preview(cmd);
    },
    () => sim.network().rev,
  );
  const groundZmm = (q: number, r: number): number | undefined => {
    const h = heightDmAt(terrain, { q, r });
    return h === undefined ? undefined : flat ? 0 : h * 100;
  };
  const ctx = (): ToolCtx => ({
    network: sim.network(),
    planTrack: (drag) => {
      drags.push(drag);
      return sim.planTrack(drag);
    },
    preview: memo.preview,
    groundZmm,
    settings: { heightStepMm: STEP_MM, radiusCapM: undefined },
  });
  let state: TrackToolState = initialTrackState();
  let log: ToolEffect[] = [];
  const all: ToolEffect[] = [];

  function send(event: ToolEvent): ToolEffect[] {
    const [next, effects] = reduceTrackTool(state, event, ctx());
    state = next;
    log = [...effects];
    all.push(...effects);
    // The app's command gateway: execute, then tell the tool the network changed.
    for (const effect of effects) {
      if (effect.type === "execute") {
        const result = sim.execute(effect.command);
        expect(result.ok, JSON.stringify(result)).toBe(true);
        const [after, more] = reduceTrackTool(state, { type: "refresh" }, ctx());
        state = after;
        log.push(...more);
        all.push(...more);
      }
    }
    return log;
  }

  const pick = (q: number, r: number): ToolPick => {
    const p = pickAtNode(sim.network(), groundZmm, q, r);
    if (!p) throw new Error(`no pick at ${q},${r}`);
    return p;
  };
  const screen = (q: number, r: number) => ({ x: 100 + q * 20, y: 400 - r * 20 });
  const move = (q: number, r: number) => send({ type: "pointer-move", pick: pick(q, r), screen: screen(q, r) });
  const down = (q: number, r: number) => send({ type: "pointer-down", pick: pick(q, r), screen: screen(q, r) });
  const up = (q: number, r: number) => send({ type: "pointer-up", pick: pick(q, r), screen: screen(q, r) });
  const drag = (from: [number, number], to: [number, number]) => {
    down(...from);
    move(...to);
    return up(...to);
  };

  return {
    sim,
    groundZmm,
    counts,
    drags,
    memo,
    send,
    pick,
    move,
    down,
    up,
    drag,
    get state() {
      return state;
    },
    get all() {
      return all;
    },
  };
}

function last<T extends ToolEffect["type"]>(effects: readonly ToolEffect[], type: T): Extract<ToolEffect, { type: T }> | undefined {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    if (e?.type === type) return e as Extract<ToolEffect, { type: T }>;
  }
  return undefined;
}

function ghostOf(effects: readonly ToolEffect[]): GhostModel | null | undefined {
  return last(effects, "ghost")?.ghost;
}

function tooltipOf(effects: readonly ToolEffect[]): TooltipModel | null | undefined {
  return last(effects, "tooltip")?.tooltip;
}

describe("track tool: states", () => {
  it("hovers in Idle with a snap ring and no ghost", () => {
    const t = session();
    const fx = t.move(10, 10);
    expect(t.state.phase).toBe("idle");
    expect(last(fx, "snap")?.snap).toEqual({ kind: "node", node: t.pick(10, 10).node, cursor: false });
    expect(fx.some((e) => e.type === "ghost")).toBe(false);
    // The same node again publishes nothing.
    expect(t.move(10, 10)).toEqual([]);
  });

  it("stays Pressed within 4 px and starts Dragging beyond it", () => {
    const t = session();
    t.down(10, 10);
    expect(t.state.phase).toBe("pressed");
    const p = t.pick(10, 10);
    t.send({ type: "pointer-move", pick: p, screen: { x: 300 + DRAG_THRESHOLD_PX, y: 200 } });
    // screen(10, 10) is (300, 200): exactly 4 px is still a press.
    expect(t.state.phase).toBe("pressed");
    const fx = t.move(14, 10);
    expect(t.state.phase).toBe("dragging");
    const ghost = ghostOf(fx);
    expect(ghost?.valid).toBe(true);
    expect(ghost?.pieces.map((g) => g.status)).toEqual(["new", "new", "new", "new"]);
    const tip = tooltipOf(fx);
    expect(tip?.counts).toBe("Pieces: 4 new, 0 reused");
    expect(tip?.lines[0]).toBe("Pieces: 4 new, 0 reused");
    expect(tip?.lines[1]).toMatch(/^Length 20 m · Grade \d+\.\d % · Min radius — · End height 0 m$/);
    expect(tip?.lines.at(-1)).toBe(HINT_LINE);
    expect(last(fx, "announce")?.text).toBe(tip?.lines.join(". "));
  });

  it("commits on release and chains from the new end", () => {
    const t = session();
    const fx = t.drag([10, 10], [14, 10]);
    const exec = last(fx, "execute");
    expect(exec?.command.type).toBe("build-track");
    expect(t.sim.network().pieces.length).toBe(4);
    expect(t.state.phase).toBe("anchored");
    expect(t.state.anchor?.node).toMatchObject({ q: 14, r: 10 });
    expect(t.state.anchor?.heading).toBe(0);
    // Chain: the next plan leaves the end with its heading, and a click commits it.
    t.move(17, 10);
    expect(t.drags.at(-1)?.fromHeading).toBe(0);
    t.down(17, 10);
    t.up(17, 10);
    expect(t.sim.network().pieces.length).toBe(7);
    expect(t.state.anchor?.node).toMatchObject({ q: 17, r: 10 });
  });

  it("anchors on a click in place (click-click) and commits on the next click", () => {
    const t = session();
    t.down(10, 10);
    t.up(10, 10);
    expect(t.state.phase).toBe("anchored");
    expect(t.all.some((e) => e.type === "execute")).toBe(false);
    const fx = t.move(10, 14);
    expect(ghostOf(fx)?.pieces.length).toBe(4);
    t.down(10, 14);
    t.up(10, 14);
    expect(t.sim.network().pieces.length).toBe(4);
    expect(t.state.anchor?.node).toMatchObject({ q: 10, r: 14 });
  });

  it("steps back one level on Esc: Dragging → Anchored → Idle → exit", () => {
    const t = session();
    t.down(10, 10);
    t.move(14, 10);
    t.send({ type: "escape" });
    expect(t.state.phase).toBe("anchored");
    // The release that follows the Esc neither commits nor re-anchors.
    t.up(14, 10);
    expect(t.all.some((e) => e.type === "execute")).toBe(false);
    expect(t.state.phase).toBe("anchored");
    const fx = t.send({ type: "escape" });
    expect(t.state.phase).toBe("idle");
    expect(ghostOf(fx)).toBeNull();
    expect(tooltipOf(fx)).toBeNull();
    expect(last(t.send({ type: "escape" }), "exit")).toEqual({ type: "exit" });
  });

  it("cancels a press on Esc and ignores its release", () => {
    const t = session();
    t.down(10, 10);
    t.send({ type: "escape" });
    expect(t.state.phase).toBe("idle");
    t.up(10, 10);
    expect(t.state.phase).toBe("idle");
  });

  it("starts on an existing endpoint at its height and lets the planner continue the track", () => {
    const t = session();
    t.drag([10, 10], [14, 10]);
    t.send({ type: "escape" });
    const end = t.pick(14, 10);
    expect(end.kind).toBe("endpoint");
    const buffer = t.sim.network().nodes.find((n) => n.q === 14 && n.r === 10);
    expect(end.continueHeading).toBe(buffer ? opposite(buffer.axis) : undefined);
    t.down(14, 10);
    const fx = t.move(18, 10);
    const drag = t.drags.at(-1);
    expect(drag?.from).toEqual(end.node);
    expect(drag?.fromHeading).toBeUndefined();
    expect(ghostOf(fx)?.valid).toBe(true);
    expect(t.state.plan?.pieces.every((p) => p.heading === 0)).toBe(true);
  });

  it("ends the chain after a plan that joined an existing port", () => {
    const t = session({ flat: true });
    // A run whose far end (20, 10) is a port the next drag can snap to.
    t.drag([16, 10], [20, 10]);
    t.send({ type: "escape" });
    t.down(10, 10);
    const fx = t.move(15, 10);
    expect(t.state.plan?.snapped).toMatchObject({ q: 16, r: 10 });
    expect(ghostOf(fx)?.valid).toBe(true);
    const released = t.up(15, 10);
    expect(last(released, "execute")).toBeDefined();
    expect(t.sim.network().pieces.length).toBe(10);
    expect(t.state.phase).toBe("idle");
    expect(t.state.anchor).toBeNull();
  });
});

describe("track tool: preview memo", () => {
  it("previews once per snapped command key and serves revisits from the LRU", () => {
    const t = session();
    t.down(10, 10);
    t.move(14, 10);
    expect(t.counts.previews).toBe(1);
    // The same node again: the view key is unchanged, so neither the tool nor the memo previews.
    t.send({ type: "pointer-move", pick: t.pick(14, 10), screen: { x: 381, y: 199 } });
    expect(t.counts.previews).toBe(1);
    t.move(15, 10);
    expect(t.counts.previews).toBe(2);
    t.move(14, 10);
    expect(t.counts.previews).toBe(2);
    expect(t.memo.stats().hits).toBe(1);
  });

  it("re-previews after the network revision changes", () => {
    const t = session();
    t.drag([10, 10], [14, 10]);
    t.send({ type: "escape" });
    t.down(10, 12);
    t.move(14, 12);
    const before = t.counts.previews;
    t.sim.execute({ type: "undo" });
    const fx = t.send({ type: "refresh" });
    expect(t.counts.previews).toBe(before + 1);
    expect(ghostOf(fx)?.valid).toBe(true);
  });
});

describe("track tool: presentation effects", () => {
  it("marks pieces that already exist as reused", () => {
    const t = session({ flat: true });
    t.drag([10, 10], [14, 10]);
    t.send({ type: "escape" });
    // From a free node across the existing run (a drag from its endpoint would have to continue outward).
    t.down(8, 10);
    const fx = t.move(16, 10);
    expect(ghostOf(fx)?.pieces.map((g) => g.status)).toEqual(["new", "new", "reused", "reused", "reused", "reused", "new", "new"]);
    expect(tooltipOf(fx)?.counts).toBe("Pieces: 4 new, 4 reused");
  });

  it("shows one reason with its fix, highlights the existing pieces, and never executes an invalid plan", () => {
    const t = session();
    t.drag([10, 10], [14, 10]);
    t.send({ type: "escape" });
    // Start mid-track at a through node and leave northwards: a turnout, not buildable in D2.
    expect(t.pick(12, 10).kind).toBe("track");
    t.down(12, 10);
    const fx = t.move(12, 14);
    const ghost = ghostOf(fx);
    expect(ghost?.valid).toBe(false);
    const tip = tooltipOf(fx);
    expect(tip?.invalid?.reason).toMatch(/kink|same direction|pieces meet/i);
    expect(tip?.lines.some((l) => l.startsWith("Can't build: "))).toBe(true);
    expect(tip?.invalid?.fix).toMatch(/^[A-Z]/);
    const keys = last(fx, "highlight")?.keys ?? [];
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(t.sim.network().pieces.some((p) => p.key === k)).toBe(true);
    const released = t.up(12, 14);
    expect(released.some((e) => e.type === "execute")).toBe(false);
    expect(last(released, "announce")?.text).toMatch(/^Can't build: /);
    expect(t.sim.network().pieces.length).toBe(4);
    expect(t.state.phase).toBe("anchored");
  });

  it("gives the planner's note when nothing fits, with no ghost", () => {
    const t = session();
    t.down(10, 10);
    // Anchored on the release; the pointer is still on the start node, so nothing fits yet.
    const fx = t.up(10, 10);
    expect(ghostOf(fx)).toBeNull();
    expect(tooltipOf(fx)?.note).toBe("Drag farther to lay track");
    expect(tooltipOf(fx)?.lines).toEqual(["Pieces: 0 new, 0 reused", "Drag farther to lay track", HINT_LINE]);
  });
});

describe("track tool: height, precision and keyboard", () => {
  it("raises the end one elevation step at a time above the ground", () => {
    const t = session();
    t.down(10, 10);
    t.move(14, 10);
    t.send({ type: "height", delta: 1 });
    const fx = t.send({ type: "height", delta: 1 });
    expect(t.state.heightSteps).toBe(2);
    expect(tooltipOf(fx)?.metrics?.endHeight).toBe("End height +2 m");
    const ground = t.groundZmm(14, 10) ?? 0;
    const drag = t.drags.at(-1);
    expect(drag ? drag.from.zMm + drag.dzMm : undefined).toBe(ground + 2 * STEP_MM);
    t.send({ type: "height", delta: -1 });
    expect(t.state.heightSteps).toBe(1);
  });

  it("takes an existing node's height when the plan ends on it within half a step", () => {
    const t = session({ flat: true });
    // A run on flat ground rising one step (0 → 1000 mm) over six pieces: (12, 12) sits near 333 mm.
    t.down(10, 12);
    t.move(16, 12);
    t.send({ type: "height", delta: 1 });
    t.up(16, 12);
    t.send({ type: "escape" });
    const node = t.sim.network().nodes.find((n) => n.q === 12 && n.r === 12)?.zMm ?? Number.NaN;
    expect(Math.abs(node - 333)).toBeLessThanOrEqual(1);
    // From the ground, a plan ending on that node: within half a 1000 mm step of 0, so it takes the node's height.
    t.down(12, 8);
    t.move(12, 12);
    expect(t.state.plan?.end?.node).toMatchObject({ q: 12, r: 12, zMm: node });
    // Precision turns it off: the end stays on the ground.
    t.send({ type: "precision", held: true });
    expect(t.state.plan?.end?.node.zMm).toBe(0);
  });

  it("ignores height keys until a track is started", () => {
    const t = session();
    const fx = t.send({ type: "height", delta: 1 });
    expect(t.state.heightSteps).toBe(0);
    expect(last(fx, "announce")?.text).toMatch(/Start a track first/);
  });

  it("keeps the height above ground when chaining", () => {
    const t = session();
    t.down(10, 10);
    t.move(14, 10);
    t.send({ type: "height", delta: 1 });
    t.up(14, 10);
    expect(t.state.heightSteps).toBe(1);
    const end = t.sim.network().nodes.find((n) => n.q === 14 && n.r === 10);
    expect(end?.zMm).toBe((t.groundZmm(14, 10) ?? 0) + STEP_MM);
  });

  it("maps precision mode, the radius wheel and Q/E onto the drag", () => {
    const t = session();
    t.down(10, 10);
    t.move(14, 10);
    expect(t.drags.at(-1)?.magnetism).toBe(true);
    expect(t.drags.at(-1)?.precision).toBeUndefined();
    let fx = t.send({ type: "precision", held: true });
    expect(t.drags.at(-1)?.magnetism).toBe(false);
    expect(t.drags.at(-1)?.precision).toEqual({ radiusM: 180 });
    expect(tooltipOf(fx)?.precision).toMatch(/^Precision: Straight · 60 km\/h · \d+\.\d% · wheel radius · Q\/E end heading$/);
    t.send({ type: "radius-step", delta: -1 });
    expect(t.drags.at(-1)?.precision).toEqual({ radiusM: 120 });
    fx = t.send({ type: "end-heading-step", delta: 1 });
    expect(t.drags.at(-1)?.precision).toEqual({ radiusM: 120, endHeading: 1 });
    t.send({ type: "precision", held: false });
    expect(t.drags.at(-1)?.precision).toBeUndefined();
    // Outside precision the wheel and Q/E do nothing to the plan.
    const before = t.drags.length;
    t.send({ type: "radius-step", delta: 1 });
    t.send({ type: "end-heading-step", delta: 1 });
    expect(t.drags.length).toBe(before);
  });

  it("builds from the keyboard: arrows move the cursor, Enter starts and commits", () => {
    const t = session();
    const origin = { q: 10, r: 10, zMm: 0 };
    let fx = t.send({ type: "cursor-step", heading: 0, origin });
    expect(t.state.target?.node).toMatchObject({ q: 11, r: 10 });
    expect(last(fx, "camera")?.focus).toEqual(t.pick(11, 10).pointMm);
    expect(last(fx, "snap")?.snap?.cursor).toBe(true);
    t.send({ type: "enter" });
    expect(t.state.phase).toBe("anchored");
    for (let i = 0; i < 3; i++) fx = t.send({ type: "cursor-step", heading: 0, origin });
    expect(tooltipOf(fx)?.anchor).toMatchObject({ q: 14, r: 10 });
    fx = t.send({ type: "enter" });
    expect(last(fx, "execute")).toBeDefined();
    expect(t.sim.network().pieces.length).toBe(3);
    expect(t.state.anchor?.node).toMatchObject({ q: 14, r: 10 });
  });

  it("asks for a cursor before Enter can start a track", () => {
    const t = session();
    const fx = t.send({ type: "enter" });
    expect(t.state.phase).toBe("idle");
    expect(last(fx, "announce")?.text).toMatch(/arrow keys/);
  });

  it("clears every visual on deactivate", () => {
    const t = session();
    t.down(10, 10);
    t.move(14, 10);
    const fx = t.send({ type: "deactivate" });
    expect(fx).toEqual([
      { type: "ghost", ghost: null },
      { type: "tooltip", tooltip: null },
      { type: "snap", snap: null },
      { type: "highlight", keys: [] },
    ]);
    expect(t.state.phase).toBe("idle");
  });
});
