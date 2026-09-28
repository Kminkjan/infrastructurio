import { describe, expect, it } from "vitest";
import { makeTerrain } from "../../tests/support/makeTerrain";
import { type Drag, type Sim, type Terrain, generateTerrain, waterDeckMm } from "../core/sim/api";
import { createWorld } from "../core/sim/world";
import { HINT_LINE, formatHeight } from "./format";
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

/** Flat dry land at 0 m with a 15 m cliff from q = 12 east (row-independent), for Tunnel drags into it. */
const CLIFF = makeTerrain(TERRAIN.columns, TERRAIN.rows, (q) => (q >= 12 ? 150 : 0), -100);

/** Land at 11 m with a lake (bed 7 m, water level 10 m) from q = 20 east: water nodes carry the deck at 14 m. */
const LAKE = makeTerrain(TERRAIN.columns, TERRAIN.rows, (q) => (q >= 20 ? 70 : 110), 100);

describe("track tool: Bridge and Tunnel modes (D4)", () => {
  it("builds with the forced structure, and the ghost and tooltip name it", () => {
    // A bridge on flat ground at its own level (a deck on the ground breaks no rule), and a tunnel into a cliff from
    // its foot: since D4 a forced tunnel on flat ground is no deeper than a cutting and is rejected.
    for (const [structure, terrain, from] of [
      ["bridge", undefined, 10],
      ["tunnel", CLIFF, 11],
    ] as const) {
      const t = terrain ? session({ terrain }) : session({ flat: true });
      t.send({ type: "activate", structure });
      expect(t.state.structure).toBe(structure);
      t.down(from, 10);
      const fx = t.move(from + 4, 10);
      // The planner validates its candidates with the forced structure.
      expect(t.drags.at(-1)?.structure).toBe(structure);
      const ghost = ghostOf(fx);
      expect(ghost?.pieces.map((p) => p.structure)).toEqual([structure, structure, structure, structure]);
      expect(ghost?.valid).toBe(true);
      const tip = tooltipOf(fx);
      expect(tip?.structure).toBe(`Structure: ${structure}`);
      expect(tip?.lines[1]).toBe(`Structure: ${structure}`);
      const done = t.up(from + 4, 10);
      const exec = last(done, "execute");
      expect(exec?.command).toMatchObject({ type: "build-track", structure });
      expect(t.sim.network().pieces.every((p) => p.structure === structure)).toBe(true);
    }
    // The Track tool leaves the structure to the core's inference and says nothing of it to the planner.
    const track = session({ flat: true });
    track.down(10, 10);
    track.move(14, 10);
    expect(track.drags.at(-1)?.structure).toBeUndefined();
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
    const t = session({ flat: true });
    // Ground track first (Track mode, auto), then a Bridge drag that runs back over it and on.
    t.drag([10, 10], [13, 10]);
    t.send({ type: "escape" });
    t.send({ type: "escape" });
    t.send({ type: "deactivate" });
    t.send({ type: "activate", structure: "bridge" });
    t.down(10, 10);
    const fx = t.move(16, 10);
    const ghost = ghostOf(fx);
    expect(ghost?.pieces.map((p) => `${p.status}:${p.structure}`)).toEqual(["reused:ground", "reused:ground", "reused:ground", "new:bridge", "new:bridge", "new:bridge"]);
    expect(tooltipOf(fx)?.structure).toBe("Structure: 3 bridge, 3 ground");
  });

  it("keeps the Track tool's tooltip as it was for all-ground plans, and starts each activation in its own mode", () => {
    const t = session({ flat: true });
    t.down(10, 10);
    const tip = tooltipOf(t.move(14, 10));
    expect(tip?.structure).toBeNull();
    expect(tip?.lines[1]).toMatch(/^Length /);
    expect(ghostOf(t.all)?.pieces.every((p) => p.structure === "ground")).toBe(true);
    t.send({ type: "deactivate" });
    expect(t.state.structure).toBe("auto");
    t.send({ type: "activate", structure: "tunnel" });
    t.send({ type: "deactivate" });
    t.send({ type: "activate" });
    expect(t.state.structure).toBe("auto");
  });
});
