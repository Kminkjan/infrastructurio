import { describe, expect, it } from "vitest";
import { diorama } from "../../tests/support/groundPlans";
import { makeTerrain } from "../../tests/support/makeTerrain";
import { type Drag, type Sim, type Terrain, generateTerrain, waterDeckMm } from "../core/sim/api";
import { createWorld } from "../core/sim/world";
import { HINT_LINE, STRAIGHT_HINT_LINE, formatHeight } from "./format";
import { pickAtNode } from "./picks";
import { createPreviewMemo } from "./previewMemo";
import { DRAG_THRESHOLD_PX, type TrackToolState, initialTrackState, reduceTrackTool } from "./trackTool";
import type { GhostModel, ToolCtx, ToolEffect, ToolEvent, ToolPick, TooltipModel } from "./types";

const TERRAIN = { seed: "d3-tool", columns: 60, rows: 52 } as const;
const STEP_MM = 1000;

/** A `Sim` over a given terrain (tests only: `createSim` generates its terrain from a seed). */
function simOn(terrain: Terrain): Sim {
  const w = createWorld(terrain);
  return {
    tick: 0,
    planTrack: (drag) => w.plan(drag),
    preview: (cmd) => w.run(cmd, false),
    execute: (cmd) => w.run(cmd, true),
    network: () => w.network(),
    ground: () => w.ground(),
    groundMm: (q, r) => w.groundMm(q, r),
  };
}

/**
 * A scripted session: the real sim and planner, the memo, and an app loop
 * that executes and refreshes. The ground is `groundMmAt` on the sim's own
 * terrain, as the app wires it, so the tool's plan ends and the planner's
 * ground-following inner nodes agree. `flat` puts the sim on flat dry ground
 * at height 0 (no water), so heights read as whole steps; otherwise the
 * seeded terrain applies.
 */
function session({ flat = false, terrain: given }: { flat?: boolean; terrain?: Terrain } = {}) {
  const terrain = given ?? (flat ? makeTerrain(TERRAIN.columns, TERRAIN.rows, () => 0, -100) : generateTerrain(TERRAIN));
  const sim: Sim = simOn(terrain);
  const counts = { previews: 0 };
  const drags: Drag[] = [];
  const memo = createPreviewMemo(
    (cmd) => {
      counts.previews += 1;
      return sim.preview(cmd);
    },
    () => sim.network().rev,
  );
  // The app's ground: the sim's effective ground (the terrain as the track's earthworks shape it; D4 feel-check fixes).
  const groundZmm = (q: number, r: number): number | undefined => sim.groundMm(q, r);
  const ctx = (): ToolCtx => ({
    network: sim.network(),
    planTrack: (drag) => {
      drags.push(drag);
      return sim.planTrack(drag);
    },
    preview: memo.preview,
    groundZmm,
    waterDeckZmm: (q, r) => waterDeckMm(terrain, { q, r }),
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
    // The refresh re-plans from the new end; its announcement leads with the build, so both are heard.
    expect(last(fx, "announce")?.text).toBe(
      `Built. Pieces: 4 new, 0 reused. Pieces: 0 new, 0 reused. Drag farther to lay track. ${HINT_LINE}`,
    );
    // Only once: the next view is announced on its own.
    expect(last(t.move(16, 10), "announce")?.text).toMatch(/^Pieces: 2 new, 0 reused\. /);
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
    // Idle shows no plan: the committed ghost and its tooltip are cleared.
    expect(ghostOf(released)).toBeNull();
    expect(tooltipOf(released)).toBeNull();
    expect(last(released, "announce")?.text).toBe("Built and joined the track at (16, 10). Pieces: 6 new, 0 reused.");
  });

  it("ends the chain after a precision plan that joined an existing buffer end", () => {
    const t = session({ flat: true });
    t.drag([16, 10], [20, 10]);
    t.send({ type: "escape" });
    // Precision turns magnetism off, so the planner reports no snap; the plan still ends on the buffer end.
    t.send({ type: "precision", held: true });
    t.down(10, 10);
    const fx = t.move(16, 10);
    expect(ghostOf(fx)?.valid).toBe(true);
    expect(t.state.plan?.snapped).toBeNull();
    expect(t.state.plan?.end).toMatchObject({ node: { q: 16, r: 10, zMm: 0 }, heading: 0 });
    const released = t.up(16, 10);
    expect(last(released, "execute")).toBeDefined();
    expect(t.sim.network().pieces.length).toBe(10);
    expect(t.state.phase).toBe("idle");
    expect(t.state.anchor).toBeNull();
  });

  it("keeps chaining after a plan that reached a buffer end along its own track", () => {
    const t = session({ flat: true });
    t.drag([10, 10], [14, 10]);
    t.send({ type: "escape" });
    // From (6, 10) across the run to its far end: the last pieces are reused, so the plan leaves (14, 10) outward.
    t.send({ type: "precision", held: true });
    t.down(6, 10);
    t.move(14, 10);
    expect(t.state.plan?.end).toMatchObject({ node: { q: 14, r: 10, zMm: 0 }, heading: 0 });
    t.up(14, 10);
    expect(t.sim.network().pieces.length).toBe(8);
    expect(t.state.phase).toBe("anchored");
    expect(t.state.anchor).toEqual({ node: { q: 14, r: 10, zMm: 0 }, heading: 0 });
  });

  it("returns to Idle when an undo removes the end a chain leaves from", () => {
    const t = session();
    t.drag([10, 10], [14, 10]);
    expect(t.state.anchor?.heading).toBe(0);
    t.move(17, 10);
    t.sim.execute({ type: "undo" });
    const fx = t.send({ type: "refresh" });
    expect(t.sim.network().pieces.length).toBe(0);
    expect(t.state.phase).toBe("idle");
    expect(t.state.anchor).toBeNull();
    expect(ghostOf(fx)).toBeNull();
    expect(tooltipOf(fx)).toBeNull();
    expect(last(fx, "announce")?.text).toMatch(/^Track ended/);
    // A click now starts a new track instead of building from the vanished end.
    t.down(17, 10);
    t.up(17, 10);
    expect(t.all.filter((e) => e.type === "execute")).toHaveLength(1);
    expect(t.state.anchor).toEqual({ node: t.pick(17, 10).node, heading: undefined });
    // A redo brings the track back; the tool stays where the user left it.
    t.sim.execute({ type: "redo" });
    t.send({ type: "refresh" });
    expect(t.state.anchor?.node).toMatchObject({ q: 17, r: 10 });
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
    // A deck on flat ground rising one step (0 → 1000 mm) over six pieces: (12, 12) sits near 333 mm. A bridge, so the
    // ground under it stays the terrain (a ground run's formation would be the effective ground there, and the end
    // on the ground would take the run's height even in precision; D4 feel-check fixes).
    const rises = [167, 167, 167, 167, 166, 166];
    const deck = rises.map((dz, i) => {
      const z0 = rises.slice(0, i).reduce((a, b) => a + b, 0);
      return { kind: "straight", from: { q: 10 + i, r: 12, zMm: z0 }, heading: 0, z1Mm: z0 + dz } as const;
    });
    expect(t.sim.execute({ type: "build-track", pieces: deck, structure: "bridge" }).ok).toBe(true);
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

  it("plans with auto-grade while no height steps are pressed, and with fixed heights once they are (D4)", () => {
    // The seeded map is steep: from (25, 14) the ground falls 1.4 m over 20 m, more than 35‰ reaches, so auto ends
    // off the ground.
    const t = session();
    t.down(25, 14);
    let fx = t.move(29, 14);
    expect(t.drags.at(-1)?.heightMode).toBe("auto");
    const plan = t.state.plan;
    const end = plan?.end?.node;
    if (!plan || !end) throw new Error("no plan");
    expect(plan.pieces.every((p) => Math.abs(p.z1Mm - p.from.zMm) * 1000 <= 35 * 5000)).toBe(true);
    const aboveMm = end.zMm - (t.groundZmm(end.q, end.r) ?? 0);
    expect(aboveMm).not.toBe(0);
    // One plan, no re-plan to the ground: the tooltip shows where the end actually sits.
    expect(tooltipOf(fx)?.metrics?.endHeight).toBe(`End height ${formatHeight(aboveMm)}`);
    fx = t.send({ type: "height", delta: 1 });
    expect(t.drags.at(-1)?.heightMode).toBe("fixed");
    expect(t.state.plan?.end?.node.zMm).toBe((t.groundZmm(29, 14) ?? 0) + STEP_MM);
    expect(tooltipOf(fx)?.metrics?.endHeight).toBe("End height +1 m");
    t.send({ type: "height", delta: -1 });
    expect(t.drags.at(-1)?.heightMode).toBe("auto");
    expect(t.state.plan?.end?.node).toEqual(end);
  });

  it("ignores height keys until a track is started", () => {
    const t = session();
    const fx = t.send({ type: "height", delta: 1 });
    expect(t.state.heightSteps).toBe(0);
    expect(last(fx, "announce")?.text).toMatch(/Start a track first/);
  });

  it("keeps the height above ground when chaining", () => {
    // On flat ground, and 35 m long so one 1 m step stays within 35‰ (until D4: 20 m on the seeded map, which the
    // grade rule now rejects).
    const t = session({ flat: true });
    // The ground before the build: afterwards the effective ground at the end is the new track's own formation.
    const ground = t.groundZmm(17, 10) ?? 0;
    t.down(10, 10);
    t.move(17, 10);
    t.send({ type: "height", delta: 1 });
    t.up(17, 10);
    expect(t.state.heightSteps).toBe(1);
    const end = t.sim.network().nodes.find((n) => n.q === 17 && n.r === 10);
    expect(end?.zMm).toBe(ground + STEP_MM);
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

  it("starts every activation with precision off; only a held modifier turns it back on", () => {
    const t = session();
    t.send({ type: "precision", held: true });
    t.send({ type: "radius-step", delta: 1 });
    t.send({ type: "deactivate" });
    // The modifier was released while Track was inactive, so no precision event reached the tool.
    t.send({ type: "activate" });
    expect(t.state.precision).toBe(false);
    t.down(10, 10);
    t.move(14, 10);
    expect(t.drags.at(-1)?.precision).toBeUndefined();
    expect(t.drags.at(-1)?.magnetism).toBe(true);
    expect(tooltipOf(t.all)?.precision).toBeNull();
    // The chosen radius class is kept for the next time precision is held.
    t.send({ type: "precision", held: true });
    expect(t.drags.at(-1)?.precision).toEqual({ radiusM: 240 });
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

/** Flat dry land at 0 m with a 15 m cliff from q = 12 east (row-independent): a straight line into it tunnels. */
const CLIFF = makeTerrain(TERRAIN.columns, TERRAIN.rows, (q) => (q >= 12 ? 150 : 0), -100);

/** Land at 11 m with a lake (bed 7 m, water level 10 m) from q = 20 east: water nodes carry the deck at 14 m. */
const LAKE = makeTerrain(TERRAIN.columns, TERRAIN.rows, (q) => (q >= 20 ? 70 : 110), 100);

/** Land at 20 m with a dry valley 10 m deep for q 16–26 (row-independent): a level straight line bridges it. */
const VALLEY = makeTerrain(TERRAIN.columns, TERRAIN.rows, (q) => (q >= 16 && q <= 26 ? 100 : 200), -100);

describe("track tool: Straight line mode (owner decision 2026-09-28, \"One 'Straight line' tool\")", () => {
  /** A straight line from (q0, 10) to (q1, 10) with the tool in mode "straight". */
  function straightLine(terrain: Terrain | undefined, q0: number, q1: number) {
    const t = terrain ? session({ terrain }) : session({ flat: true });
    t.send({ type: "activate", mode: "straight" });
    expect(t.state.mode).toBe("straight");
    t.down(q0, 10);
    const fx = t.move(q1, 10);
    return { t, fx };
  }

  /** Every piece rises by the same share of the height change (a steady grade, largest-remainder rounding). */
  function steady(pieces: readonly { from: { zMm: number }; z1Mm: number }[]): boolean {
    const rises = pieces.map((p) => p.z1Mm - p.from.zMm);
    return Math.max(...rises) - Math.min(...rises) <= 1;
  }

  it("bridges a valley on a level line, ground at both ends", () => {
    const { t, fx } = straightLine(VALLEY, 6, 36);
    expect(t.drags.at(-1)?.heightMode).toBe("straight");
    const plan = t.state.plan;
    if (!plan) throw new Error("no plan");
    expect(plan.pieces.every((p) => p.from.zMm === 20_000 && p.z1Mm === 20_000)).toBe(true);
    const kinds = ghostOf(fx)?.pieces.map((p) => p.structure) ?? [];
    expect(kinds[0]).toBe("ground");
    expect(kinds.at(-1)).toBe("ground");
    expect(kinds).toContain("bridge");
    expect(kinds).not.toContain("tunnel");
    expect(ghostOf(fx)?.valid).toBe(true);
    const tip = tooltipOf(fx);
    expect(tip?.structure).toMatch(/^Structure: \d+ bridge, \d+ ground$/);
    expect(tip?.hint).toBe(STRAIGHT_HINT_LINE);
    const exec = last(t.up(36, 10), "execute");
    expect(exec?.command).toMatchObject({ type: "build-track", structure: "auto" });
    expect(t.sim.network().pieces.some((p) => p.structure === "bridge")).toBe(true);
  });

  it("tunnels through a hill: the end the ground wants is out of 35‰ reach, so it stops where 35‰ reaches", () => {
    // 26 pieces (130 m) from the plain at 0 m to the cliff top at 15 m: 35‰ reaches 4.55 m, and the line holds
    // that grade into the cliff, a tunnel under 10 m and more of rock.
    const { t, fx } = straightLine(CLIFF, 4, 30);
    const plan = t.state.plan;
    if (!plan?.end) throw new Error("no plan");
    expect(plan.end.node.zMm).toBe(26 * 175);
    expect(steady(plan.pieces)).toBe(true);
    const kinds = ghostOf(fx)?.pieces.map((p) => p.structure) ?? [];
    expect(kinds.slice(0, 7).every((k) => k === "ground")).toBe(true);
    expect(kinds.filter((k) => k === "tunnel").length).toBeGreaterThan(10);
    expect(ghostOf(fx)?.valid).toBe(true);
    // The end sits 10.5 m under the ground there, and the tooltip says so.
    expect(tooltipOf(fx)?.metrics?.endHeight).toBe(formatHeight(26 * 175 - 15_000).replace(/^/, "End height "));
  });

  it("lays ground on flat land, and the height keys raise the end on a steady grade", () => {
    const { t, fx } = straightLine(undefined, 10, 20);
    expect(ghostOf(fx)?.pieces.every((p) => p.structure === "ground")).toBe(true);
    expect(tooltipOf(fx)?.structure).toBe("Structure: ground");
    t.send({ type: "height", delta: 1 });
    const plan = t.state.plan;
    expect(plan?.end?.node.zMm).toBe(STEP_MM);
    expect(steady(plan?.pieces ?? [])).toBe(true);
    expect(t.drags.at(-1)?.heightMode).toBe("straight");
    // No structure is forced on the planner (the Bridge and Tunnel tools are gone).
    expect(t.drags.at(-1)?.structure).toBeUndefined();
  });

  it("crosses a lake as a bridge from a start on the water, at the deck height", () => {
    const t = session({ terrain: LAKE });
    t.send({ type: "activate", mode: "straight" });
    t.down(22, 10);
    const drag = t.move(34, 10);
    // The deck start (M2) is 14 m. Asked down to the water surface, 35‰ over 60 m holds the end 1.9 m above it; since
    // "Keep the limit, show it" (2026-09-28) ] steps from the held end, so three presses put it at +2, +3, then +4 m
    // over the water: a level deck. (Before, the first press changed nothing and a fourth was needed.)
    expect(tooltipOf(drag)?.held).toBe("End held 1.9 m above the water by the 3.5 % limit");
    for (let i = 0; i < 3; i++) t.send({ type: "height", delta: 1 });
    expect(t.state.heightSteps).toBe(4);
    const fx = t.move(34, 10);
    expect(t.state.plan?.pieces.every((p) => p.from.zMm === 14_000 && p.z1Mm === 14_000)).toBe(true);
    const ghost = ghostOf(fx) ?? ghostOf(t.all);
    expect(ghost?.pieces.every((p) => p.structure === "bridge")).toBe(true);
    expect(ghost?.valid).toBe(true);
  });

  it("starts a free drag on water at the deck height, the water level + 4.0 m, still auto-graded (M2)", () => {
    const t = session({ terrain: LAKE });
    // (22, 10) is water: the ground there is the water surface at 10 m, the deck at 14 m.
    expect(t.groundZmm(22, 10)).toBe(10_000);
    t.down(22, 10);
    let fx = t.move(30, 10);
    const drag = t.drags.at(-1);
    expect(drag?.from).toEqual({ q: 22, r: 10, zMm: 14_000 });
    expect(drag?.heightMode).toBe("auto");
    expect(t.state.heightSteps).toBe(0);
    // A level deck over the water, every piece a bridge, and the end height is the deck over the water surface.
    expect(t.state.plan?.pieces.every((p) => p.from.zMm === 14_000 && p.z1Mm === 14_000)).toBe(true);
    expect(ghostOf(fx)?.pieces.every((p) => p.structure === "bridge")).toBe(true);
    expect(tooltipOf(fx)?.metrics?.endHeight).toBe("End height +4 m");
    // Back onto the land at 11 m: 3 m above it at the shore, the deck comes down at 35‰ (86 m) to the ground.
    fx = t.move(12, 10);
    expect(t.state.plan?.end?.node).toEqual({ q: 12, r: 10, zMm: 14_000 - 7 * 175 });
    expect(tooltipOf(fx)?.metrics?.endHeight).toBe(`End height ${formatHeight(14_000 - 7 * 175 - 11_000)}`);
    fx = t.move(0, 10);
    expect(t.state.plan?.end?.node).toEqual({ q: 0, r: 10, zMm: 11_000 });
    expect(tooltipOf(fx)?.metrics?.endHeight).toBe("End height 0 m");
    const done = t.up(0, 10);
    expect(last(done, "execute")?.command).toMatchObject({ type: "build-track", structure: "auto" });
    // On dry land the start stays on the ground, as before.
    const land = session({ terrain: LAKE });
    land.down(15, 10);
    land.move(18, 10);
    expect(land.drags.at(-1)?.from).toEqual({ q: 15, r: 10, zMm: 11_000 });
  });

  it("reads each new piece's structure from the preview's diff, and a reused piece's from the network", () => {
    const t = session({ terrain: VALLEY });
    // Ground track first (Track mode), then a straight line that runs back over it and on across the valley.
    t.drag([8, 10], [11, 10]);
    t.send({ type: "escape" });
    t.send({ type: "escape" });
    t.send({ type: "deactivate" });
    t.send({ type: "activate", mode: "straight" });
    t.down(8, 10);
    const fx = t.move(30, 10);
    const ghost = ghostOf(fx);
    const labels = ghost?.pieces.map((p) => `${p.status}:${p.structure}`) ?? [];
    expect(labels.slice(0, 3)).toEqual(["reused:ground", "reused:ground", "reused:ground"]);
    expect(labels).toContain("new:bridge");
  });

  it("keeps the Track tool's tooltip as it was for all-ground plans, and starts each activation in its own mode", () => {
    const t = session({ flat: true });
    t.down(10, 10);
    const tip = tooltipOf(t.move(14, 10));
    expect(tip?.structure).toBeNull();
    expect(tip?.lines[1]).toMatch(/^Length /);
    expect(tip?.hint).toBe(HINT_LINE);
    expect(ghostOf(t.all)?.pieces.every((p) => p.structure === "ground")).toBe(true);
    t.send({ type: "deactivate" });
    expect(t.state.mode).toBe("follow");
    t.send({ type: "activate", mode: "straight" });
    t.send({ type: "deactivate" });
    t.send({ type: "activate" });
    expect(t.state.mode).toBe("follow");
  });
});

describe("track tool: a Straight line end held by the 3.5 % limit (owner decision 2026-09-28, \"Keep the limit, show it\")", () => {
  /** A straight line from (q0, r) to (q1, r), still dragging, with the tool in mode "straight". */
  function held(terrain: Terrain, q0: number, q1: number, r = 10) {
    const t = session({ terrain });
    t.send({ type: "activate", mode: "straight" });
    t.down(q0, r);
    const fx = t.move(q1, r);
    return { t, fx };
  }

  const SCENE_B = "End held 11.2 m below the ground by the 3.5 % limit";

  it("says where the limit holds the end, draws its drop line, and keeps the steps for keys pressed into the limit (diorama scene B)", () => {
    // The diagnosis' scene B: (220, 140) → (236, 140) on the diorama, 16 pieces (80 m). 35‰ reaches 2.8 m, and the
    // ground at the end stands 14 m above the start, so the line ends 11.2 m under the hill (a dead-end tunnel).
    const { t, fx } = held(diorama().terrain, 220, 236, 140);
    expect(t.state.phase).toBe("dragging");
    const tip = tooltipOf(fx);
    expect(tip?.metrics?.endHeight).toBe("End height −11.2 m");
    expect(tip?.held).toBe(SCENE_B);
    // Under the metrics line (after the counts and the structure line), and in the announcement.
    expect(tip?.lines.indexOf(SCENE_B)).toBe(3);
    expect(last(fx, "announce")?.text).toContain(`End height −11.2 m. ${SCENE_B}. `);
    expect(ghostOf(fx)?.endHeld).toBe(true);
    expect(ghostOf(fx)?.valid).toBe(true);
    const plan = t.state.plan;

    // ] asks for a higher end, which 35‰ cannot reach either: 16 presses, 16 announcements, no step and no re-plan.
    const planned = t.drags.length;
    for (let i = 0; i < 16; i++) {
      expect(t.send({ type: "height", delta: 1 })).toEqual([{ type: "announce", text: `Height unchanged: end held 11.2 m below the ground by the 3.5 % limit.` }]);
      expect(t.state.heightSteps).toBe(0);
    }
    expect(t.drags.length).toBe(planned);
    expect(t.state.plan).toBe(plan);

    // Laid and chained: the next drag starts with no hidden steps (before, the 16 presses carried +16 into it).
    t.up(236, 140);
    expect(t.sim.network().pieces).toHaveLength(16);
    expect(t.state.phase).toBe("anchored");
    expect(t.state.heightSteps).toBe(0);
  });

  it("steps a held end from where it is held when a key presses away from the limit", () => {
    const { t, fx } = held(diorama().terrain, 220, 236, 140);
    expect(tooltipOf(fx)?.held).toBe(SCENE_B);
    const ground = t.groundZmm(236, 140) ?? 0;
    // [ lowers the end at once, to the first whole step under it: 12 m below the ground, which 35‰ reaches.
    const down = t.send({ type: "height", delta: -1 });
    expect(t.state.heightSteps).toBe(-12);
    expect(t.state.plan?.end?.node.zMm).toBe(ground - 12_000);
    expect(tooltipOf(down)?.metrics?.endHeight).toBe("End height −12 m");
    expect(tooltipOf(down)?.held).toBeNull();
    expect(ghostOf(down)?.endHeld).toBe(false);
    // Then one step at a time, as anywhere else.
    t.send({ type: "height", delta: -1 });
    expect(t.state.heightSteps).toBe(-13);
    expect(t.state.plan?.end?.node.zMm).toBe(ground - 13_000);
  });

  it("holds an end above the ground as well: from a cliff top down to the plain", () => {
    // 10 pieces (50 m) from the cliff top at 15 m to the plain at 0 m: 35‰ reaches 1.75 m, so the end stays at 13.25 m.
    const { t, fx } = held(CLIFF, 14, 4);
    expect(t.state.plan?.end?.node.zMm).toBe(15_000 - 1750);
    expect(tooltipOf(fx)?.metrics?.endHeight).toBe("End height +13.3 m");
    expect(tooltipOf(fx)?.held).toBe("End held 13.3 m above the ground by the 3.5 % limit");
    expect(ghostOf(fx)?.endHeld).toBe(true);
    // [ asks for a lower end still: the limit. ] steps up from the held end, to 14 m.
    expect(t.send({ type: "height", delta: -1 })).toEqual([{ type: "announce", text: "Height unchanged: end held 13.3 m above the ground by the 3.5 % limit." }]);
    expect(t.state.heightSteps).toBe(0);
    const up = t.send({ type: "height", delta: 1 });
    expect(t.state.heightSteps).toBe(14);
    expect(t.state.plan?.end?.node.zMm).toBe(14_000);
    expect(tooltipOf(up)?.held).toBeNull();
  });

  it("counts an end as held exactly when it lies more than half a step off the ground plus the steps", () => {
    // 4 pieces (20 m): 35‰ reaches 0.7 m. A 1.2 m rise at the end leaves the end 0.5 m short (half a step: not held);
    // a 1.3 m rise leaves it 0.6 m short (held).
    const rise = (dm: number) => makeTerrain(TERRAIN.columns, TERRAIN.rows, (q) => (q >= 14 ? dm : 0), -100);
    const half = held(rise(12), 10, 14);
    expect(half.t.state.plan?.end?.node.zMm).toBe(700);
    expect(tooltipOf(half.fx)?.held).toBeNull();
    expect(ghostOf(half.fx)?.endHeld).toBe(false);
    const more = held(rise(13), 10, 14);
    expect(more.t.state.plan?.end?.node.zMm).toBe(700);
    expect(tooltipOf(more.fx)?.held).toBe("End held 0.6 m below the ground by the 3.5 % limit");
    expect(ghostOf(more.fx)?.endHeld).toBe(true);
    // ] asks for more still: the limit, so the steps stay.
    more.t.send({ type: "height", delta: 1 });
    expect(more.t.state.heightSteps).toBe(0);
    // A Track drag over the same rise never counts as held: auto-grade chooses its end, and steps fix it.
    const track = session({ terrain: rise(13) });
    track.down(10, 10);
    const fx = track.move(14, 10);
    expect(tooltipOf(fx)?.held).toBeNull();
    expect(ghostOf(fx)?.endHeld).toBe(false);
  });

  it("measures an end held over water from the water surface", () => {
    // From the land at 11 m out to the lake (water level 10 m), 4 pieces: 35‰ reaches 0.7 m, so an end asked down to
    // the water surface stays 0.3 m above it, within half a step (not held). One step down asks for 9 m: the end
    // still stays at 10.3 m, now held; a second step presses into the limit.
    const { t, fx } = held(LAKE, 16, 20);
    expect(t.groundZmm(20, 10)).toBe(10_000);
    expect(t.state.plan?.end?.node.zMm).toBe(10_300);
    expect(tooltipOf(fx)?.held).toBeNull();
    const first = t.send({ type: "height", delta: -1 });
    expect(t.state.heightSteps).toBe(-1);
    expect(tooltipOf(first)?.held).toBe("End held 0.3 m above the water by the 3.5 % limit");
    expect(t.send({ type: "height", delta: -1 })).toEqual([{ type: "announce", text: "Height unchanged: end held 0.3 m above the water by the 3.5 % limit." }]);
    expect(t.state.heightSteps).toBe(-1);
  });

  it("keeps the steps for both keys when the line is aimed at a raised track end it cannot reach, and chains with none", () => {
    // Verification finding (2026-09-29): a 10 m raised track (10 bridge pieces) east from (30, 10) on flat 0 m ground,
    // and a straight line from (16, 12) with the pointer on its buffer end. The tool asks for that end's 10 m, which
    // 35‰ cannot reach, and magnetism does not fit, so the line ends on the end's (q, r) at 2.33 m. Before, the held
    // check measured that end against the ground plus the steps (2.3 m "above the ground"), so the first ] jumped the
    // steps 0 -> 3 without moving the end or saying so, and the hidden +3 m carried into the chained drag.
    const t = session({ flat: true });
    const raised = Array.from({ length: 10 }, (_, i) => ({ kind: "straight", from: { q: 30 + i, r: 10, zMm: 10_000 }, heading: 0, z1Mm: 10_000 }) as const);
    expect(t.sim.execute({ type: "build-track", pieces: raised, structure: "auto" }).ok).toBe(true);
    t.send({ type: "activate", mode: "straight" });
    t.down(16, 12);
    t.move(17, 13);
    const fx = t.move(30, 10);
    const plan = t.state.plan;
    expect(plan?.snapped).toBeNull();
    expect(plan?.end?.node).toEqual({ q: 30, r: 10, zMm: 2330 });
    const HELD = "End held 7.7 m below the track end at (30, 10) by the 3.5 % limit";
    expect(tooltipOf(fx)?.held).toBe(HELD);
    expect(tooltipOf(fx)?.metrics?.endHeight).toBe("End height +2.3 m");
    expect(ghostOf(fx)?.endHeld).toBe(true);
    expect(ghostOf(fx)?.valid).toBe(true);
    // No key changes the height asked for on a track end: both announce the limit and keep the steps, with no re-plan.
    const planned = t.drags.length;
    for (const delta of [1, 1, 1, -1, -1, -1, -1, 1] as const) {
      expect(t.send({ type: "height", delta })).toEqual([{ type: "announce", text: `Height unchanged: ${HELD.charAt(0).toLowerCase()}${HELD.slice(1)}.` }]);
      expect(t.state.heightSteps).toBe(0);
    }
    expect(t.drags.length).toBe(planned);
    expect(t.state.plan).toBe(plan);
    // Laid below the raised end (not joined: it ends at 2.33 m), the chain goes on with no hidden steps.
    t.up(30, 10);
    expect(t.state.phase).toBe("anchored");
    expect(t.state.anchor?.node).toEqual({ q: 30, r: 10, zMm: 2330 });
    expect(t.state.heightSteps).toBe(0);
    const next = t.move(30, 20);
    const end = t.state.plan?.end?.node;
    if (!end) throw new Error("no chained plan");
    // The chained drag asks for the ground (0 m) plus no steps, so its end is the nearest height 35‰ reaches from 2.33 m.
    expect(t.drags.at(-1)?.dzMm).toBe(end.zMm - 2330);
    expect(end.zMm).toBeLessThan(2330);
    expect(tooltipOf(next)?.metrics?.endHeight).not.toBe("End height +3 m");
  });
});
